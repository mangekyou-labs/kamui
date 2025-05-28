use {
    solana_client::rpc_client::RpcClient,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        message::Message,
        pubkey::Pubkey,
        system_program,
    },
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::{Keypair, Signer},
        transaction::Transaction,
    },
    std::{str::FromStr, fs::File, io::Read, time::Duration},
    mangekyou::{
        kamui_vrf::{
            ecvrf::ECVRFKeyPair,
            VRFKeyPair,
            VRFProof,
        },
    },
    kamui_program::instruction::VerifyVrfInput,
    rand::thread_rng,
    hex,
    tokio::time::sleep,
    anchor_lang::{prelude::*, InstructionData, ToAccountMetas},
    borsh::{BorshSerialize, BorshDeserialize},
};

// VRF Server simulation for generating real randomness
pub struct VRFServerSimulator {
    vrf_keypair: ECVRFKeyPair,
    rpc_client: RpcClient,
}

impl VRFServerSimulator {
    pub fn new(rpc_url: &str) -> Self {
        let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
        let rpc_client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
        
        println!("VRF Server initialized with public key: {}", hex::encode(vrf_keypair.pk.as_ref()));
        
        Self {
            vrf_keypair,
            rpc_client,
        }
    }
    
    pub fn generate_randomness(&self, seed: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let (output, proof) = self.vrf_keypair.output(seed);
        let proof_bytes = proof.to_bytes();
        let public_key_bytes = self.vrf_keypair.pk.as_ref().to_vec();
        
        println!("Generated VRF randomness:");
        println!("  Seed: {}", hex::encode(seed));
        println!("  Output: {}", hex::encode(&output));
        println!("  Proof: {}", hex::encode(&proof_bytes));
        println!("  Public Key: {}", hex::encode(&public_key_bytes));
        
        (output, proof_bytes, public_key_bytes)
    }
}

// Instruction data structures for kamui-vrf program
#[derive(BorshSerialize, BorshDeserialize)]
pub struct CreateEnhancedSubscriptionData {
    pub min_balance: u64,
    pub confirmations: u8,
    pub max_requests: u16,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RequestRandomnessData {
    pub seed: [u8; 32],
    pub callback_data: Vec<u8>,
    pub num_words: u32,
    pub minimum_confirmations: u8,
    pub callback_gas_limit: u64,
    pub pool_id: u8,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct FulfillRandomnessData {
    pub proof: Vec<u8>,
    pub public_key: Vec<u8>,
    pub request_id: [u8; 32],
    pub pool_id: u8,
    pub request_index: u32,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn test_enhanced_vrf_system_devnet() {
    println!("🚀 Starting Enhanced VRF System Test on Devnet");
    
    // Connect to devnet
    let rpc_url = "https://api.devnet.solana.com";
    let rpc_client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());

    // Program IDs from Anchor.toml
    let kamui_vrf_program_id = Pubkey::from_str("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a").unwrap();
    let kamui_vrf_consumer_program_id = Pubkey::from_str("2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE").unwrap();
    let verifier_program_id = Pubkey::from_str("4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y").unwrap();

    // Load keypair from file
    let mut keypair_file = File::open("test-keypair.json").expect("Failed to open test-keypair.json");
    let mut keypair_data = String::new();
    keypair_file.read_to_string(&mut keypair_data).expect("Failed to read test-keypair.json");
    let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data).expect("Failed to parse keypair JSON");
    let payer = Keypair::from_bytes(&keypair_bytes).expect("Failed to create keypair from bytes");
    
    println!("Using keypair with pubkey: {}", payer.pubkey());
    
    // Verify the balance
    let balance = rpc_client.get_balance(&payer.pubkey()).expect("Failed to get balance");
    println!("Current balance: {} SOL", balance as f64 / 1_000_000_000.0);

    if balance < 100_000_000 { // 0.1 SOL minimum
        panic!("Account needs at least 0.1 SOL balance for testing");
    }

    // Initialize VRF Server Simulator
    let vrf_server = VRFServerSimulator::new(rpc_url);
    
    // Test 1: Verify VRF proof with verifier program
    println!("\n📋 Test 1: Verifying VRF proof with verifier program");
    test_vrf_verification(&rpc_client, &verifier_program_id, &payer, &vrf_server).await;
    
    // Test 2: Create enhanced subscription
    println!("\n📋 Test 2: Creating enhanced subscription");
    let subscription_pda = test_create_subscription(&rpc_client, &kamui_vrf_program_id, &payer).await;
    
    // Test 3: Request randomness through coordinator
    println!("\n📋 Test 3: Requesting randomness through coordinator");
    test_request_randomness(&rpc_client, &kamui_vrf_program_id, &payer, &subscription_pda, &vrf_server).await;
    
    // Test 4: Consumer program integration
    println!("\n📋 Test 4: Testing consumer program integration");
    test_consumer_integration(&rpc_client, &kamui_vrf_consumer_program_id, &payer, &vrf_server).await;
    
    println!("\n✅ All Enhanced VRF System Tests Completed Successfully!");
}

async fn test_vrf_verification(
    rpc_client: &RpcClient,
    verifier_program_id: &Pubkey,
    payer: &Keypair,
    vrf_server: &VRFServerSimulator,
) {
    let alpha_string = b"Enhanced VRF Test - Verification";
    let (output, proof_bytes, public_key_bytes) = vrf_server.generate_randomness(alpha_string);
    
    // Create the instruction data
    let verify_input = VerifyVrfInput {
        alpha_string: alpha_string.to_vec(),
        proof_bytes,
        public_key_bytes,
    };

    let instruction = Instruction::new_with_borsh(
        *verifier_program_id,
        &verify_input,
        vec![AccountMeta::new(payer.pubkey(), true)],
    );

    // Send transaction
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[payer], recent_blockhash);

