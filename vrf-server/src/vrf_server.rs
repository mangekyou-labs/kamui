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
        rpc_config::{RpcProgramAccountsConfig, RpcAccountInfoConfig},
        rpc_filter::{RpcFilterType, Memcmp},
    },
    solana_account_decoder::UiAccountEncoding,
    borsh::BorshDeserialize,
    mangekyou::kamui_vrf::{
        ecvrf::ECVRFKeyPair,
        VRFProof,
        VRFKeyPair,
    },
    crate::{
        instruction::VrfCoordinatorInstruction,
        state::{RandomnessRequest, RequestStatus, Subscription},
    },
    std::{
        str::FromStr,
        error::Error,
        fs::File,
        io::{Write, Read},
        path::Path,
    },
    rand,
    serde_json,
    log::{debug, error, info, trace, warn},
    mangekyou::kamui_vrf::ecvrf::ECVRFProof,
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

// Implement Clone for VRFServer outside the impl block
impl Clone for VRFServer {
    fn clone(&self) -> Self {
        // Use correct keypair cloning to maintain the same VRF keypair
        let vrf_keypair = match self.clone_vrf_keypair() {
            Ok(kp) => kp,
            Err(e) => {
                eprintln!("Failed to clone VRF keypair: {}", e);
                // Create a fallback keypair
                let mut rng = rand::thread_rng();
                ECVRFKeyPair::generate(&mut rng)
            }
        };
        
        Self {
            rpc_client: RpcClient::new_with_commitment(
                self.rpc_client.url().to_string(),
                self.commitment,
            ),
            program_id: self.program_id,
            oracle_keypair: Keypair::from_bytes(&self.oracle_keypair.to_bytes()).unwrap(),
            vrf_keypair,
            commitment: self.commitment,
        }
    }
}

