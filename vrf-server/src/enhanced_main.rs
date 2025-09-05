use {
    clap::Parser,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::read_keypair_file,
        pubkey::Pubkey,
    },
    std::{str::FromStr, error::Error, fs::OpenOptions, io::Write},
    kamui_vrf_server::{EnhancedVRFServer, MangekyouCLI},
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the Oracle keypair file
    #[arg(short, long)]
    keypair: String,

    /// Program ID of the VRF coordinator
    #[arg(short, long)]
    program_id: String,

    /// RPC URL for the Solana cluster
    #[arg(short, long)]
    rpc_url: String,

    /// Path to the Mangekyou CLI binary (optional)
    #[arg(short, long)]
    cli_path: Option<String>,

    /// Log level (debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    log_level: String,

    /// Test the proof pipeline before starting the server
    #[arg(long)]
    test_pipeline: bool,

    /// Show server statistics and exit
    #[arg(long)]
    show_stats: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    // Set up logging based on the log level
    std::env::set_var("RUST_LOG", args.log_level.clone());
    env_logger::init();

    println!("🚀 Starting Enhanced Kamui VRF Server with Real CLI Integration");
    println!("=" .repeat(80));
    
    // Load Oracle keypair
    println!("🔑 Loading oracle keypair from {}", args.keypair);
    let oracle_keypair = read_keypair_file(&args.keypair)?;
    println!("✅ Oracle keypair loaded: {}", oracle_keypair.pubkey());
    
    // Create the enhanced VRF server
    println!("🏗️  Initializing Enhanced VRF Server...");
    let mut server = EnhancedVRFServer::new(
        &args.rpc_url,
        &args.program_id,
        oracle_keypair,
        args.cli_path,
    )?;
    
    println!("✅ Enhanced VRF Server initialized successfully!");
    println!("📊 Server Configuration:");
    println!("   Oracle Pubkey: {}", server.get_stats()["oracle_pubkey"]);
    println!("   VRF Public Key: {}", server.get_vrf_public_key());
    println!("   Program ID: {}", args.program_id);
    println!("   RPC URL: {}", args.rpc_url);
    
    // Show stats and exit if requested
    if args.show_stats {
        println!("\n📈 Server Statistics:");
        let stats = server.get_stats();
        for (key, value) in stats {
            println!("   {}: {}", key, value);
        }
        return Ok(());
    }
    
    // Test proof pipeline if requested
    if args.test_pipeline {
        println!("\n🧪 Testing VRF Proof Pipeline...");
        match server.test_proof_pipeline().await {
            Ok(_) => {
                println!("✅ Proof pipeline test completed successfully!");
                if !should_continue_after_test() {
                    return Ok(());
                }
            }
            Err(e) => {
                eprintln!("❌ Proof pipeline test failed: {}", e);
                return Err(e);
            }
        }
    }
    
    println!("\n🎯 Starting VRF request monitoring...");
    println!("🔍 Monitoring for pending VRF requests every 3 seconds...");
    println!("📡 Ready to fulfill randomness requests!");
    println!("⚠️  Press Ctrl+C to stop the server\n");
    
    // Set up graceful shutdown
    let shutdown_flag = setup_shutdown_handler();
    
    // Run the server
    tokio::select! {
        result = server.run() => {
            match result {
                Ok(_) => println!("✅ Server completed successfully"),
                Err(e) => {
                    eprintln!("❌ Server error: {}", e);
                    return Err(e);
                }
            }
        }
        _ = shutdown_flag => {
            println!("\n🛑 Received shutdown signal");
            println!("💾 Saving server state...");
            log_shutdown_stats(&server);
            println!("✅ Enhanced VRF Server shutdown completed successfully");
        }
    }
    
    Ok(())
}

fn should_continue_after_test() -> bool {
    use std::io::{self, Write};
    print!("Continue with server startup? [y/N]: ");
    io::stdout().flush().unwrap();
    
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap_or(0);
    
    matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
}

async fn setup_shutdown_handler() -> tokio::signal::unix::Signal {
    use tokio::signal::unix::{signal, SignalKind};
    signal(SignalKind::interrupt()).expect("Failed to create signal handler")
}

fn log_shutdown_stats(server: &EnhancedVRFServer) {
    let stats = server.get_stats();
    println!("📊 Final Statistics:");
    println!("   Processed Requests: {}", stats.get("processed_requests").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0))));
    
    // Log to file
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("vrf-server-shutdown.log")
    {
        let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
        writeln!(file, "[{}] Enhanced VRF Server shutdown", timestamp).ok();
        writeln!(file, "Stats: {}", serde_json::to_string_pretty(&stats).unwrap_or_default()).ok();
    }
}
