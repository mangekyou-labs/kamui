use {
    mangekyou::{
        ecvrf::{ECVRFKeyPair, ECVRFProof},
        VRFKeyPair, VRFProof,
    },
    serde_json,
    std::collections::HashMap,
};

fn main() {
    println!("🔑 Generating REAL ECVRF proof for TypeScript test...");

    // Use the EXACT same alpha string as the working devnet_test.rs
    let alpha_string = "Hello, world!";
    let alpha_bytes = alpha_string.as_bytes();

    println!(
        "🌱 Alpha string: \"{}\" ({} bytes)",
        alpha_string,
        alpha_bytes.len()
    );

    // Generate a real ECVRF keypair
    let keypair = ECVRFKeyPair::generate();
    let public_key_bytes = keypair.public_key().to_bytes();

    println!("🔑 Generated ECVRF keypair");
    println!("🔑 Public key: {}", hex::encode(&public_key_bytes));

    // Generate the real ECVRF proof
    let proof = keypair.prove(alpha_bytes);
    let proof_bytes = proof.to_bytes();

    println!("🎲 Generated REAL ECVRF proof");
    println!("🎲 Proof length: {} bytes", proof_bytes.len());
    println!("🎲 Proof: {}", hex::encode(&proof_bytes));

    // Verify the proof works
    let is_valid = keypair.public_key().verify(&proof, alpha_bytes);
    println!(
        "✅ Proof verification: {}",
        if is_valid { "VALID" } else { "INVALID" }
    );

    // Create JSON output for TypeScript
    let mut output = HashMap::new();
    output.insert("alpha_string", alpha_string.to_string());
    output.insert("alpha_bytes", hex::encode(alpha_bytes));
    output.insert("proof_bytes", hex::encode(&proof_bytes));
    output.insert("public_key_bytes", hex::encode(&public_key_bytes));
    output.insert("proof_length", proof_bytes.len().to_string());
    output.insert("public_key_length", public_key_bytes.len().to_string());
    output.insert("alpha_length", alpha_bytes.len().to_string());

    // Output as JSON for TypeScript to consume
    let json_output = serde_json::to_string_pretty(&output).unwrap();
    println!("\n📋 JSON OUTPUT FOR TYPESCRIPT:");
    println!("{}", json_output);

    // Also save to file
    std::fs::write("real_vrf_proof.json", json_output).expect("Failed to write JSON file");
    println!("\n💾 Saved to real_vrf_proof.json");

    println!("\n🎯 Use this REAL ECVRF proof in your TypeScript test!");
}