    println!("Sending VRF verification transaction...");
    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to send and confirm VRF verification transaction");

    println!("✅ VRF Verification successful!");
    println!("Signature: {}", signature);
    println!("View: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
}

async fn test_create_subscription(
    rpc_client: &RpcClient,
    kamui_vrf_program_id: &Pubkey,
    payer: &Keypair,
) -> Pubkey {
    // Derive subscription PDA
    let (subscription_pda, _bump) = Pubkey::find_program_address(
        &[b"subscription", payer.pubkey().as_ref()],
        kamui_vrf_program_id,
    );
    
    println!("Subscription PDA: {}", subscription_pda);
    
    // Check if subscription already exists
    match rpc_client.get_account(&subscription_pda) {
        Ok(_) => {
            println!("✅ Subscription already exists, skipping creation");
            return subscription_pda;
        }
        Err(_) => {
            println!("Creating new subscription...");
        }
    }
    
    // Create subscription instruction data
    let create_subscription_data = CreateEnhancedSubscriptionData {
        min_balance: 1_000_000_000, // 1 SOL
        confirmations: 1,
        max_requests: 100,
    };
    
    // Create instruction discriminator (first 8 bytes of sha256("global:create_enhanced_subscription"))
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:create_enhanced_subscription").to_bytes()[..8]);
    
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&discriminator);
    instruction_data.extend_from_slice(&create_subscription_data.try_to_vec().unwrap());
    
    let instruction = Instruction::new_with_bytes(
        *kamui_vrf_program_id,
        &instruction_data,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(subscription_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    );

    // Send transaction
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[payer], recent_blockhash);

    println!("Sending create subscription transaction...");
    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to send and confirm create subscription transaction");

    println!("✅ Subscription created successfully!");
    println!("Signature: {}", signature);
    println!("View: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
    
    subscription_pda
}

async fn test_request_randomness(
    rpc_client: &RpcClient,
    kamui_vrf_program_id: &Pubkey,
    payer: &Keypair,
    subscription_pda: &Pubkey,
    vrf_server: &VRFServerSimulator,
) {
    // Generate a unique seed for this request
    let mut seed = [0u8; 32];
    seed[..8].copy_from_slice(&rand::random::<u64>().to_le_bytes());
    
    println!("Requesting randomness with seed: {}", hex::encode(&seed));
    
    // Derive request PDA
    let (request_pda, _bump) = Pubkey::find_program_address(
        &[b"request", payer.pubkey().as_ref(), &seed],
        kamui_vrf_program_id,
    );
    
    println!("Request PDA: {}", request_pda);
    
    // Create request randomness instruction data
    let request_data = RequestRandomnessData {
        seed,
        callback_data: vec![1, 2, 3, 4], // Sample callback data
        num_words: 1,
        minimum_confirmations: 1,
        callback_gas_limit: 100_000,
        pool_id: 0,
    };
    
    // Create instruction discriminator
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:request_randomness").to_bytes()[..8]);
    
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&discriminator);
    instruction_data.extend_from_slice(&request_data.try_to_vec().unwrap());
    
    let instruction = Instruction::new_with_bytes(
        *kamui_vrf_program_id,
        &instruction_data,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(*subscription_pda, false),
            AccountMeta::new(request_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    );

    // Send transaction
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[payer], recent_blockhash);

    println!("Sending request randomness transaction...");
    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to send and confirm request randomness transaction");