impl VRFServer {
    pub fn new(
        rpc_url: &str,
        ws_url: &str,
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

    /// Start both polling and WebSocket monitoring
    pub async fn run(&self) -> Result<(), Box<dyn Error>> {
        println!("Starting VRF server...");
        
        // Start a task for polling
        let self_clone = self.clone();
        let polling_handle = tokio::spawn(async move {
            loop {
                match self_clone.process_pending_requests().await {
                    Ok(_) => (),
                    Err(e) => eprintln!("Error processing requests: {}", e),
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        });
        
        // Start a task for WebSocket monitoring
        let self_clone = self.clone();
        let websocket_handle = tokio::spawn(async move {
            loop {
                println!("Connecting to WebSocket...");
                match self_clone.connect_and_monitor_events().await {
                    Ok(_) => {
                        // This should only happen if the connection was closed normally
                        println!("WebSocket connection closed, reconnecting in 5 seconds...");
                    },
                    Err(e) => {
                        eprintln!("WebSocket error: {}, reconnecting in 5 seconds...", e);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        });
        
        // Wait for either task to complete (which should be never)
        tokio::select! {
            _ = polling_handle => {
                println!("Polling task ended unexpectedly");
            }
            _ = websocket_handle => {
                println!("WebSocket task ended unexpectedly");
            }
        }
        
        Ok(())
    }

    /// Connect to the WebSocket and monitor for events
    pub async fn connect_and_monitor_events(&self) -> Result<(), Box<dyn Error>> {
        println!("Monitoring for events using polling instead of WebSocket...");
        
        // Instead of using WebSocket, we'll just poll for new accounts periodically
        loop {
            if let Err(e) = self.process_pending_requests().await {
                eprintln!("Error processing pending requests: {}", e);
            }
            
            // Sleep for a short time before polling again
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    }
    
    /// Process all pending VRF requests
    pub async fn process_pending_requests(&self) -> Result<(), Box<dyn Error>> {
        println!("Checking for pending VRF requests...");
        
        // Get request accounts with discriminator
        let request_accounts = self.rpc_client.get_program_accounts_with_config(
            &self.program_id,
            RpcProgramAccountsConfig {
                filters: Some(vec![
                    RpcFilterType::Memcmp(
                        Memcmp::new_base58_encoded(0, &[82, 69, 81, 85, 69, 83, 84, 0])
                    ), // "REQUEST\0"
                ]),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    commitment: Some(self.commitment),
                    ..RpcAccountInfoConfig::default()
                },
                ..Default::default()
            },
        )?;
        
        println!("Found {} request accounts with standard discriminator", request_accounts.len());
        
        // Get subscription accounts to check request accounts
        println!("Checking for subscription accounts...");
        let subscription_accounts = self.rpc_client.get_program_accounts_with_config(
            &self.program_id,
            RpcProgramAccountsConfig {
                filters: Some(vec![
                    RpcFilterType::Memcmp(
                        Memcmp::new_base58_encoded(0, &[83, 85, 66, 83, 67, 82, 73, 80])
                    ), // "SUBSCRIP"
                ]),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    commitment: Some(self.commitment),
                    ..RpcAccountInfoConfig::default()
                },
                ..Default::default()
            },
        )?;
        
        println!("Found {} subscription accounts", subscription_accounts.len());
        
        // List all accounts for this program_id to see what's there
        println!("Listing all program accounts...");
        let all_accounts = self.rpc_client.get_program_accounts(&self.program_id)?;
        println!("Found {} total program accounts", all_accounts.len());
        
        for (pubkey, account) in &all_accounts {
            if account.data.len() >= 8 {
                let discriminator = &account.data[0..8];
                let discriminator_str = discriminator.iter().map(|b| format!("{:02x}", b)).collect::<Vec<String>>().join("");
                println!("Account: {}, data length: {}, discriminator: {}",
                    pubkey, account.data.len(), discriminator_str);
            } else {
                println!("Account: {}, data length too short: {}", pubkey, account.data.len());
            }
        }
        
        // If no accounts found with the standard discriminator, or if we have subscriptions, 
        // try checking for derived request accounts from subscriptions
        if request_accounts.len() == 0 || subscription_accounts.len() > 0 {
            // For each subscription, try to derive the request account
            for (sub_pubkey, sub_account) in &subscription_accounts {
                // Skip the discriminator (first 8 bytes) to get the subscription data
                if sub_account.data.len() <= 8 {
                    println!("Subscription account data too short: {}", sub_account.data.len());
                    continue;
                }
                
                match Subscription::try_from_slice(&sub_account.data[8..]) {
                    Ok(subscription) => {
                        // Try checking request accounts for current and previous nonce values
                        for nonce_offset in 0..5 {
                            // Check for requests with nonce = current nonce - offset (if possible)
                            if subscription.nonce >= nonce_offset {
                                let check_nonce = subscription.nonce - nonce_offset;
                                
                                // Derive the expected request PDA
                                let (request_pda, _) = Pubkey::find_program_address(
                                    &[
                                        b"request",
                                        sub_pubkey.as_ref(),
                                        check_nonce.to_le_bytes().as_ref(),
                                    ],
                                    &self.program_id
                                );
                                
                                println!("Checking derived request account for subscription {} with nonce {}: {}", 
                                    sub_pubkey, check_nonce, request_pda);
                                
                                // Check if the request account exists
                                match self.rpc_client.get_account(&request_pda) {
                                    Ok(request_account) => {
                                        // Skip discriminator 
                                        if request_account.data.len() <= 8 {
                                            println!("Request account data too short: {}", request_account.data.len());
                                            continue;
                                        }
                                        
                                        // Check discriminator
                                        if &request_account.data[0..8] != b"REQUEST\0" {
                                            println!("Invalid discriminator for derived request");
                                            continue;
                                        }
                                        
                                        // Try to deserialize request
                                        match RandomnessRequest::try_from_slice(&request_account.data[8..]) {
                                            Ok(request) => {
                                                if request.status == RequestStatus::Pending {
                                                    println!("Found new pending VRF request from derived path: {}", request_pda);
                                                    if let Err(e) = self.fulfill_request(&request_pda, request).await {
                                                        eprintln!("Failed to fulfill derived VRF request {}: {}", request_pda, e);
                                                    } else {
                                                        println!("Successfully fulfilled derived VRF request {}", request_pda);
                                                    }
                                                } else {
                                                    println!("Derived request not pending, status: {:?}", request.status);
                                                }
                                            },
                                            Err(e) => {
                                                println!("Failed to deserialize derived request: {}", e);
                                            }
                                        }
                                    },
                                    Err(e) => {
                                        if !e.to_string().contains("AccountNotFound") {
                                            println!("Error checking derived request account: {}", e);
                                        }
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => {
                        println!("Failed to deserialize subscription: {}", e);
                    }
                }
            }
        }
        
        // Process the original request accounts found by discriminator
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
        println!("Generating VRF proof for request: {}", request_pubkey);
        
        // Generate VRF proof
        let proof = match safely_generate_vrf_proof(&self.vrf_keypair, &request.seed) {
            Some(p) => p,
            None => {
                error!("Failed to generate VRF proof for request {}", request_pubkey);
                return Ok(());
            }
        };
        let proof_bytes = proof.to_bytes();
        let output = proof.to_hash();
        let public_key_bytes = self.vrf_keypair.pk.as_ref().to_vec();
        
        println!("Generated VRF output: {}", hex::encode(&output));
        println!("VRF proof: {}", hex::encode(&proof_bytes));
        
        // Derive VRF result PDA
        let (vrf_result, _bump) = Pubkey::find_program_address(
            &[b"vrf_result", request_pubkey.as_ref()],
            &self.program_id,
        );
        
        println!("VRF result account: {}", vrf_result);
        
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
                AccountMeta::new(request_pubkey.clone(), false),
                AccountMeta::new(vrf_result, false),
                AccountMeta::new_readonly(request.requester, false),
                AccountMeta::new(request.subscription, false),
                AccountMeta::new_readonly(system_program::id(), false),
                AccountMeta::new_readonly(request.requester, false),
            ],
            data: fulfill_ix_data,
        };
        
        // Create and send transaction with base64 encoding
        let recent_blockhash = self.rpc_client.get_latest_blockhash()?;
        
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.oracle_keypair.pubkey()),
            &[&self.oracle_keypair],
            recent_blockhash,
        );
        
        println!("Sending transaction to fulfill VRF request...");
        
        // Send transaction with preflight checks and commitment
        let signature = self.rpc_client.send_and_confirm_transaction_with_spinner(&transaction)?;
        
        println!("VRF request fulfilled successfully!");
        println!("Transaction signature: {}", signature);
        
        Ok(())
    }

    // Helper method to recreate the VRF keypair since it doesn't implement Clone
    fn clone_vrf_keypair(&self) -> Result<ECVRFKeyPair, Box<dyn Error>> {
        // Extract the private and public key bytes from the existing keypair
        let sk_bytes = self.vrf_keypair.sk.as_ref();
        let pk_bytes = self.vrf_keypair.pk.as_ref();
        
        // Combine them into a single buffer
        let mut combined = Vec::with_capacity(sk_bytes.len() + pk_bytes.len());
        combined.extend_from_slice(sk_bytes);
        combined.extend_from_slice(pk_bytes);
        
        // Create a new keypair from these bytes and handle the Result properly
        Ok(ECVRFKeyPair::from_bytes(&combined)?)
    }
}

/// Load or create a new VRF keypair
pub fn load_or_create_keypair(keypair_path: &Path) -> Result<ECVRFKeyPair, Box<dyn Error>> {
    println!("Loading VRF keypair from: {:?}", keypair_path);
    
    // If the file exists, try to load it
    if keypair_path.exists() {
        let mut file = File::open(keypair_path)?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        
        // Try parsing the JSON format
        if let Ok(json_bytes) = serde_json::from_str::<Vec<u8>>(&contents) {
            println!("Loaded VRF keypair from JSON bytes format");
            return Ok(ECVRFKeyPair::from_bytes(&json_bytes)?);
        }
        
        // Try parsing as a raw binary string
        if let Ok(key_bytes) = hex::decode(contents.trim()) {
            println!("Loaded VRF keypair from hex string format");
            return Ok(ECVRFKeyPair::from_bytes(&key_bytes)?);
        }
        
        // If all parsing attempts fail, return an error
        return Err(format!("Failed to parse VRF keypair file at {:?}", keypair_path).into());
    }
    
    println!("VRF keypair not found, generating a new one");
    
    // Generate a new keypair
    let mut rng = rand::thread_rng();
    let keypair = ECVRFKeyPair::generate(&mut rng);
    
    // Save the keypair - combine public and private key bytes
    let mut file = File::create(keypair_path)?;
    
    // Save pk and sk as a combined array
    let mut combined = Vec::with_capacity(64);
    
    // Add private key bytes - for mangekyou library, we'll need to manually extract bytes
    let sk_ref = keypair.sk.as_ref();
    combined.extend_from_slice(sk_ref);
    
    // Add public key bytes
    let pk_ref = keypair.pk.as_ref();
    combined.extend_from_slice(pk_ref);
    
    // Save as a JSON array
    let json_bytes = serde_json::to_string(&combined)?;
    file.write_all(json_bytes.as_bytes())?;
    
    println!("Generated and saved new VRF keypair");
    Ok(keypair)
}

/// Safely generate a VRF proof for the given request
fn safely_generate_vrf_proof(vrf_keypair: &ECVRFKeyPair, seed: &[u8]) -> Option<ECVRFProof> {
    // Add defensive code to handle potential key issues
    trace!("Attempting to generate VRF proof with seed: {:?}", seed);
    
    // Try to generate the proof in a way that catches potential panics
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        vrf_keypair.prove(seed)
    }));
    
    match result {
        Ok(proof) => {
            trace!("Successfully generated VRF proof");
            Some(proof)
        },
        Err(e) => {
            error!("Failed to generate VRF proof: {:?}", e);
            
            // Try to recover what went wrong for better diagnostics
            if let Some(error_str) = e.downcast_ref::<String>() {
                error!("Error message: {}", error_str);
            } else if let Some(error_str) = e.downcast_ref::<&str>() {
                error!("Error message: {}", error_str);
            }
            
            warn!("Checking if VRF keypair is valid...");
            // Check if the public key is valid
            if !is_valid_vrf_keypair(vrf_keypair) {
                error!("VRF keypair appears to be invalid. Please generate a new VRF keypair");
            }
            
            None
        }
    }
}

/// Check if the VRF keypair appears to be valid
fn is_valid_vrf_keypair(keypair: &ECVRFKeyPair) -> bool {
    // Basic check - are the keys non-zero?
    let pk_bytes = keypair.pk.as_ref();
    let sk_bytes = keypair.sk.as_ref();
    
    if pk_bytes.iter().all(|&b| b == 0) || sk_bytes.iter().all(|&b| b == 0) {
        return false;
    }
    
    // Try to derive a public key from the private key and check if it matches
    // This is a basic test - it doesn't fully validate the keypair
    let derived_keypair = ECVRFKeyPair::from(keypair.sk.clone());
    let derived_pk_bytes = derived_keypair.pk.as_ref();
    
    // Compare public keys
    pk_bytes == derived_pk_bytes
} 