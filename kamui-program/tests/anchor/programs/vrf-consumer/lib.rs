use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hash;

declare_id!("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6");

#[program]
pub mod vrf_consumer {
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
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        // Prepare request parameters
        let game_state = &mut ctx.accounts.game_state;
        let owner = ctx.accounts.owner.key();
        
        // Update game state
        game_state.last_request_slot = Clock::get()?.slot;
        game_state.request_counter += 1;
        
        // Call the VRF program to request randomness
        let kamui_program = ctx.accounts.kamui_program.to_account_info();
        let request = ctx.accounts.request.to_account_info();
        let subscription = ctx.accounts.subscription.to_account_info();
        let request_pool = ctx.accounts.request_pool.to_account_info();
        let system_program = ctx.accounts.system_program.to_account_info();
        
        // Prepare the instruction data
        let ix = kamui_program::instruction::VrfCoordinatorInstruction::RequestRandomness {
            seed,
            callback_data: game_state.key().to_bytes().to_vec(),
            num_words: 1,
            minimum_confirmations: 1,
            callback_gas_limit,
            pool_id,
        };
        
        // Serialize instruction data
        let mut data = Vec::new();
        ix.serialize(&mut data).unwrap();
        
        // Create the instruction
        let accounts = vec![
            AccountMeta::new(owner, true),
            AccountMeta::new(request.key(), false),
            AccountMeta::new(subscription.key(), false),
            AccountMeta::new(request_pool.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ];
        
        // Create and invoke the instruction
        let instruction = solana_program::instruction::Instruction {
            program_id: kamui_program.key(),
            accounts,
            data,
        };
        
        solana_program::program::invoke_signed(
            &instruction,
            &[
                kamui_program,
                request,
                subscription,
                request_pool,
                system_program,
                ctx.accounts.owner.to_account_info(),
            ],
            &[]
        )?;
        
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
        space = 8 + GameState::SPACE,
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
pub struct GameState {
    pub owner: Pubkey,
    pub bump: u8,
    pub result: u64,
    pub last_request_slot: u64,
    pub request_counter: u64,
}

impl GameState {
    pub const SPACE: usize = 32 + 1 + 8 + 8 + 8;
}

// Helper module for interfacing with the Kamui program
#[allow(dead_code)]
mod kamui_program {
    use borsh::{BorshDeserialize, BorshSerialize};
    use solana_program::pubkey::Pubkey;

    #[derive(BorshSerialize, BorshDeserialize)]
    pub enum VrfCoordinatorInstruction {
        /// Request randomness
        RequestRandomness {
            seed: [u8; 32],
            callback_data: Vec<u8>,
            num_words: u32,
            minimum_confirmations: u8,
            callback_gas_limit: u64,
            pool_id: u8,
        },
    }
} 