    println!("✅ Randomness request submitted successfully!");
    println!("Signature: {}", signature);
    println!("View: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
    
    // Wait a bit for the request to be processed
    sleep(Duration::from_secs(2)).await;
    
    // Now fulfill the request with real VRF randomness
    fulfill_randomness_request(rpc_client, kamui_vrf_program_id, payer, &request_pda, &seed, vrf_server).await;
}

async fn fulfill_randomness_request(
    rpc_client: &RpcClient,
    kamui_vrf_program_id: &Pubkey,
    payer: &Keypair,
    request_pda: &Pubkey,
    seed: &[u8; 32],
    vrf_server: &VRFServerSimulator,
) {
    println!("Fulfilling randomness request...");
    
    // Generate VRF proof for the seed
    let (output, proof_bytes, public_key_bytes) = vrf_server.generate_randomness(seed);
    
    // Create request ID from seed
    let request_id = *seed;
    
    // Create fulfill randomness instruction data
    let fulfill_data = FulfillRandomnessData {
        proof: proof_bytes,
        public_key: public_key_bytes,
        request_id,
        pool_id: 0,
        request_index: 0,
    };
    
    // Create instruction discriminator
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:fulfill_randomness").to_bytes()[..8]);
    
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&discriminator);
    instruction_data.extend_from_slice(&fulfill_data.try_to_vec().unwrap());
    
    // Derive VRF result PDA
    let (vrf_result_pda, _bump) = Pubkey::find_program_address(
        &[b"vrf_result", payer.pubkey().as_ref()],
        kamui_vrf_program_id,
    );
    
    let instruction = Instruction::new_with_bytes(
        *kamui_vrf_program_id,
        &instruction_data,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(*request_pda, false),
            AccountMeta::new(vrf_result_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
    );

    // Send transaction
    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[payer], recent_blockhash);

    println!("Sending fulfill randomness transaction...");
    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to send and confirm fulfill randomness transaction");

    println!("✅ Randomness fulfilled successfully!");
    println!("Signature: {}", signature);
    println!("View: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
    println!("VRF Output: {}", hex::encode(&output));
}

async fn test_consumer_integration(
    rpc_client: &RpcClient,
    consumer_program_id: &Pubkey,
    payer: &Keypair,
    vrf_server: &VRFServerSimulator,
) {
    println!("Testing consumer program integration...");
    
    // Derive game state PDA for consumer program
    let (game_state_pda, game_bump) = Pubkey::find_program_address(
        &[b"game", payer.pubkey().as_ref()],
        consumer_program_id,
    );
    
    println!("Game State PDA: {}", game_state_pda);
    
    // Check if game state already exists
    match rpc_client.get_account(&game_state_pda) {
        Ok(_) => {
            println!("✅ Game state already exists, skipping initialization");
        }
        Err(_) => {
            // Initialize game state
            println!("Initializing game state...");
            
            let mut discriminator = [0u8; 8];
            discriminator.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:initialize").to_bytes()[..8]);
            
            let mut instruction_data = Vec::new();
            instruction_data.extend_from_slice(&discriminator);
            instruction_data.push(game_bump);
            
            let instruction = Instruction::new_with_bytes(
                *consumer_program_id,
                &instruction_data,
                vec![
                    AccountMeta::new(payer.pubkey(), true),
                    AccountMeta::new(game_state_pda, false),
                    AccountMeta::new_readonly(system_program::ID, false),
                ],
            );

            let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
            let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
            let mut transaction = Transaction::new_unsigned(message);
            transaction.sign(&[payer], recent_blockhash);

            let signature = rpc_client
                .send_and_confirm_transaction_with_spinner(&transaction)
                .expect("Failed to initialize game state");

            println!("✅ Game state initialized!");
            println!("Signature: {}", signature);
        }
    }
    
    // Generate real randomness and consume it
    let seed = b"consumer_test_seed_12345678901234567890123456789012";
    let (output, _proof_bytes, _public_key_bytes) = vrf_server.generate_randomness(seed);
    
    // Use the VRF output as randomness for the consumer
    let randomness_bytes = if output.len() >= 64 {
        output[..64].to_vec()
    } else {
        let mut padded = output.clone();
        padded.resize(64, 0);
        padded
    };
    
    println!("Consuming randomness: {}", hex::encode(&randomness_bytes));
    
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:consume_randomness").to_bytes()[..8]);
    
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&discriminator);
    instruction_data.extend_from_slice(&(randomness_bytes.len() as u32).to_le_bytes());
    instruction_data.extend_from_slice(&randomness_bytes);
    
    let instruction = Instruction::new_with_bytes(
        *consumer_program_id,
        &instruction_data,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(game_state_pda, false),
        ],
    );

    let recent_blockhash = rpc_client.get_latest_blockhash().expect("Failed to get recent blockhash");
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &recent_blockhash);
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[payer], recent_blockhash);

    println!("Sending consume randomness transaction...");
    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to consume randomness");

    println!("✅ Randomness consumed successfully!");
    println!("Signature: {}", signature);
    println!("View: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
} 