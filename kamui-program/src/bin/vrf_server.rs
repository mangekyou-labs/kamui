use {
    aes_gcm::{
        aead::{Aead, KeyInit, OsRng},
        Aes256Gcm, Nonce,
    },
    argon2::{password_hash::SaltString, Argon2, PasswordHasher},
    clap::{ArgAction, Parser},
    kamui_program::vrf_server::VRFServer,
    mangekyou::kamui_vrf::{ecvrf::ECVRFKeyPair, ecvrf::ECVRFPrivateKey, VRFKeyPair},
    rand::{thread_rng, Rng},
    solana_sdk::{
        signature::{read_keypair_file, Keypair},
        signer::Signer,
    },
    std::{
        error::Error,
        fs::{self, File},
        io::{Read, Write},
        path::Path,
        str::FromStr,
    },
    tokio,
};

const ENCRYPTED_KEY_MAGIC: &[u8; 8] = b"KAMUI_VRF";
const NONCE_SIZE: usize = 12;
const SALT_SIZE: usize = 22; // Base64-encodedargon2 salt

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the keypair file
    #[arg(short, long, default_value = "vrf-keypair.json")]
    keypair: String,

    /// Path to the password file for key encryption
    #[arg(short, long, default_value = "vrf-keypair.pass")]
    password_file: String,

    /// Program ID of the VRF coordinator
    #[arg(
        short,
        long,
        default_value = "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
    )]
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

/// Read password from password file, or prompt securely
fn read_password(path: &Path) -> Result<String, Box<dyn Error>> {
    if path.exists() {
        let mut file = File::open(path)?;
        let mut password = String::new();
        file.read_to_string(&mut password)?;
        // Trim newline/CR
        password.truncate(password.trim_end_matches(|c| c == '\n' || c == '\r').len());
        Ok(password)
    } else {
        // Generate random password for initial key creation
        let password = generate_password();
        let mut file = File::create(path)?;
        file.write_all(password.as_bytes())?;
        // Restrict permissions: owner read/write only
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = file.metadata()?.permissions();
            perms.set_mode(0o600);
            file.set_permissions(perms)?;
        }
        println!("Generated password file: {}", path.display());
        println!("IMPORTANT: Save this password safely — losing it means losing VRF key access");
        Ok(password)
    }
}

/// Generate a cryptographically random password encoded as Base64
fn generate_password() -> String {
    use getrandom::getrandom;
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes).expect("failed to get random bytes");
    // Base64 encode
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(bytes)
}

