use {
    aes_gcm::{
        aead::{Aead, KeyInit, OsRng},
        Aes256Gcm, Nonce,
    },
    argon2::{password_hash::SaltString, Argon2, PasswordHasher},
    clap::{Parser, Subcommand},
    hex,
    kamui_program::instruction::VerifyVrfInput,
    mangekyou::kamui_vrf::{ecvrf::ECVRFKeyPair, ecvrf::ECVRFPrivateKey, VRFKeyPair, VRFProof},
    rand::thread_rng,
    serde_json,
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
    std::{
        fs::{self, File},
        io::{Read, Write},
        path::Path,
        str::FromStr,
        thread,
        time::Duration,
    },
    tokio::time::sleep,
};

const ENCRYPTED_KEY_MAGIC: &[u8; 8] = b"KAMUI_VRF";
const NONCE_SIZE: usize = 12;
const SALT_SIZE: usize = 22;

fn generate_password() -> String {
    use getrandom::getrandom;
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes).expect("failed to get random bytes");
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(bytes)
}

fn read_password(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    if path.exists() {
        let mut file = File::open(path)?;
        let mut password = String::new();
        file.read_to_string(&mut password)?;
        password.truncate(password.trim_end_matches(|c| c == '\n' || c == '\r').len());
        Ok(password)
    } else {
        let password = generate_password();
        let mut file = File::create(path)?;
        file.write_all(password.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = file.metadata()?.permissions();
            perms.set_mode(0o600);
            file.set_permissions(perms)?;
        }
        println!("Generated password file: {}", path.display());
        println!("IMPORTANT: Save this password — losing it means losing VRF key access");
        Ok(password)
    }
}

fn encrypt_vrf_key(sk_bytes: &[u8], password: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    let key_bytes = hash.hash.ok_or("failed to extract key hash")?;
    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_bytes())?;
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, sk_bytes)?;
    let mut result = Vec::with_capacity(8 + SALT_SIZE + NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(ENCRYPTED_KEY_MAGIC);
    result.extend_from_slice(salt.as_str().as_bytes());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn decrypt_vrf_key(encrypted: &[u8], password: &str) -> Result<ECVRFKeyPair, Box<dyn std::error::Error>> {
    if encrypted.len() < 8 + SALT_SIZE + NONCE_SIZE + 16 {
        return Err("Encrypted key file too short".into());
    }
    if &encrypted[0..8] != ENCRYPTED_KEY_MAGIC {
        return Err("Not an encrypted VRF key file (bad magic)".into());
    }
    let salt_str = std::str::from_utf8(&encrypted[8..8 + SALT_SIZE])?;
    let salt = SaltString::from_b64(salt_str).map_err(|e| format!("bad salt: {}", e))?;
    let nonce_bytes: [u8; NONCE_SIZE] = encrypted[8 + SALT_SIZE..8 + SALT_SIZE + NONCE_SIZE]
        .try_into()
        .map_err(|_| "bad nonce size")?;
    let ciphertext = &encrypted[8 + SALT_SIZE + NONCE_SIZE..];
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    let key_bytes = hash.hash.ok_or("failed to extract key hash")?;
    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_bytes())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let sk_bytes = cipher.decrypt(nonce, ciphertext)?;
    if sk_bytes.len() != 32 {
        return Err(format!("Invalid key length: {}", sk_bytes.len()).into());
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&sk_bytes);
    let sk = ECVRFPrivateKey::from_bytes(&seed)?;
    Ok(ECVRFKeyPair::from(sk))
}

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
        /// Password file for encryption
        #[arg(short, long, default_value = "vrf-keypair.pass")]
        password_file: String,
    },
    /// Start the VRF server
    Start {
        /// VRF keypair file
        #[arg(short, long, default_value = "vrf-keypair.json")]
        keypair: String,
        /// Password file for key decryption
        #[arg(short, long, default_value = "vrf-keypair.pass")]
        password_file: String,
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
        /// Password file for key decryption
        #[arg(short, long, default_value = "vrf-keypair.pass")]
        password_file: String,
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
        /// Password file for key decryption
        #[arg(short, long, default_value = "vrf-keypair.pass")]
        password_file: String,
        /// Solana RPC URL
        #[arg(short, long, default_value = "https://api.devnet.solana.com")]
        rpc_url: String,
        /// Payer keypair for transactions
        #[arg(short, long, default_value = "test-keypair.json")]
        payer: String,
        /// Verifier program ID
        #[arg(
            short,
            long,
            default_value = "4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y"
        )]
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
        let rpc_client =
            RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());

        println!("🔑 Real VRF Server initialized");
        println!(
            "🔑 VRF Public Key: {}",
            hex::encode(vrf_keypair.pk.as_ref())
        );
        println!("💰 Payer: {}", payer.pubkey());

        Self {
            vrf_keypair,
            rpc_client,
            payer,
        }
    }

    /// Generate real VRF randomness using ECVRF
    pub fn generate_randomness(&self, seed: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        println!(
            "🎲 Generating real VRF randomness for seed: {}",
            hex::encode(seed)
        );

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
    pub async fn verify_on_chain(
        &self,
        seed: &[u8],
        verifier_program_id: &Pubkey,
    ) -> Result<String, Box<dyn std::error::Error>> {
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
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&self.payer.pubkey()),
            &recent_blockhash,
        );
        let mut transaction = Transaction::new_unsigned(message);
        transaction.sign(&[&self.payer], recent_blockhash);

        println!("📤 Sending VRF verification transaction...");
        let signature = self
            .rpc_client
            .send_and_confirm_transaction_with_spinner(&transaction)?;

        println!("✅ VRF Verification successful!");
        println!("📋 Transaction: {}", signature);
        println!(
            "🔗 Explorer: https://explorer.solana.com/tx/{}?cluster=devnet",
            signature
        );
        println!("🎯 VRF Output: {}", hex::encode(&output));

        Ok(signature.to_string())
    }

    /// Start the VRF server (for future use with request monitoring)
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        println!("🚀 Starting Real VRF Server...");
        println!(
            "🔑 VRF Public Key: {}",
            hex::encode(self.vrf_keypair.pk.as_ref())
        );
        println!("💰 Payer: {}", self.payer.pubkey());

        // Check balance
        let balance = self.rpc_client.get_balance(&self.payer.pubkey())?;
        println!("💰 Payer balance: {} SOL", balance as f64 / 1_000_000_000.0);

        if balance < 10_000_000 {
            // 0.01 SOL
            println!("⚠️  WARNING: Payer balance is low. Consider funding the account.");
        }

        // For now, just demonstrate VRF generation
        loop {
            println!("\n🔄 Generating sample VRF randomness...");

            // Generate a random seed
            let seed: [u8; 32] = rand::random();
            let (output, _proof, _pubkey) = self.generate_randomness(&seed);

            // Convert to game result (1-100)
            let game_result =
                (u32::from_be_bytes([output[0], output[1], output[2], output[3]]) % 100) + 1;
            println!("🎮 Game Result: {}", game_result);

            // Wait 10 seconds before next generation
            thread::sleep(Duration::from_secs(10));
        }
    }
}

