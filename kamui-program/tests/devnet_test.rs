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
            ecvrf::{ECVRFKeyPair, ECVRFProof},
            VRFKeyPair,
            VRFProof,
        },
    },
    kamui_program::instruction::VerifyVrfInput,
    rand::thread_rng,
    hex,
    serde_json,
    std::collections::HashMap,
};

// FIXED: Add function to generate and output real ECVRF proof for TypeScript
fn generate_real_vrf_proof_for_typescript() {
    println!("🔑 Generating REAL ECVRF proof for TypeScript test...");
    
    // Use the EXACT same alpha string as the working devnet_test.rs
    let alpha_string = "Hello, world!";
    let alpha_bytes = alpha_string.as_bytes();
    
    println!("🌱 Alpha string: \"{}\" ({} bytes)", alpha_string, alpha_bytes.len());
    
    // Generate a real ECVRF keypair
    let keypair = ECVRFKeyPair::generate(&mut thread_rng());
    let public_key_bytes = keypair.pk.as_ref().to_vec();
    
    println!("🔑 Generated ECVRF keypair");
    println!("🔑 Public key: {}", hex::encode(&public_key_bytes));
    
    // Generate the real ECVRF proof using the correct API
    let (output, proof) = keypair.output(alpha_bytes);
    let proof_bytes = proof.to_bytes();
    
    println!("🎲 Generated REAL ECVRF proof");
    println!("🎲 Proof length: {} bytes", proof_bytes.len());
    println!("🎲 Proof: {}", hex::encode(&proof_bytes));
    println!("🎲 Output: {}", hex::encode(&output));
    
    // Note: Local verification would require implementing the verify method
    println!("✅ Proof generated successfully (verification requires on-chain test)");
    
    // Create JSON output for TypeScript
    let mut output_map = HashMap::new();
    output_map.insert("alpha_string", alpha_string.to_string());
    output_map.insert("alpha_bytes", hex::encode(alpha_bytes));
    output_map.insert("proof_bytes", hex::encode(&proof_bytes));
    output_map.insert("public_key_bytes", hex::encode(&public_key_bytes));
    output_map.insert("vrf_output", hex::encode(&output));
    output_map.insert("proof_length", proof_bytes.len().to_string());
    output_map.insert("public_key_length", public_key_bytes.len().to_string());
    output_map.insert("alpha_length", alpha_bytes.len().to_string());
    
    // Output as JSON for TypeScript to consume
    let json_output = serde_json::to_string_pretty(&output_map).unwrap();
    println!("\n📋 JSON OUTPUT FOR TYPESCRIPT:");
    println!("{}", json_output);
    
    // Also save to file
    std::fs::write("real_vrf_proof.json", json_output).expect("Failed to write JSON file");
    println!("\n💾 Saved to real_vrf_proof.json");
    
    println!("\n🎯 Use this REAL ECVRF proof in your TypeScript test!");
}

#[tokio::test]
async fn test_vrf_verification_devnet() {
    // First generate the real VRF proof for TypeScript
    generate_real_vrf_proof_for_typescript();
    
    // Continue with the original test...
    let client = RpcClient::new("https://api.devnet.solana.com".to_string());

    // Use the deployed program ID
    let program_id = Pubkey::from_str("4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y").unwrap();

    // Load keypair from file
    let mut keypair_file = File::open("keypair.json").expect("Failed to open keypair.json");
    let mut keypair_data = String::new();
    keypair_file.read_to_string(&mut keypair_data).expect("Failed to read keypair.json");
    let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data).expect("Failed to parse keypair JSON");
    let payer = Keypair::from_bytes(&keypair_bytes).expect("Failed to create keypair from bytes");
    
    println!("Using keypair with pubkey: {}", payer.pubkey());
    
    // Verify the balance
    let balance = client.get_balance(&payer.pubkey()).expect("Failed to get balance");
    println!("Current balance: {} SOL", balance as f64 / 1_000_000_000.0);

    if balance == 0 {
        panic!("Account has no SOL balance");
    }

    // Generate a new VRF keypair
    let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
    let alpha_string = b"Hello, world!";
    
    // Generate VRF proof and output
    let (output, proof) = vrf_keypair.output(alpha_string);
    println!("Generated VRF output: {:?}", hex::encode(&output));
    
    // Get public key bytes
    let public_key_bytes = vrf_keypair.pk.as_ref().to_vec();
    
    // Get proof bytes and reformat to match the on-chain program's expected format (gamma || c || s)
    let proof_bytes = proof.to_bytes();
    
    // The proof bytes from kamui_vrf are in format gamma || c || s
    // Our program expects the same format, so we can use them directly
    let formatted_proof = proof_bytes.clone();

    // Print debug information
    println!("Proof components:");
    println!("  Gamma: {:?}", hex::encode(&proof_bytes[0..32]));
    println!("  Challenge: {:?}", hex::encode(&proof_bytes[32..48]));  // 16 bytes for challenge
    println!("  Scalar: {:?}", hex::encode(&proof_bytes[48..80]));
    println!("Complete proof: {:?}", hex::encode(&formatted_proof));
    println!("Public key: {:?}", hex::encode(&public_key_bytes));
    println!("Alpha string: {:?}", hex::encode(alpha_string));
    println!("VRF Output: {:?}", hex::encode(&output));

    // Create the instruction data
    let verify_input = VerifyVrfInput {
        alpha_string: alpha_string.to_vec(),
        proof_bytes: formatted_proof,
        public_key_bytes,
    };

    let instruction = Instruction::new_with_borsh(
        program_id,
        &verify_input,
        vec![AccountMeta::new(payer.pubkey(), true)],
    );

    // Get recent blockhash
    let recent_blockhash = client
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

    println!("Sending transaction to verify VRF proof...");
    
    // Send and confirm transaction
    let signature = client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .expect("Failed to send and confirm transaction");

    println!("Transaction successful!");
    println!("Signature: {}", signature);
    println!("View transaction: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
} 