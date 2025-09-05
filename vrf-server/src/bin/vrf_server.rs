use {
    clap::Parser,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::read_keypair_file,
        pubkey::Pubkey,
    },
    std::{str::FromStr, error::Error, fs::OpenOptions, io::Write},
    kamui_vrf_server::VRFServer,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the Oracle keypair file
    #[arg(short, long)]
    keypair: String,

    /// Path to the VRF keypair file
    #[arg(short, long, default_value = "vrf-keypair.json")]
    vrf_keypair: String,

    /// Program ID of the VRF coordinator
    #[arg(short, long)]
    program_id: String,

    /// RPC URL for the Solana cluster
    #[arg(short, long)]
    rpc_url: String,

    /// WebSocket URL for the Solana cluster
    #[arg(short, long)]
    ws_url: String,

    /// Log level (debug, info, warn, error)
    #[arg(short, long)]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    // Set up logging based on the log level
    std::env::set_var("RUST_LOG", args.log_level.clone());
    env_logger::init();

    println!("Starting VRF oracle server...");
    
    // Load Oracle keypair
    println!("Loading oracle keypair from {}", args.keypair);
    let oracle_keypair = read_keypair_file(&args.keypair)?;
    println!("Successfully loaded oracle keypair: {}", oracle_keypair.pubkey());
    
    // Load VRF keypair
    println!("Loading VRF keypair from: {:?}", args.vrf_keypair);
    let vrf_keypair = kamui_vrf_server::load_or_create_keypair(args.vrf_keypair.as_ref().into())?;
    
    let program_id = Pubkey::from_str(&args.program_id)?;

    // Create and run the VRF server
    let server = VRFServer::new(
        &args.rpc_url,
        &args.program_id,
        oracle_keypair,
        vrf_keypair,
    )?;
    
    println!("Server initialized with:");
    println!("Oracle pubkey: {}", oracle_keypair.pubkey());
    println!("VRF pubkey: {}", hex::encode(vrf_keypair.pk.as_ref()));
    println!("Program ID: {}", args.program_id);
    println!("RPC URL: {}", args.rpc_url);
    println!("WebSocket URL: {}", args.ws_url);
    
    // Run the server with both polling and WebSocket
    let result = server.run(&args.ws_url).await;
    
    if let Err(e) = &result {
        eprintln!("VRF server error: {}", e);
    }
    
    result
} 