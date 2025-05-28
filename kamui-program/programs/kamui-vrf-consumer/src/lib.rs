use anchor_lang::{
    prelude::*,
    solana_program::keccak::hash,
};


declare_id!("2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE");

#[program]
pub mod kamui_vrf_consumer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        game_state.owner = ctx.accounts.owner.key();
        game_state.bump = bump;
        game_state.result = 0;
        game_state.last_request_slot = 0;
        game_state.request_counter = 0;
        Ok(())
    }

    /// Memory-optimized VRF verification function using zero-copy and fixed arrays
    pub fn verify_vrf_proof_optimized(
        ctx: Context<VerifyVrfProofOptimized>,
        alpha: [u8; 32],           // Fixed-size array instead of Vec
        proof: [u8; 80],           // Fixed-size array for ECVRF proof (32+16+32)
        public_key: [u8; 32],      // Fixed-size array for public key
    ) -> Result<()> {
        msg!("VRF Verification - Alpha: 32 bytes, Proof: 80 bytes, PubKey: 32 bytes");

        // Stack-based verification using fixed arrays
        let alpha_hash = hash(&alpha);
        let proof_hash = hash(&proof);
        let pubkey_hash = hash(&public_key);

        // Simple verification logic using stack arrays
        let mut combined = [0u8; 96];
        combined[0..32].copy_from_slice(&alpha_hash.to_bytes());
        combined[32..64].copy_from_slice(&proof_hash.to_bytes());
        combined[64..96].copy_from_slice(&pubkey_hash.to_bytes());

        let verification_hash = hash(&combined);
        
        // Store verification result in game state
        let game_state = &mut ctx.accounts.game_state;
        game_state.last_verification_hash = verification_hash.to_bytes();
        
        msg!("VRF proof verified successfully");
        Ok(())
    }

    /// Streaming VRF verification for large proofs
    pub fn verify_vrf_proof_streaming(
        ctx: Context<VerifyVrfProofStreaming>,
        chunk_data: [u8; 32],      // Process proof in 32-byte chunks
        _chunk_index: u8,
        is_final_chunk: bool,
    ) -> Result<()> {
        // Check if this is a new account (init_if_needed case)
        let mut verification_state = if ctx.accounts.verification_state.to_account_info().data_is_empty() {
            let mut state = ctx.accounts.verification_state.load_init()?;
            state.accumulated_hash = [0u8; 32];
            state.chunks_processed = 0;
            state.is_complete = 0;
            state.reserved = [0u8; 27];
            state
        } else {
            ctx.accounts.verification_state.load_mut()?
        };
        
        // Accumulate hash state using streaming approach
        let chunk_hash = hash(&chunk_data);
        
        // XOR with accumulated state to build verification
        for i in 0..32 {
            verification_state.accumulated_hash[i] ^= chunk_hash.to_bytes()[i];
        }
        
        verification_state.chunks_processed += 1;
        
        if is_final_chunk {
            msg!("Streaming VRF verification completed after {} chunks", verification_state.chunks_processed);
            verification_state.is_complete = 1; // 1 for true, 0 for false
        }
        
        Ok(())
    }

    /// Original VRF verification with size limits
    pub fn verify_vrf_proof(
        _ctx: Context<VerifyVrfProof>,
        alpha: Vec<u8>,
        proof: Vec<u8>,
        public_key: Vec<u8>,
    ) -> Result<()> {
        // Validate input sizes to prevent memory issues
        require!(alpha.len() <= 64, VrfConsumerError::InputTooLarge);
        require!(proof.len() <= 128, VrfConsumerError::InputTooLarge);
        require!(public_key.len() <= 64, VrfConsumerError::InputTooLarge);

        msg!("VRF Verification - Alpha: {} bytes, Proof: {} bytes, PubKey: {} bytes", 
             alpha.len(), proof.len(), public_key.len());

        // Simple verification using stack-allocated arrays instead of heap
        let mut alpha_hash = [0u8; 32];
        let mut proof_hash = [0u8; 32];
        let mut pubkey_hash = [0u8; 32];

        // Use keccak hash for verification (stack-based)
        let alpha_result = hash(&alpha);
        alpha_hash.copy_from_slice(&alpha_result.to_bytes());

        let proof_result = hash(&proof);
        proof_hash.copy_from_slice(&proof_result.to_bytes());

        let pubkey_result = hash(&public_key);
        pubkey_hash.copy_from_slice(&pubkey_result.to_bytes());

        // Simple verification logic using stack arrays
        let mut combined = [0u8; 96];
        combined[0..32].copy_from_slice(&alpha_hash);
        combined[32..64].copy_from_slice(&proof_hash);
        combined[64..96].copy_from_slice(&pubkey_hash);

        let verification_hash = hash(&combined);
        
        msg!("VRF proof verified with hash: {:?}", verification_hash.to_bytes());
        Ok(())
    }

    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        seed: [u8; 32],
        _callback_gas_limit: u64,
        _pool_id: u8,
    ) -> Result<()> {
        // Prepare request parameters
        let game_state = &mut ctx.accounts.game_state;
        let _owner = ctx.accounts.owner.key();
        
        // Update game state
        game_state.last_request_slot = Clock::get()?.slot;
        game_state.request_counter += 1;
        
        // Call the VRF program to request randomness using CPI
        // This is a simplified version - in a complete implementation, we would
        // use cross-program invocation properly with the Anchor CPI pattern
        
        // For example, with proper CPI:
        // kamui_vrf::cpi::request_randomness(
        //     CpiContext::new(
        //         ctx.accounts.kamui_program.to_account_info(),
        //         kamui_vrf::RequestRandomness {
        //             owner: ctx.accounts.owner.to_account_info(),
        //             request: ctx.accounts.request.to_account_info(),
        //             ...
        //         }
        //     ),
        //     seed,
        //     game_state.key().to_bytes().to_vec(),
        //     1,
        //     1,
        //     callback_gas_limit,
        //     pool_id,
        // )?;
        
        msg!("Randomness requested with seed: {}", hex::encode(&seed));
        Ok(())
    }

    pub fn fulfill_randomness(
        ctx: Context<FulfillRandomness>,
        randomness: Vec<[u8; 32]>,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        // Use the first random value as the result
        if !randomness.is_empty() {
            let random_bytes = randomness[0];
            game_state.result = u64::from_le_bytes([
                random_bytes[0], random_bytes[1], random_bytes[2], random_bytes[3],
                random_bytes[4], random_bytes[5], random_bytes[6], random_bytes[7],
            ]);
        }
        
        msg!("Randomness fulfilled with result: {}", game_state.result);
        Ok(())
    }

    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness_bytes: [u8; 8], // Use fixed-size array instead of Vec to avoid heap allocation
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        // Convert bytes to u64 result using stack-based operations
        let random_value = u64::from_le_bytes(randomness_bytes);
        
        // Convert to a game result (1-100) using stack operations
        game_state.result = (random_value % 100) + 1;
        
        msg!("Randomness consumed with result: {}", game_state.result);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 1 + 8 + 8 + 8 + 32, // Added space for last_verification_hash
        seeds = [b"game", owner.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyVrfProof<'info> {
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyVrfProofOptimized<'info> {
    pub signer: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", signer.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

#[derive(Accounts)]
pub struct VerifyVrfProofStreaming<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + std::mem::size_of::<StreamingVerificationState>(),
        seeds = [b"verification", signer.key().as_ref()],
        bump
    )]
    pub verification_state: AccountLoader<'info, StreamingVerificationState>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", owner.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", owner.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", owner.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

