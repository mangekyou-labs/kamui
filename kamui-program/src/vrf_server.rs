use {
    solana_program::{
        pubkey::Pubkey,
    },
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::{Keypair, Signer},
        transaction::Transaction,
        instruction::{AccountMeta, Instruction},
        system_program,
    },
    solana_client::{
        rpc_client::RpcClient,
        rpc_config::{RpcProgramAccountsConfig, RpcTransactionLogsConfig, RpcTransactionLogsFilter, RpcAccountInfoConfig, RpcSendTransactionConfig},
        rpc_filter::{RpcFilterType, Memcmp},
    },
    futures_util::StreamExt,
    solana_client::nonblocking::pubsub_client::PubsubClient,
    borsh::BorshDeserialize,
    mangekyou::kamui_vrf::{
        ecvrf::ECVRFKeyPair,
        VRFProof,
        VRFKeyPair,
    },
    crate::{
        instruction::VrfCoordinatorInstruction,
        state::{RandomnessRequest, RequestStatus, VrfResult},
        event::VrfEvent,
    },
    std::{
        str::FromStr,
        thread,
        time::Duration,
        error::Error,
        fs::File,
        io::{Write, Read},
        path::Path,
    },
    base64::Engine,
    rand,
    serde_json,
    bincode,
};

pub struct VRFServer {
    /// RPC client for interacting with the Solana network
    rpc_client: RpcClient,
    /// VRF coordinator program ID
    program_id: Pubkey,
    /// Oracle keypair for signing transactions
    oracle_keypair: Keypair,
    /// VRF keypair for generating proofs
    vrf_keypair: ECVRFKeyPair,
    /// Commitment level for transactions
    commitment: CommitmentConfig,
}

impl VRFServer {
    pub fn new(
        rpc_url: &str,
        program_id: &str,
        oracle_keypair: Keypair,
        vrf_keypair: ECVRFKeyPair,
    ) -> Result<Self, Box<dyn Error>> {
        let program_id = Pubkey::from_str(program_id)?;
        
        // Create RPC client with custom configuration
        let rpc_client = RpcClient::new_with_commitment(
            rpc_url.to_string(),
            CommitmentConfig::confirmed(),
        );
        
        println!("VRF server initialized with program ID: {}", program_id);
        println!("Oracle pubkey: {}", oracle_keypair.pubkey());
        println!("VRF pubkey: {}", hex::encode(vrf_keypair.pk.as_ref()));
        
        Ok(Self {
            rpc_client,
            program_id,
            oracle_keypair,
            vrf_keypair,
            commitment: CommitmentConfig::confirmed(),
        })
    }

    /// Start the VRF server
    pub async fn start(&self) -> Result<(), Box<dyn Error>> {
        println!("Starting VRF server...");
        println!("Oracle pubkey: {}", self.oracle_keypair.pubkey());
        println!("VRF pubkey: {}", hex::encode(self.vrf_keypair.pk.as_ref()));

        loop {
            match self.process_pending_requests().await {
                Ok(_) => (),
                Err(e) => eprintln!("Error processing requests: {}", e),
            }
            thread::sleep(Duration::from_secs(1));
        }
    }

    /// Process all pending VRF requests
    pub async fn process_pending_requests(&self) -> Result<(), Box<dyn Error>> {
        println!("Checking for pending VRF requests...");
        
        // Check if the oracle account has enough SOL
        let oracle_balance = self.rpc_client.get_balance(&self.oracle_keypair.pubkey())?;
        println!("Oracle account balance: {} SOL", oracle_balance as f64 / 1_000_000_000.0);
        
        if oracle_balance < 10_000_000 {  // 0.01 SOL
            println!("WARNING: Oracle account balance is too low. Please fund the oracle account with at least 0.01 SOL.");
            println!("Oracle account: {}", self.oracle_keypair.pubkey());
            return Ok(());
        }
        
        // Get all accounts owned by the program with the REQUEST discriminator
        let request_accounts = self.rpc_client.get_program_accounts_with_config(
            &self.program_id,
            RpcProgramAccountsConfig {
                filters: Some(vec![
                    RpcFilterType::Memcmp(
                        Memcmp::new_base58_encoded(0, &[82, 69, 81, 85, 69, 83, 84, 0])
                    ), // "REQUEST\0"
                ]),
                account_config: RpcAccountInfoConfig {
                    encoding: None,
                    commitment: Some(self.commitment),
                    ..RpcAccountInfoConfig::default()
                },
                ..Default::default()
            },
        )?;
        
        println!("Found {} request accounts", request_accounts.len());
        
        for (pubkey, account) in request_accounts {
            println!("Processing request account: {}", pubkey);
            
            // Skip discriminator
            if account.data.len() < 8 {
                println!("Account data too short: {}", account.data.len());
                continue;
            }
            
            // Check discriminator
            let discriminator = &account.data[0..8];
            
            if discriminator != b"REQUEST\0" {
                println!("Invalid discriminator");
                continue;
            }
            
            // Try to deserialize the request
            match RandomnessRequest::try_from_slice(&account.data[8..]) {
                Ok(request) => {
                    if request.status == RequestStatus::Pending {
                        println!("Found new pending VRF request: {}", pubkey);
                        match self.fulfill_request(&pubkey, request).await {
                            Ok(_) => println!("Successfully fulfilled VRF request {}", pubkey),
                            Err(e) => eprintln!("Failed to fulfill VRF request {}: {}", pubkey, e),
                        }
                    } else {
                        println!("Request not pending, status: {:?}", request.status);
                    }
                }
                Err(e) => {
                    println!("Failed to deserialize request: {}", e);
                }
            }
        }

        Ok(())
    }

