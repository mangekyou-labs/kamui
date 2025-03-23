use {
    vrf_server::vrf_server::VRFServer,
    solana_sdk::{
        signature::{Keypair, read_keypair_file},
        signer::Signer,
    },
    mangekyou::kamui_vrf::{
        ecvrf::{ECVRFKeyPair},
        VRFKeyPair,
        VRFProof,
    },
    std::{
        fs::{self, File},
        io::{Read, Write},
        error::Error,
        path::Path,
    },
    tokio,
    clap::{Parser, Subcommand},
    rand::thread_rng,
    hex,
};

#[derive(Parser, Debug)]
#[clap(name = "vrf-server", about = "VRF server for the Mangekyou project")]
struct Cli {
    #[clap(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Generate a new VRF keypair
    Generate {
        /// The output file for the keypair
        #[clap(short, long, default_value = "vrf-keypair.json")]
        output: String,
    },
    /// Test a VRF keypair by generating a proof
    Test {
        /// The input keypair file
        #[clap(short, long)]
        keypair: String,
        /// The alpha value (seed) for proof generation
        #[clap(short, long)]
        alpha: String,
    },
    /// Run the VRF server
    Run {
        /// Solana program ID
        #[clap(long)]
        program_id: String,
        /// Oracle keypair file
        #[clap(long)]
        keypair: String,
        /// VRF keypair file
        #[clap(long)]
        vrf_keypair: String,
        /// RPC URL
        #[clap(long, default_value = "https://api.devnet.solana.com")]
        rpc_url: String,
        /// WS URL
        #[clap(long)]
        ws_url: Option<String>,
    },
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
        println!("Loading VRF keypair from {}", path.display());
        let mut file = File::open(path)?;
        let mut keypair_bytes = Vec::new();
        file.read_to_end(&mut keypair_bytes)?;
        match ECVRFKeyPair::from_bytes(&keypair_bytes) {
            Ok(keypair) => {
                println!("Successfully loaded VRF keypair");
                Ok(keypair)
            }
            Err(e) => {
                println!("Error loading VRF keypair: {}", e);
                println!("Generating new VRF keypair...");
                let keypair = ECVRFKeyPair::generate(&mut thread_rng());
                
                // Save the keypair
                let mut keypair_bytes = keypair.sk.as_ref().to_vec();
                keypair_bytes.extend_from_slice(keypair.pk.as_ref());
                let mut file = File::create(path)?;
                file.write_all(&keypair_bytes)?;
                
                println!("New VRF keypair generated and saved to {}", path.display());
                Ok(keypair)
            }
        }
    } else {
        println!("VRF keypair not found at {}, generating new one", path.display());
        let keypair = ECVRFKeyPair::generate(&mut thread_rng());
        
        // Save the keypair
        let mut keypair_bytes = keypair.sk.as_ref().to_vec();
        keypair_bytes.extend_from_slice(keypair.pk.as_ref());
        let mut file = File::create(path)?;
        file.write_all(&keypair_bytes)?;
        
        println!("VRF keypair generated and saved to {}", path.display());
        Ok(keypair)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize the logger
    env_logger::init();

    // Parse command line arguments
    let cli = Cli::parse();

    match cli.command {
        Commands::Generate { output } => {
            // Generate a new VRF keypair
            let mut rng = thread_rng();
            let keypair = ECVRFKeyPair::generate(&mut rng);
            
            // Convert the keypair to bytes
            let mut keypair_bytes = Vec::new();
            keypair_bytes.extend_from_slice(keypair.pk.as_ref());
            keypair_bytes.extend_from_slice(keypair.sk.as_ref());
            
            // Write the keypair to the output file
            let output_path = output.clone(); // Clone to avoid move
            let mut file = File::create(output_path)?;
            file.write_all(&keypair_bytes)?;
            println!("Generated VRF keypair and saved to {}", output);
            Ok(())
        }
        Commands::Test { keypair, alpha } => {
            // Load the keypair
            let keypair_bytes = fs::read(&keypair)?;
            let keypair = ECVRFKeyPair::from_bytes(&keypair_bytes)?;
            
            // Generate a proof
            let alpha_bytes = alpha.as_bytes();
            let proof = keypair.prove(alpha_bytes);
            let hash = proof.to_hash();
            
            println!("Alpha: {}", alpha);
            println!("Generated proof hash: {:?}", hex::encode(&hash));
            Ok(())
        }
        Commands::Run { program_id, keypair, vrf_keypair, rpc_url, ws_url } => {
            // Add panic catching mechanism
            std::panic::set_hook(Box::new(|panic_info| {
                eprintln!("VRF server panic: {:?}", panic_info);
            }));

            // Load the oracle keypair
            let oracle_keypair = read_keypair_file(keypair)
                .map_err(|e| format!("Failed to read keypair file: {}", e))?;
            
            // Load the VRF keypair
            let vrf_keypair_bytes = fs::read(&vrf_keypair)
                .map_err(|e| format!("Failed to read VRF keypair file: {}", e))?;
            let vrf_keypair = ECVRFKeyPair::from_bytes(&vrf_keypair_bytes)
                .map_err(|e| format!("Failed to parse VRF keypair: {}", e))?;
            
            // Determine the WebSocket URL
            let ws_url = ws_url.unwrap_or_else(|| {
                let mut url = rpc_url.clone();
                url = url.replace("http:", "ws:").replace("https:", "wss:");
                url
            });
            
            // Create and run the VRF server
            let server = VRFServer::new(
                &rpc_url,
                &ws_url,
                &program_id,
                oracle_keypair,
                vrf_keypair,
            )?;
            
            println!("Starting VRF server...");
            println!("Program ID: {}", program_id);
            println!("RPC URL: {}", rpc_url);
            println!("WS URL: {}", ws_url);
            
            server.run().await?;
            
            Ok(())
        }
    }
} 