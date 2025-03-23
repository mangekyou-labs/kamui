use {
    kamui_program::vrf_server::VRFServer,
    solana_sdk::{
        signature::{Keypair, read_keypair_file},
        signer::Signer,
    },
    mangekyou::kamui_vrf::{
        ecvrf::ECVRFKeyPair,
        VRFKeyPair,
        ecvrf::ECVRFPrivateKey,
    },
    std::{
        fs::{self, File},
        io::{Read, Write},
        error::Error,
        path::Path,
        str::FromStr,
    },
    tokio,
    rand::{thread_rng, Rng},
    clap::{Parser, ArgAction},
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the keypair file
    #[arg(short, long, default_value = "vrf-keypair.json")]
    keypair: String,

    /// Program ID of the VRF coordinator
    #[arg(short, long, default_value = "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D")]
    program_id: String,

    /// RPC URL for the Solana network
    #[arg(short, long, default_value = "https://api.devnet.solana.com")]
    rpc_url: String,

    /// WebSocket URL for the Solana network
    #[arg(short, long, default_value = "wss://api.devnet.solana.com")]
    ws_url: String,

    /// Log level (info, debug, trace)
    #[arg(short, long, default_value = "info")]
    log_level: String,
}

fn load_or_create_oracle_keypair() -> Result<Keypair, Box<dyn Error>> {
    let path = Path::new("oracle-keypair.json");
    if path.exists() {
        println!("Loading oracle keypair from {}", path.display());
        match read_keypair_file(path) {
            Ok(keypair) => {
                println!("Successfully loaded oracle keypair: {}", keypair.pubkey());
                Ok(keypair)
            },
            Err(e) => {
                println!("Error loading oracle keypair: {}, generating new one", e);
                let keypair = Keypair::new();
                let keypair_bytes = keypair.to_bytes().to_vec();
                let keypair_json = serde_json::to_string(&keypair_bytes)?;
                fs::write(path, keypair_json)?;
                println!("Generated new oracle keypair: {}", keypair.pubkey());
                Ok(keypair)
            }
        }
    } else {
        println!("Oracle keypair file not found, generating new one");
        let keypair = Keypair::new();
        let keypair_bytes = keypair.to_bytes().to_vec();
        let keypair_json = serde_json::to_string(&keypair_bytes)?;
        fs::write(path, keypair_json)?;
        println!("Generated new oracle keypair: {}", keypair.pubkey());
        Ok(keypair)
    }
}

fn load_or_create_vrf_keypair(keypair_path: &str) -> Result<ECVRFKeyPair, Box<dyn Error>> {
    let path = Path::new(keypair_path);
    if path.exists() {
        println!("Attempting to load VRF keypair from {}", path.display());
        let mut file = File::open(path)?;
        let mut keypair_bytes = Vec::new();
        file.read_to_end(&mut keypair_bytes)?;
        
        println!("Loaded keypair bytes, length: {}", keypair_bytes.len());
        
        // Try to parse as JSON first
        if let Ok(json_bytes) = serde_json::from_slice::<Vec<u8>>(&keypair_bytes) {
            println!("Parsed keypair as JSON array, length: {}", json_bytes.len());
            if json_bytes.len() == 32 {
                // Use the bytes directly as seed
                let mut seed = [0u8; 32];
                seed.copy_from_slice(&json_bytes);
                
                // Create a private key from the seed
                let sk = ECVRFPrivateKey::from_bytes(&seed)?;
                // Convert private key to keypair
                let vrf_keypair = ECVRFKeyPair::from(sk);
                println!("Successfully loaded VRF keypair from JSON: {}", hex::encode(vrf_keypair.pk.as_ref()));
                return Ok(vrf_keypair);
            }
        }
        
        // If not JSON or wrong length, try to use directly as seed if it's 32 bytes
        if keypair_bytes.len() == 32 {
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&keypair_bytes);
            
            // Create a private key from the seed
            let sk = ECVRFPrivateKey::from_bytes(&seed)?;
            // Convert private key to keypair
            let vrf_keypair = ECVRFKeyPair::from(sk);
            println!("Successfully loaded VRF keypair: {}", hex::encode(vrf_keypair.pk.as_ref()));
            return Ok(vrf_keypair);
        }
        
        println!("Invalid keypair format or length, generating new one");
    } else {
        println!("VRF keypair file not found, generating new one");
    }
    
    // Generate new keypair
    println!("Generating new VRF keypair");
    let mut rng = thread_rng();
    let vrf_keypair = ECVRFKeyPair::generate(&mut rng);
    println!("Generated new VRF keypair: {}", hex::encode(vrf_keypair.pk.as_ref()));
    
    // Save keypair to file - we'll save the private key bytes
    let sk_bytes = vrf_keypair.sk.as_ref().to_vec();
    let mut file = File::create(path)?;
    file.write_all(&sk_bytes)?;
    
    Ok(vrf_keypair)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Parse command line arguments
    let args = Args::parse();
    
    // Set up logging
    match args.log_level.as_str() {
        "debug" => std::env::set_var("RUST_LOG", "debug"),
        "trace" => std::env::set_var("RUST_LOG", "trace"),
        _ => std::env::set_var("RUST_LOG", "info"),
    }
    env_logger::init();

    println!("Starting VRF oracle server...");

    // Load or create keypairs
    let oracle_keypair = load_or_create_oracle_keypair()?;
    let vrf_keypair = load_or_create_vrf_keypair(&args.keypair)?;

    println!("Server initialized with:");
    println!("Oracle pubkey: {}", oracle_keypair.pubkey());
    println!("VRF pubkey: {}", hex::encode(vrf_keypair.pk.as_ref()));
    println!("Program ID: {}", args.program_id);
    println!("RPC URL: {}", args.rpc_url);
    println!("WebSocket URL: {}", args.ws_url);

    // Create VRF server
    let server = VRFServer::new(
        &args.rpc_url,
        &args.program_id,
        oracle_keypair,
        vrf_keypair,
    )?;

    // Run the server (this will handle both processing requests and monitoring events)
    if let Err(e) = server.run().await {
        eprintln!("Server error: {}", e);
    }

    Ok(())
} 