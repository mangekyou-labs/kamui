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
    std::{str::FromStr, fs::File, io::Read, time::Duration, thread},
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
    clap::{Parser, Subcommand},
    serde_json,
};

#[derive(Parser)]
#[command(name = "real-vrf-server")]
#[command(about = "A real VRF server using ECVRF for generating verifiable randomness")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a new VRF keypair
    GenerateKeypair {
        /// Output file for the keypair
        #[arg(short, long, default_value = "vrf-keypair.json")]
        output: String,
    },
    /// Start the VRF server
    Start {
        /// VRF keypair file
        #[arg(short, long, default_value = "vrf-keypair.json")]
        keypair: String,
        /// Solana RPC URL
        #[arg(short, long, default_value = "https://api.devnet.solana.com")]
        rpc_url: String,
        /// Payer keypair for transactions
        #[arg(short, long, default_value = "test-keypair.json")]
        payer: String,
    },
    /// Generate VRF randomness for a given seed
    Generate {
        /// VRF keypair file
        #[arg(short, long, default_value = "vrf-keypair.json")]
        keypair: String,
        /// Seed for VRF generation (hex string)
        #[arg(short, long)]
        seed: String,
        /// Verify the generated proof
        #[arg(short, long)]
        verify: bool,
    },
    /// Test VRF verification on devnet
    TestVerification {
        /// VRF keypair file
        #[arg(short, long, default_value = "vrf-keypair.json")]
        keypair: String,
        /// Solana RPC URL
        #[arg(short, long, default_value = "https://api.devnet.solana.com")]
        rpc_url: String,
        /// Payer keypair for transactions
        #[arg(short, long, default_value = "test-keypair.json")]
        payer: String,
        /// Verifier program ID
        #[arg(short, long, default_value = "4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y")]
        verifier_program: String,
    },
}

/// Real VRF Server using ECVRF
pub struct RealVRFServer {
    vrf_keypair: ECVRFKeyPair,
    rpc_client: RpcClient,
    payer: Keypair,
}

impl RealVRFServer {
    pub fn new(vrf_keypair: ECVRFKeyPair, rpc_url: &str, payer: Keypair) -> Self {
        let rpc_client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
        
        println!("🔑 Real VRF Server initialized");
        println!("🔑 VRF Public Key: {}", hex::encode(vrf_keypair.pk.as_ref()));
        println!("💰 Payer: {}", payer.pubkey());
        
        Self {
            vrf_keypair,
            rpc_client,
            payer,
        }
    }
    
    /// Generate real VRF randomness using ECVRF
    pub fn generate_randomness(&self, seed: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        println!("🎲 Generating real VRF randomness for seed: {}", hex::encode(seed));
        
        // Generate VRF proof and output using real ECVRF
        let (output, proof) = self.vrf_keypair.output(seed);
        let proof_bytes = proof.to_bytes();
        let public_key_bytes = self.vrf_keypair.pk.as_ref().to_vec();
        
        println!("✅ Real VRF randomness generated:");
        println!("  Seed: {}", hex::encode(seed));
        println!("  Output: {}", hex::encode(&output));
        println!("  Proof: {}", hex::encode(&proof_bytes));
        println!("  Public Key: {}", hex::encode(&public_key_bytes));
        println!("  Proof Length: {} bytes", proof_bytes.len());
        
        (output, proof_bytes, public_key_bytes)
    }
    
    /// Verify VRF proof on-chain using the verifier program
    pub async fn verify_on_chain(&self, seed: &[u8], verifier_program_id: &Pubkey) -> Result<String, Box<dyn std::error::Error>> {
        let (output, proof_bytes, public_key_bytes) = self.generate_randomness(seed);
        
        // Create the instruction data for verification
        let verify_input = VerifyVrfInput {
            alpha_string: seed.to_vec(),
            proof_bytes,
            public_key_bytes,
        };

        let instruction = Instruction::new_with_borsh(
            *verifier_program_id,
            &verify_input,
            vec![AccountMeta::new(self.payer.pubkey(), true)],
        );

        // Send transaction
        let recent_blockhash = self.rpc_client.get_latest_blockhash()?;
        let message = Message::new_with_blockhash(&[instruction], Some(&self.payer.pubkey()), &recent_blockhash);
        let mut transaction = Transaction::new_unsigned(message);
        transaction.sign(&[&self.payer], recent_blockhash);

        println!("📤 Sending VRF verification transaction...");
        let signature = self.rpc_client.send_and_confirm_transaction_with_spinner(&transaction)?;

        println!("✅ VRF Verification successful!");
        println!("📋 Transaction: {}", signature);
        println!("🔗 Explorer: https://explorer.solana.com/tx/{}?cluster=devnet", signature);
        println!("🎯 VRF Output: {}", hex::encode(&output));
        
        Ok(signature.to_string())
    }
    