/// Encrypt VRF private key using AES-256-GCM with argon2-derived key
fn encrypt_vrf_key(sk_bytes: &[u8], password: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    // Generate salt for argon2
    let salt = SaltString::generate(&mut OsRng);

    // Derive key from password using argon2
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    let key_bytes = hash.hash.ok_or("failed to extract key hash")?;

    // Create AES-256-GCM cipher
    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_bytes())?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher.encrypt(nonce, sk_bytes)?;

    // Format: MAGIC(8) + SALT(base64, 22) + NONCE(12) + CIPHERTEXT
    let mut result = Vec::with_capacity(8 + SALT_SIZE + NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(ENCRYPTED_KEY_MAGIC);
    result.extend_from_slice(salt.as_str().as_bytes());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt VRF private key from encrypted file
fn decrypt_vrf_key(encrypted: &[u8], password: &str) -> Result<ECVRFKeyPair, Box<dyn Error>> {
    // Parse format: MAGIC(8) + SALT(base64, 22) + NONCE(12) + CIPHERTEXT
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

    // Derive key from password
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    let key_bytes = hash.hash.ok_or("failed to extract key hash")?;

    // Decrypt
    let cipher = Aes256Gcm::new_from_slice(key_bytes.as_bytes())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let sk_bytes = cipher.decrypt(nonce, ciphertext)?;

    // Reconstruct keypair
    if sk_bytes.len() != 32 {
        return Err(format!("Invalid key length: {}", sk_bytes.len()).into());
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&sk_bytes);
    let sk = ECVRFPrivateKey::from_bytes(&seed)?;
    Ok(ECVRFKeyPair::from(sk))
}

fn load_or_create_oracle_keypair() -> Result<Keypair, Box<dyn Error>> {
    let path = Path::new("oracle-keypair.json");
    if path.exists() {
        println!("Loading oracle keypair from {}", path.display());
        match read_keypair_file(path) {
            Ok(keypair) => {
                println!("Successfully loaded oracle keypair: {}", keypair.pubkey());
                Ok(keypair)
            }
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

fn load_or_create_vrf_keypair(
    keypair_path: &str,
    password_file_path: &str,
) -> Result<ECVRFKeyPair, Box<dyn Error>> {
    let path = Path::new(keypair_path);
    let password_path = Path::new(password_file_path);

    // Check if encrypted file exists
    if path.exists() {
        println!("Attempting to load VRF keypair from {}", path.display());

        // Read first 8 bytes to check magic
        let mut file = File::open(path)?;
        let mut magic = [0u8; 8];
        file.read_exact(&mut magic)?;

        // Check if encrypted format
        if magic == ENCRYPTED_KEY_MAGIC {
            println!("Found encrypted VRF key file");
            // Rewind to read full file
            file.seek(std::io::SeekFrom::Start(0))?;
            let mut encrypted = Vec::new();
            file.read_to_end(&mut encrypted)?;

            let password = read_password(password_path)?;
            return decrypt_vrf_key(&encrypted, &password).map_err(|e| {
                format!("Failed to decrypt VRF key (wrong password?): {}", e).into()
            });
        }

        // Legacy unencrypted format — migrate to encrypted
        println!("WARNING: Found unencrypted VRF key (legacy format)");
        println!("Migrating to encrypted format...");
        drop(file);

        let mut file = File::open(path)?;
        let mut keypair_bytes = Vec::new();
        file.read_to_end(&mut keypair_bytes)?;
        drop(file);

        // Parse legacy format
        let sk = if keypair_bytes.len() == 32 {
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&keypair_bytes);
            ECVRFPrivateKey::from_bytes(&seed)?
        } else if let Ok(json_bytes) = serde_json::from_slice::<Vec<u8>>(&keypair_bytes) {
            if json_bytes.len() == 32 {
                let mut seed = [0u8; 32];
                seed.copy_from_slice(&json_bytes);
                ECVRFPrivateKey::from_bytes(&seed)?
            } else {
                return Err("Invalid key length".into());
            }
        } else {
            return Err("Cannot parse legacy key format".into());
        };

        let vrf_keypair = ECVRFKeyPair::from(sk);

        // Encrypt and save in new format
        let password = read_password(password_path)?;
        let encrypted = encrypt_vrf_key(vrf_keypair.sk.as_ref(), &password)?;
        let mut file = File::create(path)?;
        file.write_all(&encrypted)?;

        // Remove legacy file if different from new path
        println!("VRF key migrated to encrypted format");

        // Overwrite plaintext backup with encrypted version
        println!("Encrypted key written to: {}", path.display());
        return Ok(vrf_keypair);
    }

    // Generate new keypair
    println!("VRF keypair file not found, generating new one");
    let mut rng = thread_rng();
    let vrf_keypair = ECVRFKeyPair::generate(&mut rng);
    println!(
        "Generated new VRF keypair: {}",
        hex::encode(vrf_keypair.pk.as_ref())
    );

    // Get password (will generate if not exists)
    let password = read_password(password_path)?;

    // Encrypt and save
    let encrypted = encrypt_vrf_key(vrf_keypair.sk.as_ref(), &password)?;
    let mut file = File::create(path)?;
    file.write_all(&encrypted)?;

    // Restrict file permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata()?.permissions();
        perms.set_mode(0o600);
        file.set_permissions(perms)?;
    }

    println!("Encrypted VRF key written to: {}", path.display());
    Ok(vrf_keypair)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    // Whitelist log_level values — don't pass user input directly to env::set_var
    let log_level = match args.log_level.as_str() {
        "debug" => "debug",
        "trace" => "trace",
        _ => "info",
    };
    std::env::set_var("RUST_LOG", log_level);
    env_logger::init();

    println!("Starting VRF oracle server...");

    let oracle_keypair = load_or_create_oracle_keypair()?;
    let vrf_keypair = load_or_create_vrf_keypair(&args.keypair, &args.password_file)?;

    println!("Server initialized with:");
    println!("Oracle pubkey: {}", oracle_keypair.pubkey());
    println!("VRF pubkey: {}", hex::encode(vrf_keypair.pk.as_ref()));
    println!("Program ID: {}", args.program_id);
    println!("RPC URL: {}", args.rpc_url);
    println!("WebSocket URL: {}", args.ws_url);

    let server = VRFServer::new(&args.rpc_url, &args.program_id, oracle_keypair, vrf_keypair)?;

    if let Err(e) = server.run().await {
        eprintln!("Server error: {}", e);
    }

    Ok(())
}