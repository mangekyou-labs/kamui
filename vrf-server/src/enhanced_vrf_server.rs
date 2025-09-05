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
    crate::{
        instruction::VrfCoordinatorInstruction,
        state::{RandomnessRequest, RequestStatus, Subscription},
        cli_integration::{MangekyouCLI, VRFCliProof, CLIError},
    },
    std::{
        str::FromStr,
        error::Error,
        fs::File,
        io::{Write, Read},
        path::Path,
        collections::HashMap,
    },
    serde_json,
    log::{debug, error, info, trace, warn},
};

pub struct EnhancedVRFServer {
    /// RPC client for interacting with the Solana network
    rpc_client: RpcClient,
    /// VRF coordinator program ID
    program_id: Pubkey,
    /// Oracle keypair for signing transactions
    oracle_keypair: Keypair,
    /// CLI integration for proof generation
    cli: MangekyouCLI,
    /// VRF keypair data (secret_key, public_key)
    vrf_keypair_data: (String, String),
    /// Commitment level for transactions
    commitment: CommitmentConfig,
    /// Cache for processed requests to avoid duplicate processing
    processed_requests: HashMap<String, bool>,
}

impl EnhancedVRFServer {
    pub fn new(
        rpc_url: &str,
        program_id: &str,
        oracle_keypair: Keypair,
        cli_path: Option<String>,
    ) -> Result<Self, Box<dyn Error>> {
        let cli = MangekyouCLI::new(cli_path);
        
        // Ensure CLI is built
        cli.ensure_cli_built()
            .map_err(|e| format!("Failed to build CLI: {}", e))?;
        
        // Generate VRF keypair using CLI
        let vrf_keypair_data = cli.generate_keypair()
            .map_err(|e| format!("Failed to generate VRF keypair: {}", e))?;
        
        info!("Enhanced VRF Server initialized with:");
        info!("Oracle pubkey: {}", oracle_keypair.pubkey());
        info!("VRF public key: {}", vrf_keypair_data.1);
        info!("Program ID: {}", program_id);
        info!("RPC URL: {}", rpc_url);

        Ok(Self {
            rpc_client: RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            ),
            program_id: Pubkey::from_str(program_id)?,
            oracle_keypair,
            cli,
            vrf_keypair_data,
            commitment: CommitmentConfig::confirmed(),
            processed_requests: HashMap::new(),
        })
    }

    pub fn get_vrf_public_key(&self) -> &str {
        &self.vrf_keypair_data.1
    }

    pub fn get_vrf_secret_key(&self) -> &str {
        &self.vrf_keypair_data.0
    }

    /// Start the enhanced VRF server with real proof generation
    pub async fn run(&mut self) -> Result<(), Box<dyn Error>> {
        info!("🚀 Starting Enhanced VRF Server with Real CLI Integration...");
        info!("🔑 Using VRF Public Key: {}", self.get_vrf_public_key());
        
        // Start monitoring loop
        loop {
            match self.process_pending_requests().await {
                Ok(processed_count) => {
                    if processed_count > 0 {
                        info!("✅ Processed {} VRF requests", processed_count);
                    } else {
                        debug!("🔍 No pending requests found");
                    }
                }
                Err(e) => {
                    error!("❌ Error processing requests: {}", e);
                }
            }
            
            // Wait before next polling cycle
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        }
    }

    /// Process all pending VRF requests
    async fn process_pending_requests(&mut self) -> Result<usize, Box<dyn Error>> {
        debug!("🔍 Scanning for pending VRF requests...");
        
        let request_accounts = self.fetch_request_accounts().await?;
        let mut processed_count = 0;
        
        for (pubkey, account) in request_accounts {
            let pubkey_str = pubkey.to_string();
            
            // Skip if already processed
            if self.processed_requests.contains_key(&pubkey_str) {
                continue;
            }
            
            debug!("📝 Processing request account: {}", pubkey);
            
            // Parse request data
            if account.data.len() < 8 {
                warn!("⚠️  Account data too short: {} bytes", account.data.len());
                continue;
            }
            
            // Check discriminator
            let discriminator = &account.data[0..8];
            if discriminator != b"REQUEST\0" {
                debug!("ℹ️  Skipping account with invalid discriminator");
                continue;
            }
            
            // Deserialize request
            match RandomnessRequest::try_from_slice(&account.data[8..]) {
                Ok(request) => {
                    if request.status == RequestStatus::Pending {
                        info!("🎲 Found new pending VRF request: {}", pubkey);
                        
                        match self.fulfill_request_with_real_proof(&pubkey, &request).await {
                            Ok(_) => {
                                info!("✅ Successfully fulfilled VRF request {}", pubkey);
                                self.processed_requests.insert(pubkey_str, true);
                                processed_count += 1;
                            }
                            Err(e) => {
                                error!("❌ Failed to fulfill VRF request {}: {}", pubkey, e);
                            }
                        }
                    } else {
                        debug!("ℹ️  Request {} not pending, status: {:?}", pubkey, request.status);
                    }
                }
                Err(e) => {
                    warn!("⚠️  Failed to deserialize request {}: {}", pubkey, e);
                }
            }
        }
        
        Ok(processed_count)
    }

    /// Fetch all request accounts from the program
    async fn fetch_request_accounts(&self) -> Result<Vec<(Pubkey, solana_client::rpc_response::RpcKeyedAccount)>, Box<dyn Error>> {
        let config = RpcProgramAccountsConfig {
            filters: Some(vec![
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(0, b"REQUEST\0".to_vec())),
            ]),
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                commitment: Some(self.commitment),
                ..RpcAccountInfoConfig::default()
            },
            ..RpcProgramAccountsConfig::default()
        };

        let accounts = self.rpc_client.get_program_accounts_with_config(&self.program_id, config)?;
        Ok(accounts.into_iter().map(|(pubkey, account)| {
            (pubkey, solana_client::rpc_response::RpcKeyedAccount {
                pubkey: pubkey.to_string(),
                account,
            })
        }).collect())
    }

    /// Fulfill a VRF request using real cryptographic proof generation
    async fn fulfill_request_with_real_proof(
        &self,
        request_pubkey: &Pubkey,
        request: &RandomnessRequest,
    ) -> Result<(), Box<dyn Error>> {
        info!("🎯 Generating REAL VRF proof for request: {}", request_pubkey);
        info!("🌱 Seed: {}", hex::encode(&request.seed));
        
        // Generate real VRF proof using Mangekyou CLI
        let proof_result = self.cli.generate_proof(
            &self.vrf_keypair_data.0, // secret key
            &request.seed,
        ).map_err(|e| format!("CLI proof generation failed: {}", e))?;
        
        info!("🎲 Generated VRF output: {}", proof_result.output);
        info!("🔐 Generated VRF proof: {}", proof_result.proof);
        
        // Verify the proof before submitting
        let is_valid = self.cli.verify_proof(
            &proof_result.proof,
            &proof_result.output,
            &proof_result.public_key,
            &request.seed,
        ).map_err(|e| format!("Proof verification failed: {}", e))?;
        
        if !is_valid {
            return Err("Generated proof failed verification".into());
        }
        
        info!("✅ Proof verification successful");
        
        // Convert proof data to bytes
        let proof_bytes = hex::decode(&proof_result.proof)
            .map_err(|e| format!("Failed to decode proof hex: {}", e))?;
        
        let public_key_bytes = hex::decode(&proof_result.public_key)
            .map_err(|e| format!("Failed to decode public key hex: {}", e))?;
        
        // Derive VRF result PDA
        let (vrf_result, _bump) = Pubkey::find_program_address(
            &[b"vrf_result", request_pubkey.as_ref()],
            &self.program_id,
        );
        
        info!("📍 VRF result account: {}", vrf_result);
        
        // Create fulfill randomness instruction
        let fulfill_ix = VrfCoordinatorInstruction::FulfillRandomness {
            proof: proof_bytes,
            public_key: public_key_bytes,
        };
        
        let fulfill_ix_data = borsh::to_vec(&fulfill_ix)
            .map_err(|e| format!("Failed to serialize instruction: {}", e))?;
        
        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.oracle_keypair.pubkey(), true),
                AccountMeta::new(*request_pubkey, false),
                AccountMeta::new(vrf_result, false),
                AccountMeta::new_readonly(request.requester, false),
                AccountMeta::new(request.subscription, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: fulfill_ix_data,
        };
        
        // Create and send transaction
        let recent_blockhash = self.rpc_client.get_latest_blockhash()
            .map_err(|e| format!("Failed to get blockhash: {}", e))?;
        
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.oracle_keypair.pubkey()),
            &[&self.oracle_keypair],
            recent_blockhash,
        );
        
        info!("📡 Submitting VRF fulfillment transaction...");
        
        // Submit transaction with retries
        let mut attempts = 0;
        const MAX_ATTEMPTS: usize = 3;
        
        while attempts < MAX_ATTEMPTS {
            match self.rpc_client.send_and_confirm_transaction(&transaction) {
                Ok(signature) => {
                    info!("🎉 VRF fulfillment transaction confirmed!");
                    info!("📜 Transaction signature: {}", signature);
                    return Ok(());
                }
                Err(e) => {
                    attempts += 1;
                    warn!("⚠️  Transaction attempt {} failed: {}", attempts, e);
                    
                    if attempts >= MAX_ATTEMPTS {
                        return Err(format!("Transaction failed after {} attempts: {}", MAX_ATTEMPTS, e).into());
                    }
                    
                    // Wait before retry
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
        }
        
        Ok(())
    }

    /// Get server statistics
    pub fn get_stats(&self) -> HashMap<String, serde_json::Value> {
        let mut stats = HashMap::new();
        stats.insert("processed_requests".to_string(), 
            serde_json::Value::Number(serde_json::Number::from(self.processed_requests.len())));
        stats.insert("vrf_public_key".to_string(), 
            serde_json::Value::String(self.get_vrf_public_key().to_string()));
        stats.insert("oracle_pubkey".to_string(), 
            serde_json::Value::String(self.oracle_keypair.pubkey().to_string()));
        stats.insert("program_id".to_string(), 
            serde_json::Value::String(self.program_id.to_string()));
        stats
    }

    /// Test the VRF proof generation pipeline
    pub async fn test_proof_pipeline(&self) -> Result<(), Box<dyn Error>> {
        info!("🧪 Testing VRF proof generation pipeline...");
        
        let test_seed = b"test_seed_for_pipeline_verification";
        
        // Generate proof
        let proof_result = self.cli.generate_proof(&self.vrf_keypair_data.0, test_seed)?;
        info!("✅ Test proof generated successfully");
        
        // Verify proof
        let is_valid = self.cli.verify_proof(
            &proof_result.proof,
            &proof_result.output,
            &proof_result.public_key,
            test_seed,
        )?;
        
        if is_valid {
            info!("🎉 Test proof verification successful - pipeline is working!");
        } else {
            return Err("Test proof verification failed".into());
        }
        
        Ok(())
    }
}
