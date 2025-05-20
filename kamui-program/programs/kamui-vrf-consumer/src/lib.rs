use anchor_lang::{
    prelude::*,
    solana_program::keccak::hash,
};

declare_id!("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6");

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

    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness: [u8; 64]
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        // Convert the randomness to a u64 value for simple usage
        let rand_bytes = &randomness[0..8];
        let mut rand_value = [0u8; 8];
        rand_value.copy_from_slice(rand_bytes);
        let rand_u64 = u64::from_le_bytes(rand_value);
        
        // Use the randomness to generate a number between 1 and 100
        game_state.result = (rand_u64 % 100) + 1;
        
        msg!("Consumed randomness: result = {}", game_state.result);
        
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
        space = 8 + GameState::INIT_SPACE,
        seeds = [b"game", owner.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", owner.key().as_ref()],
        bump = game_state.bump,
    )]
    pub game_state: Account<'info, GameState>,
    
    /// CHECK: This is the Kamui VRF program
    pub kamui_program: AccountInfo<'info>,
    
    /// CHECK: This is the request account that will be initialized by the Kamui program
    pub request: AccountInfo<'info>,
    
    /// CHECK: This is the subscription account used for VRF
    pub subscription: AccountInfo<'info>,
    
    /// CHECK: This is the request pool account
    pub request_pool: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_state.owner.as_ref()],
        bump = game_state.bump,
    )]
    pub game_state: Account<'info, GameState>,
}

#[account]
#[derive(InitSpace)]
pub struct GameState {
    pub owner: Pubkey,
    pub bump: u8,
    pub result: u64,
    pub last_request_slot: u64,
    pub request_counter: u64,
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