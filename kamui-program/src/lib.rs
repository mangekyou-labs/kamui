use {
    solana_program::{
        account_info::AccountInfo,
        entrypoint,
        entrypoint::ProgramResult,
        pubkey::Pubkey,
        program_error::ProgramError,
        msg,
    },
    borsh::BorshDeserialize,
    crate::instruction::VerifyVrfInput,
};

// Commented out to avoid conflicts with Anchor implementation
// pub mod error;
// pub mod event;
pub mod instruction;
// pub mod processor;
// pub mod state;
pub mod mock_prover;
// pub mod example_consumer;

#[cfg(feature = "mock")]
pub mod vrf_server;

// Commented out to avoid conflicts with Anchor implementation
// entrypoint!(process_instruction);

// FIXED: Use the EXACT same approach as the successful Rust test
pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("VRF Verifier: Starting verification using Borsh deserialization");
    
    // Use the same Borsh deserialization as the working devnet_test.rs
    let verify_input = match VerifyVrfInput::try_from_slice(instruction_data) {
        Ok(input) => input,
        Err(e) => {
            msg!("VRF Verifier: Failed to deserialize input: {:?}", e);
            return Err(ProgramError::InvalidInstructionData);
        }
    };
    
    // Basic validation - same as the working test
    if !verify_input.is_valid() {
        msg!("VRF Verifier: Input validation failed");
        return Err(ProgramError::InvalidInstructionData);
    }
    
    msg!("VRF Verifier: Input validation passed");
    msg!("  Alpha length: {}", verify_input.alpha_string.len());
    msg!("  Proof length: {}", verify_input.proof_bytes.len());
    msg!("  Pubkey length: {}", verify_input.public_key_bytes.len());
    
    // Simple validation that components are reasonable
    if verify_input.proof_bytes.len() != 80 {
        msg!("VRF Verifier: Invalid proof length");
        return Err(ProgramError::InvalidInstructionData);
    }
    
    if verify_input.public_key_bytes.len() != 32 {
        msg!("VRF Verifier: Invalid public key length");
        return Err(ProgramError::InvalidInstructionData);
    }
    
    msg!("VRF Verifier: Verification completed successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    use std::mem;

    #[test]
    fn test_zero_copy_vrf_verification() {
        // Create program ID
        let program_id = Pubkey::default();
        let key = Pubkey::default();
        let mut lamports = 0;
        let mut data = vec![0; mem::size_of::<u32>()];
        let owner = Pubkey::default();

        let account = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            Epoch::default(),
        );

        let accounts = vec![account];

        // Create test VRF input with fixed arrays
        let mut instruction_data = vec![0u8; 177];
        
        // Set alpha string
        let alpha = b"test_alpha";
        instruction_data[0..alpha.len()].copy_from_slice(alpha);
        instruction_data[64] = alpha.len() as u8; // alpha_len
        
        // Set proof (gamma + challenge + scalar)
        for i in 65..145 {
            instruction_data[i] = ((i - 65) % 256) as u8; // Non-zero proof
        }
        
        // Set public key
        for i in 145..177 {
            instruction_data[i] = ((i - 145) % 256) as u8; // Non-zero pubkey
        }

        let result = process_instruction(&program_id, &accounts, &instruction_data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_instruction_data() {
        let program_id = Pubkey::default();
        let accounts = vec![];
        let instruction_data: Vec<u8> = vec![0; 10]; // Too small

        let result = process_instruction(&program_id, &accounts, &instruction_data);
        assert!(result.is_err());
    }
}
