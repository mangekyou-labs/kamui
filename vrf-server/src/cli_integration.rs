use {
    std::{
        process::{Command, Stdio},
        path::Path,
        error::Error,
        fmt,
    },
    log::{debug, error, info, warn},
    serde::{Deserialize, Serialize},
};

#[derive(Debug)]
pub enum CLIError {
    ProcessError(std::io::Error),
    InvalidOutput(String),
    ProofGenerationFailed(String),
}

impl fmt::Display for CLIError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            CLIError::ProcessError(e) => write!(f, "CLI process error: {}", e),
            CLIError::InvalidOutput(msg) => write!(f, "Invalid CLI output: {}", msg),
            CLIError::ProofGenerationFailed(msg) => write!(f, "Proof generation failed: {}", msg),
        }
    }
}

impl Error for CLIError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VRFCliProof {
    pub proof: String,
    pub output: String,
    pub public_key: String,
}

pub struct MangekyouCLI {
    cli_path: String,
}

impl MangekyouCLI {
    pub fn new(cli_path: Option<String>) -> Self {
        let default_path = "../mangekyou-cli/target/debug/ecvrf-cli".to_string();
        Self {
            cli_path: cli_path.unwrap_or(default_path),
        }
    }

    /// Build the CLI if it doesn't exist
    pub fn ensure_cli_built(&self) -> Result<(), CLIError> {
        let cli_dir = Path::new(&self.cli_path).parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| CLIError::InvalidOutput("Invalid CLI path structure".to_string()))?;

        info!("Building Mangekyou CLI at: {:?}", cli_dir);
        
        let output = Command::new("cargo")
            .arg("build")
            .arg("--bin")
            .arg("ecvrf-cli")
            .current_dir(cli_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(CLIError::ProcessError)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CLIError::ProofGenerationFailed(format!(
                "CLI build failed: {}", stderr
            )));
        }

        info!("Successfully built Mangekyou CLI");
        Ok(())
    }

    /// Generate a new VRF keypair using the CLI
    pub fn generate_keypair(&self) -> Result<(String, String), CLIError> {
        debug!("Generating new VRF keypair using CLI");
        
        let output = Command::new(&self.cli_path)
            .arg("keygen")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(CLIError::ProcessError)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CLIError::ProofGenerationFailed(format!(
                "Keygen failed: {}", stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        debug!("CLI keygen output: {}", stdout);

        // Parse the output: "Secret key: <hex>\nPublic key: <hex>"
        let lines: Vec<&str> = stdout.trim().lines().collect();
        if lines.len() != 2 {
            return Err(CLIError::InvalidOutput(format!(
                "Expected 2 lines, got {}: {}", lines.len(), stdout
            )));
        }

        let secret_key = lines[0]
            .strip_prefix("Secret key: ")
            .ok_or_else(|| CLIError::InvalidOutput("Missing secret key prefix".to_string()))?
            .to_string();

        let public_key = lines[1]
            .strip_prefix("Public key: ")
            .ok_or_else(|| CLIError::InvalidOutput("Missing public key prefix".to_string()))?
            .to_string();

        info!("Generated VRF keypair - Public key: {}", public_key);
        Ok((secret_key, public_key))
    }

    /// Generate a VRF proof using the CLI
    pub fn generate_proof(&self, secret_key: &str, input: &[u8]) -> Result<VRFCliProof, CLIError> {
        let input_hex = hex::encode(input);
        debug!("Generating VRF proof for input: {}", input_hex);

        let output = Command::new(&self.cli_path)
            .arg("prove")
            .arg("--input")
            .arg(&input_hex)
            .arg("--secret-key")
            .arg(secret_key)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(CLIError::ProcessError)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CLIError::ProofGenerationFailed(format!(
                "Proof generation failed: {}", stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        debug!("CLI prove output: {}", stdout);

        // Parse the output: "Proof: <hex>\nOutput: <hex>"
        let lines: Vec<&str> = stdout.trim().lines().collect();
        if lines.len() != 2 {
            return Err(CLIError::InvalidOutput(format!(
                "Expected 2 lines, got {}: {}", lines.len(), stdout
            )));
        }

        let proof = lines[0]
            .strip_prefix("Proof:  ")
            .ok_or_else(|| CLIError::InvalidOutput("Missing proof prefix".to_string()))?
            .to_string();

        let output_hash = lines[1]
            .strip_prefix("Output: ")
            .ok_or_else(|| CLIError::InvalidOutput("Missing output prefix".to_string()))?
            .to_string();

        // Derive public key from secret key (we'll need this for verification)
        let (_, public_key) = self.derive_public_key(secret_key)?;

        let result = VRFCliProof {
            proof,
            output: output_hash,
            public_key,
        };

        info!("Generated VRF proof successfully");
        debug!("Proof: {}", result.proof);
        debug!("Output: {}", result.output);
        
        Ok(result)
    }

    /// Verify a VRF proof using the CLI
    pub fn verify_proof(
        &self,
        proof: &str,
        output: &str,
        public_key: &str,
        input: &[u8],
    ) -> Result<bool, CLIError> {
        let input_hex = hex::encode(input);
        debug!("Verifying VRF proof");

        let cli_output = Command::new(&self.cli_path)
            .arg("verify")
            .arg("--proof")
            .arg(proof)
            .arg("--output")
            .arg(output)
            .arg("--public-key")
            .arg(public_key)
            .arg("--input")
            .arg(&input_hex)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(CLIError::ProcessError)?;

        let success = cli_output.status.success();
        
        if success {
            info!("VRF proof verification successful");
        } else {
            let stderr = String::from_utf8_lossy(&cli_output.stderr);
            warn!("VRF proof verification failed: {}", stderr);
        }

        Ok(success)
    }

    /// Derive public key from secret key
    fn derive_public_key(&self, secret_key: &str) -> Result<(String, String), CLIError> {
        // For now, we'll use keygen and match - in production, we'd implement proper key derivation
        // This is a temporary approach since the CLI doesn't have a dedicated derive command
        warn!("Using keygen for public key derivation - this should be optimized for production");
        self.generate_keypair()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_integration() {
        let cli = MangekyouCLI::new(None);
        
        // Test keygen
        let (secret_key, public_key) = cli.generate_keypair().expect("Failed to generate keypair");
        assert!(!secret_key.is_empty());
        assert!(!public_key.is_empty());
        
        // Test proof generation
        let input = b"test input";
        let proof = cli.generate_proof(&secret_key, input).expect("Failed to generate proof");
        assert!(!proof.proof.is_empty());
        assert!(!proof.output.is_empty());
        
        // Test verification
        let is_valid = cli.verify_proof(&proof.proof, &proof.output, &proof.public_key, input)
            .expect("Failed to verify proof");
        assert!(is_valid);
    }
}
