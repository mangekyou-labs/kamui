use {
    kamui_program::vrf_server::VRFServer,
    solana_sdk::{
        signature::Keypair,
        signer::Signer,
    },
    mangekyou::kamui_vrf::{
        ecvrf::ECVRFKeyPair,
        VRFKeyPair,
    },
    std::{
        fs::{self, File},
        io::Read,
        error::Error,
        path::Path,
    },
    tokio,
    rand::thread_rng,
};

fn load_or_create_oracle_keypair() -> Result<Keypair, Box<dyn Error>> {
    let path = Path::new("oracle-keypair.json");
    if path.exists() {
        let mut keypair_file = File::open(path)?;
        let mut keypair_data = String::new();
        keypair_file.read_to_string(&mut keypair_data)?;
        let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data)?;
        Ok(Keypair::from_bytes(&keypair_bytes)?)
    } else {
        let keypair = Keypair::new();
        let keypair_bytes = keypair.to_bytes().to_vec();
        let keypair_json = serde_json::to_string(&keypair_bytes)?;
        fs::write(path, keypair_json)?;
        println!("Generated new oracle keypair: {}", keypair.pubkey());
        Ok(keypair)
    }
}

fn load_or_create_vrf_keypair() -> Result<ECVRFKeyPair, Box<dyn Error>> {
    let path = Path::new("vrf-keypair.json");
    if path.exists() {
        let mut keypair_file = File::open(path)?;
        let mut keypair_data = String::new();
        keypair_file.read_to_string(&mut keypair_data)?;
        let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_data)?;
        Ok(ECVRFKeyPair::from_bytes(&keypair_bytes)?)
    } else {
        let keypair = ECVRFKeyPair::generate(&mut thread_rng());
        let keypair_bytes = keypair.sk.as_ref().to_vec();
        let keypair_json = serde_json::to_string(&keypair_bytes)?;
        fs::write(path, keypair_json)?;
        println!("Generated new VRF keypair: {}", hex::encode(keypair.pk.as_ref()));
        Ok(keypair)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting VRF oracle server...");

    // Load or create keypairs
    let oracle_keypair = load_or_create_oracle_keypair()?;
    let vrf_keypair = load_or_create_vrf_keypair()?;

    println!("Server initialized with:");
    println!("Oracle pubkey: {}", oracle_keypair.pubkey());
    println!("VRF pubkey: {}", hex::encode(vrf_keypair.pk.as_ref()));

    // Create VRF server
    let server = VRFServer::new(
        "https://api.devnet.solana.com",
        "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D",
        oracle_keypair,
        vrf_keypair,
    )?;

    // Start server and event monitor
    tokio::select! {
        result = server.start() => {
            if let Err(e) = result {
                eprintln!("Server error: {}", e);
            }
        }
        result = server.monitor_events() => {
            if let Err(e) = result {
                eprintln!("Event monitor error: {}", e);
            }
        }
    }

    Ok(())
} 