    /// Fulfill a single VRF request
    async fn fulfill_request(
        &self,
        request_pubkey: &Pubkey,
        request: RandomnessRequest,
    ) -> Result<(), Box<dyn Error>> {
        println!("Processing request {}", request_pubkey);
        println!("Request details: requester={}, subscription={}, seed={:?}", 
                 request.requester, request.subscription, hex::encode(&request.seed));

        // Generate VRF proof
        println!("Generating VRF proof for seed: {}", hex::encode(&request.seed));
        let (output, proof) = self.vrf_keypair.output(&request.seed);
        let proof_bytes = proof.to_bytes();
        let public_key_bytes = self.vrf_keypair.pk.as_ref().to_vec();
        
        println!("Generated proof: {}", hex::encode(&proof_bytes));
        println!("Output: {}", hex::encode(&output));

        // Derive VRF result PDA
        let (vrf_result, bump) = Pubkey::find_program_address(
            &[b"vrf_result", request.requester.as_ref()],
            &self.program_id,
        );
        println!("VRF result PDA: {} (bump: {})", vrf_result, bump);

        // Create fulfill randomness instruction
        let fulfill_ix = VrfCoordinatorInstruction::FulfillRandomness {
            proof: proof_bytes.to_vec(),
            public_key: public_key_bytes.clone(),
        };
        let fulfill_ix_data = borsh::to_vec(&fulfill_ix)?;
        println!("Fulfill instruction data: {:?}", hex::encode(&fulfill_ix_data));

        // Create the instruction with the correct accounts
        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.oracle_keypair.pubkey(), true),  // Oracle (signer)
                AccountMeta::new(*request_pubkey, false),              // Request account
                AccountMeta::new(vrf_result, false),                   // VRF result account
                AccountMeta::new_readonly(request.requester, false),   // Requester (callback program)
                AccountMeta::new(request.subscription, false),         // Subscription account
                AccountMeta::new_readonly(system_program::id(), false), // System program
            ],
            data: fulfill_ix_data,
        };
        println!("Accounts: {:?}", instruction.accounts);

        // Create and send transaction with base64 encoding
        println!("Getting latest blockhash...");
        let recent_blockhash = self.rpc_client.get_latest_blockhash()?;
        
        println!("Creating and signing transaction...");
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.oracle_keypair.pubkey()),
            &[&self.oracle_keypair],
            recent_blockhash,
        );

        // Serialize the transaction for sending
        let serialized_tx = bincode::serialize(&transaction)?;
        println!("Transaction serialized, length: {}", serialized_tx.len());

        println!("Sending transaction to fulfill request...");
        
        // Use base64 encoding for the transaction
        let config = RpcSendTransactionConfig {
            skip_preflight: false,
            preflight_commitment: Some(self.commitment.commitment),
            encoding: None,  // Let the RPC client decide the encoding
            max_retries: None,
            min_context_slot: None,
        };

        let signature = self.rpc_client.send_transaction_with_config(&transaction, config)?;
        println!("Fulfillment transaction sent: {}", signature);

        // Wait for confirmation
        self.rpc_client.confirm_transaction(&signature)?;
        println!("Transaction confirmed!");

        // Check if the VRF result account was created
        println!("Checking if VRF result account was created: {}", vrf_result);
        match self.rpc_client.get_account(&vrf_result) {
            Ok(account) => {
                println!("VRF result account exists: {}", vrf_result);
                println!("Account owner: {}", account.owner);
                println!("Account data length: {}", account.data.len());
                
                // Try to deserialize the VRF result
                if account.data.len() >= 8 {
                    let discriminator = &account.data[0..8];
                    println!("VRF result discriminator: {:?}", discriminator);
                    
                    if discriminator == b"VRFRSLT\0" {
                        match VrfResult::try_from_slice(&account.data[8..]) {
                            Ok(result) => {
                                println!("Deserialized VRF result: {:?}", result);
                                println!("Randomness: {:?}", hex::encode(&result.randomness[0]));
                            },
                            Err(e) => {
                                println!("Failed to deserialize VRF result: {}", e);
                                println!("Raw data: {:?}", hex::encode(&account.data[8..]));
                            }
                        }
                    } else {
                        println!("Invalid VRF result discriminator: {:?}", discriminator);
                    }
                }
            },
            Err(e) => {
                println!("Error getting VRF result account: {}", e);
                return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, 
                    format!("VRF result account was not created: {}", e))));
            }
        }

        Ok(())
    }

    /// Monitor VRF events from the program
    pub async fn monitor_events(&self) -> Result<(), Box<dyn Error>> {
        println!("Starting event monitor...");

        let ws_url = self.rpc_client.url().replace("http", "ws");
        let ws_client = PubsubClient::new(&ws_url).await?;

        let program_id = self.program_id;
        let subscription = ws_client
            .logs_subscribe(
                RpcTransactionLogsFilter::Mentions(vec![program_id.to_string()]),
                RpcTransactionLogsConfig {
                    commitment: Some(self.commitment),
                },
            )
            .await?;

        let (mut notifications, _unsubscribe) = subscription;

        while let Some(log) = notifications.next().await {
            for log_message in log.value.logs {
                if log_message.starts_with("VRF_EVENT:") {
                    let base64_data = log_message.trim_start_matches("VRF_EVENT:").trim();
                    if let Ok(event_data) = base64::engine::general_purpose::STANDARD.decode(base64_data) {
                        if let Ok(event) = VrfEvent::try_from_slice(&event_data) {
                            match event {
                                VrfEvent::RandomnessRequested { request_id, .. } => {
                                    println!("New randomness request: {}", request_id);
                                    // Process request immediately
                                    if let Err(e) = self.process_pending_requests().await {
                                        eprintln!("Failed to process request {}: {}", request_id, e);
                                    }
                                }
                                _ => (),
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Run both the request processor and event monitor
    pub async fn run(&self) -> Result<(), Box<dyn Error>> {
        println!("Starting VRF server...");
        println!("Oracle pubkey: {}", self.oracle_keypair.pubkey());
        println!("VRF pubkey: {}", hex::encode(self.vrf_keypair.pk.as_ref()));
        println!("Program ID: {}", self.program_id);

        // Process any existing pending requests first
        if let Err(e) = self.process_pending_requests().await {
            eprintln!("Error processing existing requests: {}", e);
        }

        // Start a polling loop to check for pending requests
        println!("Starting polling loop to check for pending requests...");
        
        loop {
            // Process pending requests
            if let Err(e) = self.process_pending_requests().await {
                eprintln!("Error processing requests: {}", e);
            }
            
            // Wait before checking again
            println!("Waiting 5 seconds before checking for new requests...");
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }

    async fn connect_and_monitor_events(&self, ws_url: &str) -> Result<(), Box<dyn Error>> {
        println!("Connecting to WebSocket at {}", ws_url);
        let ws_client = PubsubClient::new(ws_url).await?;
        println!("VRF server connected and monitoring for new requests...");
        println!("Monitoring program ID: {}", self.program_id);

        // Process any pending requests immediately after connection
        println!("Processing any pending requests on startup...");
        if let Err(e) = self.process_pending_requests().await {
            eprintln!("Error processing pending requests after connection: {}", e);
        }

        let program_id = self.program_id;
        println!("Subscribing to logs for program: {}", program_id);
        let subscription = ws_client
            .logs_subscribe(
                RpcTransactionLogsFilter::Mentions(vec![program_id.to_string()]),
                RpcTransactionLogsConfig {
                    commitment: Some(self.commitment),
                },
            )
            .await?;

        let (mut notifications, _unsubscribe) = subscription;
        println!("Successfully subscribed to program logs");

        while let Some(log) = notifications.next().await {
            println!("Received transaction logs: {}", log.value.signature);
            
            for log_message in &log.value.logs {
                println!("Log message: {}", log_message);
                
                if log_message.contains("VRF_EVENT:") {
                    println!("Found VRF event!");
                    let base64_data = log_message.trim_start_matches("VRF_EVENT:").trim();
                    println!("Base64 data: {}", base64_data);
                    
                    match base64::engine::general_purpose::STANDARD.decode(base64_data) {
                        Ok(event_data) => {
                            println!("Decoded event data length: {}", event_data.len());
                            
                            match VrfEvent::try_from_slice(&event_data) {
                                Ok(event) => {
                                    println!("Successfully parsed event: {:?}", event);
                                    
                                    match event {
                                        VrfEvent::RandomnessRequested { request_id, requester, subscription, seed } => {
                                            println!("New VRF request received!");
                                            println!("Request ID: {}", request_id);
                                            println!("Requester: {}", requester);
                                            println!("Subscription: {}", subscription);
                                            println!("Seed: {:?}", hex::encode(&seed));
                                            
                                            // Process the request immediately
                                            println!("Processing request immediately...");
                                            if let Err(e) = self.process_pending_requests().await {
                                                eprintln!("Failed to process VRF request {}: {}", request_id, e);
                                            }
                                        },
                                        _ => println!("Received non-request VRF event: {:?}", event),
                                    }
                                },
                                Err(e) => {
                                    eprintln!("Failed to parse VRF event: {}", e);
                                    eprintln!("Raw event data: {:?}", hex::encode(&event_data));
                                }
                            }
                        },
                        Err(e) => {
                            eprintln!("Failed to decode base64 data: {}", e);
                            eprintln!("Raw base64 data: {}", base64_data);
                        }
                    }
                }
            }
            
            // Also check for pending requests after each transaction
            println!("Checking for pending requests after transaction...");
            if let Err(e) = self.process_pending_requests().await {
                eprintln!("Error processing pending requests after transaction: {}", e);
            }
        }

        println!("WebSocket connection closed");
        Ok(())
    }
}

fn load_or_create_keypair(keypair_path: &Path) -> Result<ECVRFKeyPair, Box<dyn Error>> {
    if keypair_path.exists() {
        let mut file = File::open(keypair_path)?;
        let mut keypair_data = String::new();
        file.read_to_string(&mut keypair_data)?;
        let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data)?;
        ECVRFKeyPair::from_bytes(&keypair_bytes).map_err(|e| e.into())
    } else {
        let keypair = ECVRFKeyPair::generate(&mut rand::thread_rng());
        // Serialize just the private key bytes
        let keypair_bytes = keypair.sk.as_ref().to_vec();
        let keypair_json = serde_json::to_string(&keypair_bytes)?;
        let mut file = File::create(keypair_path)?;
        file.write_all(keypair_json.as_bytes())?;
        println!("Generated new VRF keypair: {}", hex::encode(keypair.pk.as_ref()));
        Ok(keypair)
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    let keypair_path = Path::new("vrf_keypair.bin");
    let vrf_keypair = load_or_create_keypair(keypair_path)?;
    let oracle_keypair = Keypair::new();
    
    let rpc_url = "http://localhost:8899";
    let program_id = "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D";

    let server = VRFServer::new(
        rpc_url,
        program_id,
        oracle_keypair,
        vrf_keypair,
    )?;
    
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(server.run())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::thread_rng;

    #[tokio::test]
    async fn test_vrf_server() -> Result<(), Box<dyn Error>> {
        // Create test server
        let oracle_keypair = Keypair::new();
        let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
        
        let server = VRFServer::new(
            "https://api.devnet.solana.com",
            "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D",
            oracle_keypair,
            vrf_keypair,
        )?;

        // Test processing a single request
        let request = RandomnessRequest {
            subscription: Pubkey::new_unique(),
            seed: [0u8; 32],
            requester: Pubkey::new_unique(),
            callback_data: vec![],
            request_block: 0,
            status: RequestStatus::Pending,
            num_words: 1,
            callback_gas_limit: 100_000,
            nonce: 0,
            commitment: [0u8; 32],
        };

        let request_pubkey = Pubkey::new_unique();
        server.fulfill_request(&request_pubkey, request).await?;

        Ok(())
    }
} 