    /// Start the VRF server (for future use with request monitoring)
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        println!("🚀 Starting Real VRF Server...");
        println!("🔑 VRF Public Key: {}", hex::encode(self.vrf_keypair.pk.as_ref()));
        println!("💰 Payer: {}", self.payer.pubkey());
        
        // Check balance
        let balance = self.rpc_client.get_balance(&self.payer.pubkey())?;
        println!("💰 Payer balance: {} SOL", balance as f64 / 1_000_000_000.0);
        
        if balance < 10_000_000 { // 0.01 SOL
            println!("⚠️  WARNING: Payer balance is low. Consider funding the account.");
        }
        
        // For now, just demonstrate VRF generation
        loop {
            println!("\n🔄 Generating sample VRF randomness...");
            
            // Generate a random seed
            let seed: [u8; 32] = rand::random();
            let (output, _proof, _pubkey) = self.generate_randomness(&seed);
            
            // Convert to game result (1-100)
            let game_result = (u32::from_be_bytes([output[0], output[1], output[2], output[3]]) % 100) + 1;
            println!("🎮 Game Result: {}", game_result);
            
            // Wait 10 seconds before next generation
            thread::sleep(Duration::from_secs(10));
        }
    }
}

/// Load VRF keypair from file
fn load_vrf_keypair(path: &str) -> Result<ECVRFKeyPair, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    
    let keypair_data: Vec<u8> = serde_json::from_str(&contents)?;
    let keypair = ECVRFKeyPair::from_bytes(&keypair_data)?;
    
    Ok(keypair)
}

/// Save VRF keypair to file
fn save_vrf_keypair(keypair: &ECVRFKeyPair, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let keypair_bytes = keypair.to_bytes();
    let json = serde_json::to_string_pretty(&keypair_bytes)?;
    std::fs::write(path, json)?;
    
    Ok(())
}

/// Load Solana keypair from file
fn load_solana_keypair(path: &str) -> Result<Keypair, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    
    let keypair_data: Vec<u8> = serde_json::from_str(&contents)?;
    let keypair = Keypair::from_bytes(&keypair_data)?;
    
    Ok(keypair)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::GenerateKeypair { output } => {
            println!("🔑 Generating new VRF keypair...");
            
            let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
            save_vrf_keypair(&vrf_keypair, &output)?;
            
            println!("✅ VRF keypair generated and saved to: {}", output);
            println!("🔑 Public Key: {}", hex::encode(vrf_keypair.pk.as_ref()));
        }
        
        Commands::Start { keypair, rpc_url, payer } => {
            println!("🚀 Starting Real VRF Server...");
            
            let vrf_keypair = load_vrf_keypair(&keypair)?;
            let payer_keypair = load_solana_keypair(&payer)?;
            
            let server = RealVRFServer::new(vrf_keypair, &rpc_url, payer_keypair);
            server.start().await?;
        }
        
        Commands::Generate { keypair, seed, verify } => {
            println!("🎲 Generating VRF randomness...");
            
            let vrf_keypair = load_vrf_keypair(&keypair)?;
            let seed_bytes = hex::decode(&seed)?;
            
            let (output, proof_bytes, public_key_bytes) = {
                let (output, proof) = vrf_keypair.output(&seed_bytes);
                let proof_bytes = proof.to_bytes();
                let public_key_bytes = vrf_keypair.pk.as_ref().to_vec();
                (output, proof_bytes, public_key_bytes)
            };
            
            println!("✅ VRF randomness generated:");
            println!("  Seed: {}", seed);
            println!("  Output: {}", hex::encode(&output));
            println!("  Proof: {}", hex::encode(&proof_bytes));
            println!("  Public Key: {}", hex::encode(&public_key_bytes));
            
            if verify {
                // Verify the proof locally
                let verification_result = vrf_keypair.verify(&seed_bytes, &output, &VRFProof::from_bytes(&proof_bytes)?);
                println!("🔍 Local Verification: {}", if verification_result { "✅ VALID" } else { "❌ INVALID" });
            }
        }
        
        Commands::TestVerification { keypair, rpc_url, payer, verifier_program } => {
            println!("🧪 Testing VRF verification on devnet...");
            
            let vrf_keypair = load_vrf_keypair(&keypair)?;
            let payer_keypair = load_solana_keypair(&payer)?;
            let verifier_program_id = Pubkey::from_str(&verifier_program)?;
            
            let server = RealVRFServer::new(vrf_keypair, &rpc_url, payer_keypair);
            
            // Test with a sample message
            let test_message = b"Real VRF Test - Devnet Verification";
            let signature = server.verify_on_chain(test_message, &verifier_program_id).await?;
            
            println!("🎉 Test completed successfully!");
            println!("📋 Transaction: {}", signature);
        }
    }
    
    Ok(())
} 