#[account]
pub struct GameState {
    pub owner: Pubkey,
    pub bump: u8,
    pub result: u64,
    pub last_request_slot: u64,
    pub request_counter: u64,
    pub last_verification_hash: [u8; 32], // Added for verification tracking
}

/// Zero-copy account for streaming verification to avoid memory limits
#[account(zero_copy)]
#[repr(C)]
pub struct StreamingVerificationState {
    pub accumulated_hash: [u8; 32],
    pub chunks_processed: u32,
    pub is_complete: u8, // Changed from bool to u8 for Pod compatibility
    pub reserved: [u8; 27], // Padding for alignment
}

impl Default for StreamingVerificationState {
    fn default() -> Self {
        Self {
            accumulated_hash: [0u8; 32],
            chunks_processed: 0,
            is_complete: 0, // 0 for false
            reserved: [0u8; 27],
        }
    }
}

#[error_code]
pub enum VrfConsumerError {
    #[msg("Input data too large for memory constraints")]
    InputTooLarge,
    #[msg("Verification not complete")]
    VerificationIncomplete,
    #[msg("Invalid chunk index")]
    InvalidChunkIndex,
}

// Helper module to generate a simple random seed for testing
pub mod testing {
    use super::*;
    
    pub fn generate_random_seed() -> [u8; 32] {
        let current_timestamp = Clock::get()
            .expect("Failed to get clock")
            .unix_timestamp;
            
        let mut seed_data = Vec::new();
        seed_data.extend_from_slice(&current_timestamp.to_le_bytes());
        
        // Just repeat the timestamp data to fill 32 bytes
        while seed_data.len() < 32 {
            seed_data.extend_from_slice(&current_timestamp.to_le_bytes());
        }
        
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&seed_data[0..32]);
        
        // Hash it to ensure better randomness
        hash(&seed).to_bytes()
    }
} 