/// Load VRF keypair from encrypted file
fn load_vrf_keypair(path: &str, password_path: &str) -> Result<ECVRFKeyPair, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;

    // Check magic bytes
    if contents.len() >= 8 && &contents[0..8] == ENCRYPTED_KEY_MAGIC {
        let password = read_password(Path::new(password_path))?;
        decrypt_vrf_key(&contents, &password)
    } else {
        // Legacy unencrypted format
        let keypair_data: Vec<u8> = serde_json::from_str(
            &String::from_utf8_lossy(&contents)
        )?;
        if keypair_data.len() == 32 {
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&keypair_data);
            let sk = ECVRFPrivateKey::from_bytes(&seed)?;
            return Ok(ECVRFKeyPair::from(sk));
        }
        // Try as JSON array
        let json_bytes: Vec<u8> = serde_json::from_str(&String::from_utf8_lossy(&contents))?;
        if json_bytes.len() == 32 {
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&json_bytes);
            let sk = ECVRFPrivateKey::from_bytes(&seed)?;
            return Ok(ECVRFKeyPair::from(sk));
        }
        Err("Invalid key format".into())
    }
}

/// Save VRF keypair encrypted
fn save_vrf_keypair(
    keypair: &ECVRFKeyPair,
    path: &str,
    password_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let password = read_password(Path::new(password_path))?;
    let encrypted = encrypt_vrf_key(keypair.sk.as_ref(), &password)?;
    std::fs::write(path, &encrypted)?;
    // Restrict file permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = File::open(path)?.metadata()?.permissions();
        let mut p = perms;
        p.set_mode(0o600);
        File::open(path)?.set_permissions(p)?;
    }
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
        Commands::GenerateKeypair { output, password_file } => {
            println!("🔑 Generating new VRF keypair...");

            let vrf_keypair = ECVRFKeyPair::generate(&mut thread_rng());
            save_vrf_keypair(&vrf_keypair, &output, &password_file)?;

            println!("✅ VRF keypair generated and saved to: {}", output);
            println!("🔑 Public Key: {}", hex::encode(vrf_keypair.pk.as_ref()));
        }

        Commands::Start {
            keypair,
            password_file,
            rpc_url,
            payer,
        } => {
            println!("🚀 Starting Real VRF Server...");

            let vrf_keypair = load_vrf_keypair(&keypair, &password_file)?;
            let payer_keypair = load_solana_keypair(&payer)?;

            let server = RealVRFServer::new(vrf_keypair, &rpc_url, payer_keypair);
            server.start().await?;
        }

        Commands::Generate {
            keypair,
            password_file,
            seed,
            verify,
        } => {
            println!("🎲 Generating VRF randomness...");

            let vrf_keypair = load_vrf_keypair(&keypair, &password_file)?;
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
                let verification_result =
                    vrf_keypair.verify(&seed_bytes, &output, &VRFProof::from_bytes(&proof_bytes)?);
                println!(
                    "🔍 Local Verification: {}",
                    if verification_result {
                        "✅ VALID"
                    } else {
                        "❌ INVALID"
                    }
                );
            }
        }

        Commands::TestVerification {
            keypair,
            password_file,
            rpc_url,
            payer,
            verifier_program,
        } => {
            println!("🧪 Testing VRF verification on devnet...");

            let vrf_keypair = load_vrf_keypair(&keypair, &password_file)?;
            let payer_keypair = load_solana_keypair(&payer)?;
            let verifier_program_id = Pubkey::from_str(&verifier_program)?;

            let server = RealVRFServer::new(vrf_keypair, &rpc_url, payer_keypair);

            // Test with a sample message
            let test_message = b"Real VRF Test - Devnet Verification";
            let signature = server
                .verify_on_chain(test_message, &verifier_program_id)
                .await?;

            println!("🎉 Test completed successfully!");
            println!("📋 Transaction: {}", signature);
        }
    }

    Ok(())
}
