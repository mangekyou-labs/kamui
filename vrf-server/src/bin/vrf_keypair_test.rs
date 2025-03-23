use clap::{Command, Arg};
use mangekyou::kamui_vrf::ecvrf::ECVRFKeyPair;
use mangekyou::kamui_vrf::{VRFProof, VRFKeyPair};
use std::fs::File;
use std::io::Read;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse command line arguments
    let matches = Command::new("VRF Keypair Test")
        .version("1.0")
        .author("Kamui Team")
        .about("Test if a VRF keypair can safely generate proofs")
        .arg(
            Arg::new("keypair")
                .long("keypair")
                .value_name("FILE")
                .help("VRF keypair file")
                .required(true),
        )
        .arg(
            Arg::new("message")
                .long("message")
                .value_name("STRING")
                .help("Test message to generate a proof for")
                .default_value("test"),
        )
        .get_matches();

    let keypair_file = matches.get_one::<String>("keypair").unwrap();
    let message = matches.get_one::<String>("message").unwrap().as_bytes();
    
    println!("Testing VRF keypair from file: {}", keypair_file);
    
    // Load the keypair
    let vrf_keypair = load_vrf_keypair(keypair_file)?;
    
    // Try to generate a proof
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        vrf_keypair.prove(message)
    }));
    
    match result {
        Ok(proof) => {
            let output = proof.to_hash();
            println!("Successfully generated proof and output:");
            println!("Output: {}", hex::encode(&output));
            println!("Proof: {}", hex::encode(&proof.to_bytes()));
            println!("Keypair is valid and working correctly");
            Ok(())
        },
        Err(e) => {
            eprintln!("Failed to generate proof: {:?}", e);
            eprintln!("Keypair may be invalid or corrupted");
            Err("VRF keypair test failed - could not generate proof".into())
        }
    }
}

fn load_vrf_keypair(keypair_file: &str) -> Result<ECVRFKeyPair, Box<dyn std::error::Error>> {
    let path = Path::new(keypair_file);
    if !path.exists() {
        return Err(format!("VRF keypair file not found: {}", keypair_file).into());
    }

    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;

    let keypair = ECVRFKeyPair::from_bytes(&bytes)?;
    
    // Basic validation
    if keypair.pk.as_ref().iter().all(|&b| b == 0) || keypair.sk.as_ref().iter().all(|&b| b == 0) {
        return Err("Invalid VRF keypair: contains all zeros".into());
    }
    
    Ok(keypair)
} 