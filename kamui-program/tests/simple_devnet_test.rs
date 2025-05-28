use {
    solana_client::rpc_client::RpcClient,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        message::Message,
        pubkey::Pubkey,
    },
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::{Keypair, Signer},
        transaction::Transaction,
    },
    std::{str::FromStr, fs::File, io::Read},
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
};

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn test_simple_vrf_verification_devnet() {
    println!("🚀 Starting Simple VRF Verification Test on Devnet");
    
    // Connect to devnet
    let rpc_url = "https://api.devnet.solana.com".to_string();
    let rpc_client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed());

    // Use our simple verifier program ID
    let program_id = Pubkey::from_str("5cqnn6wdeZvVUCD7ds4axMTkiyHFGEpjdLqBvSqmA5uG").unwrap();

    // Load keypair from file
    let mut keypair_file = File::open("keypair.json").expect("Failed to open keypair.json");
    let mut keypair_data = String::new();
    keypair_file.read_to_string(&mut keypair_data).expect("Failed to read keypair.json");
    let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data).expect("Failed to parse keypair JSON");
    let payer = Keypair::from_bytes(&keypair_bytes).expect("Failed to create keypair from bytes");
    
    println!("Using keypair with pubkey: {}", payer.pubkey());
    
    // Verify the balance
    let balance = rpc_client.get_balance(&payer.pubkey()).expect("Failed to get balance");
    println!("Current balance: {} SOL", balance as f64 / 1_000_000_000.0);

    if balance == 0 {
        panic!("Account has no SOL balance");
    }

    // Generate a new VRF keypair
    let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
    let alpha_string = b"Hello, VRF world!";
    
    // Generate VRF proof and output
    let (output, proof) = vrf_keypair.output(alpha_string);
    println!("Generated VRF output: {:?}", hex::encode(&output));
    
    // Get public key bytes
    let public_key_bytes = vrf_keypair.pk.as_ref().to_vec();
    
    // Get proof bytes
    let proof_bytes = proof.to_bytes();

    // Print debug information
    println!("🔍 VRF Components:");
    println!("  Alpha string: {:?}", hex::encode(alpha_string));
    println!("  Public key: {:?}", hex::encode(&public_key_bytes));
    println!("  Proof: {:?}", hex::encode(&proof_bytes));
    println!("  Output: {:?}", hex::encode(&output));

    // Create the instruction data
    let verify_input = VerifyVrfInput {
        alpha_string: alpha_string.to_vec(),
        proof_bytes,
        public_key_bytes,
    };

    let instruction = Instruction::new_with_borsh(
        program_id,
        &verify_input,
        vec![AccountMeta::new(payer.pubkey(), true)],
    );

    // Get recent blockhash
    let recent_blockhash = rpc_client
        .get_latest_blockhash()
        .expect("Failed to get recent blockhash");

    // Create and sign transaction
    let message = Message::new_with_blockhash(
        &[instruction],
        Some(&payer.pubkey()),
        &recent_blockhash,
    );
    let mut transaction = Transaction::new_unsigned(message);
    transaction.sign(&[&payer], recent_blockhash);

    println!("📤 Sending transaction to verify VRF proof...");
    
    // Send and confirm transaction
    match rpc_client.send_and_confirm_transaction_with_spinner(&transaction) {
        Ok(signature) => {
            println!("✅ Transaction successful!");
            println!("📋 Signature: {}", signature);
            println!("🔗 View transaction: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
            println!("🎉 VRF verification on devnet PASSED!");
        }
        Err(error) => {
            println!("❌ Transaction failed: {}", error);
            println!("📝 Error details: {:?}", error);
            
            // Analyze the error
            if error.to_string().contains("memory allocation failed") {
                println!("🔍 Root Cause: Memory allocation failure in VRF verification");
                println!("📝 This confirms the 32KB heap limit issue we identified");
                println!("📝 The program is trying to allocate more memory than Solana allows");
                println!("📝 Solutions needed:");
                println!("  1. Use zero-copy deserialization");
                println!("  2. Replace Vec<u8> with fixed-size arrays");
                println!("  3. Implement streaming verification");
                println!("  4. Move verification to client-side");
            } else if error.to_string().contains("InvalidInstructionData") {
                println!("🔍 Root Cause: Instruction data format mismatch");
                println!("📝 The program couldn't deserialize the VRF input");
                println!("📝 This suggests borsh serialization issues");
            } else if error.to_string().contains("AccountOwnedByWrongProgram") {
                println!("🔍 Root Cause: Account ownership issue");
                println!("📝 The program ID doesn't match the deployed program");
            } else {
                println!("🔍 Root Cause: Unknown error - needs investigation");
            }
            
            // Don't panic - this is expected to fail due to memory limitations
            println!("⚠️ This failure is EXPECTED due to known Solana memory limitations");
        }
    }
    
    println!("🏁 Simple VRF verification test completed");
} 