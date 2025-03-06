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
        rpc_config::{RpcProgramAccountsConfig, RpcTransactionLogsConfig, RpcTransactionLogsFilter, RpcAccountInfoConfig},
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
        state::{RandomnessRequest, RequestStatus},
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
        Ok(Self {
            rpc_client: RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            ),
            program_id: Pubkey::from_str(program_id)?,
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
    async fn process_pending_requests(&self) -> Result<(), Box<dyn Error>> {
        // Get all program accounts that are request accounts
        let request_accounts = self.rpc_client.get_program_accounts_with_config(
            &self.program_id,
            RpcProgramAccountsConfig {
                filters: Some(vec![
                    RpcFilterType::Memcmp(
                        Memcmp::new_base58_encoded(0, &[82, 69, 81, 85, 69, 83, 84, 0])
                    ), // "REQUEST\0"
                    RpcFilterType::DataSize(40 + 8), // Approximate size of RandomnessRequest + discriminator
                ]),
                account_config: RpcAccountInfoConfig {
                    commitment: Some(self.commitment),
                    ..RpcAccountInfoConfig::default()
                },
                ..Default::default()
            },
        )?;

        for (pubkey, account) in request_accounts {
            // Skip discriminator
            if let Ok(request) = RandomnessRequest::try_from_slice(&account.data[8..]) {
                if request.status == RequestStatus::Pending {
                    match self.fulfill_request(&pubkey, request).await {
                        Ok(_) => println!("Successfully fulfilled request {}", pubkey),
                        Err(e) => eprintln!("Failed to fulfill request {}: {}", pubkey, e),
                    }
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

        // Generate VRF proof
        let (_output, proof) = self.vrf_keypair.output(&request.seed);
        let proof_bytes = proof.to_bytes();
        let public_key_bytes = self.vrf_keypair.pk.as_ref().to_vec();

        // Derive VRF result PDA
        let (vrf_result, _bump) = Pubkey::find_program_address(
            &[b"vrf_result", request.requester.as_ref()],
            &self.program_id,
        );

        // Create fulfill randomness instruction
        let fulfill_ix = VrfCoordinatorInstruction::FulfillRandomness {
            proof: proof_bytes.to_vec(),
            public_key: public_key_bytes.clone(),
        };
        let fulfill_ix_data = borsh::to_vec(&fulfill_ix)?;

        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.oracle_keypair.pubkey(), true),
                AccountMeta::new(*request_pubkey, false),
                AccountMeta::new(vrf_result, false),
                AccountMeta::new_readonly(request.requester, false),
                AccountMeta::new(request.subscription, false),
                AccountMeta::new_readonly(system_program::id(), false),
                AccountMeta::new_readonly(request.requester, false),
                AccountMeta::new(request.requester, false),
            ],
            data: fulfill_ix_data,
        };

        // Create and send transaction
        let recent_blockhash = self.rpc_client.get_latest_blockhash()?;
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.oracle_keypair.pubkey()),
            &[&self.oracle_keypair],
            recent_blockhash,
        );

        // Send and confirm transaction
        let signature = self.rpc_client.send_and_confirm_transaction_with_spinner(&transaction)?;
        println!("Fulfilled request {} with signature {}", request_pubkey, signature);

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
        // Start event monitor in a separate task
        let event_monitor = self.monitor_events();
        
        // Start request processor
        let request_processor = self.start();
        
        // Run both concurrently
        tokio::try_join!(event_monitor, request_processor)?;
        
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