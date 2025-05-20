use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use crate::state::*;
use crate::errors::*;
use crate::compressed::*;

/// Context for requesting compressed randomness
#[derive(Accounts)]
#[instruction(pool_id: u8)]
pub struct RequestCompressedRandomness<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// CHECK: Account created by Light System Program
    #[account(mut)]
    pub compressed_account: UncheckedAccount<'info>,
    
    #[account(
        mut,
        constraint = subscription.balance >= subscription.min_balance,
        constraint = subscription.active_requests < subscription.max_requests
    )]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    #[account(
        mut,
        seeds = [
            b"request_pool", 
            subscription.key().as_ref(),
            &[pool_id]
        ],
        bump,
        constraint = request_pool.subscription == subscription.key(),
        constraint = request_pool.pool_id == pool_id,
        constraint = request_pool.request_count < request_pool.max_size
    )]
    pub request_pool: Account<'info, RequestPool>,
    
    /// CHECK: State tree account for compressed storage
    #[account(mut)]
    pub state_tree: UncheckedAccount<'info>,
    
    /// CHECK: Light System Program for compressed accounts
    #[account(
        constraint = light_system_program.key().to_string() == LIGHT_SYSTEM_PROGRAM_ID
    )]
    pub light_system_program: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Implementation of compressed randomness request functions
pub mod instructions {
    use super::*;
    
    /// Request randomness using compressed accounts to reduce fees
    pub fn request_compressed_randomness(
        ctx: Context<RequestCompressedRandomness>,
        seed: [u8; 32],
        _callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        // Validate inputs similar to standard request_randomness
        require!(
            minimum_confirmations >= crate::MINIMUM_REQUEST_CONFIRMATIONS && 
            minimum_confirmations <= crate::MAXIMUM_REQUEST_CONFIRMATIONS,
            KamuiVrfError::InvalidConfirmations
        );
        
        require!(
            num_words > 0 && num_words <= crate::MAXIMUM_RANDOM_WORDS,
            KamuiVrfError::InvalidWordCount
        );
        
        require!(
            callback_gas_limit >= crate::MINIMUM_CALLBACK_GAS_LIMIT && 
            callback_gas_limit <= crate::MAXIMUM_CALLBACK_GAS_LIMIT,
            KamuiVrfError::InvalidGasLimit
        );
        
        let subscription = &mut ctx.accounts.subscription;
        let pool = &mut ctx.accounts.request_pool;
        
        // Get the next request index
        let request_index = pool.next_request_index();
        
        // Generate request ID
        let requester = ctx.accounts.owner.key();
        let request_id = RequestPool::generate_request_id(
            &seed,
            &requester,
            &subscription.key(),
            pool_id,
            request_index,
        );
        
        // Create a CompressedRandomnessRequest structure (mock implementation)
        msg!("Creating compressed randomness request (mock implementation)");
        msg!("Request ID: {:?}", request_id);
        
        // Add to pool
        let current_slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        
        let request_summary = RequestSummary {
            requester,
            seed_hash: anchor_lang::solana_program::keccak::hash(&seed).to_bytes(),
            timestamp,
            status: RequestStatus::Pending,
            request_slot: current_slot,
            callback_gas_limit,
        };
        
        pool.add_request(request_index, request_summary);
        pool.request_count += 1;
        
        // Update subscription
        subscription.active_requests += 1;
        
        // Store truncated request ID in subscription
        let mut truncated_id = [0u8; 16];
        truncated_id.copy_from_slice(&request_id[0..16]);
        subscription.request_keys.push(truncated_id);
        
        // Increment request counter
        subscription.request_counter = subscription.request_counter.checked_add(1)
            .ok_or(KamuiVrfError::ArithmeticOverflow)?;
        
        msg!("Created compressed randomness request with ID: {:?}", request_id);
        
        Ok(())
    }
    
    /// Fulfill a compressed randomness request
    pub fn fulfill_compressed_randomness(
        ctx: Context<FulfillCompressedRandomness>,
        _proof: Vec<u8>,
        _public_key: Vec<u8>,
        request_id: [u8; 32],
        _pool_id: u8,
        request_index: u32,
    ) -> Result<()> {
        // Mock implementation for testing purposes
        msg!("Fulfilling compressed randomness request (mock implementation)");
        msg!("Request ID: {:?}", request_id);
        
        // Update subscription active requests count
        let subscription = &mut ctx.accounts.subscription;
        subscription.active_requests = subscription.active_requests.saturating_sub(1);
        
        // Update request pool
        let pool = &mut ctx.accounts.request_pool;
        if let Some(req_entry) = pool.find_request_mut(request_index) {
            req_entry.data.status = RequestStatus::Fulfilled;
        }
        
        // Remove request key from subscription
        subscription.request_keys.retain(|id| {
            let mut req_id = [0u8; 32];
            req_id[0..16].copy_from_slice(id);
            req_id != request_id
        });
        
        Ok(())
    }
}

/// Context for fulfilling compressed randomness
#[derive(Accounts)]
#[instruction(proof: Vec<u8>, public_key: Vec<u8>, request_id: [u8; 32], pool_id: u8, request_index: u32)]
pub struct FulfillCompressedRandomness<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    
    /// CHECK: Compressed account for the request
    #[account(mut)]
    pub compressed_request: UncheckedAccount<'info>,
    
    /// CHECK: Compressed account for the result
    #[account(mut)]
    pub compressed_result: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [
            b"request_pool", 
            subscription.key().as_ref(),
            &[pool_id]
        ],
        bump,
        constraint = request_pool.subscription == subscription.key(),
        constraint = request_pool.pool_id == pool_id
    )]
    pub request_pool: Account<'info, RequestPool>,
    
    #[account(
        mut,
        constraint = compressed_request_data.owner == &LIGHT_SYSTEM_PROGRAM_ID.parse::<Pubkey>().unwrap()
    )]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    /// CHECK: State tree for compressed storage
    #[account(mut)]
    pub state_tree: UncheckedAccount<'info>,
    
    /// CHECK: Light System Program for compressed accounts
    #[account(
        constraint = light_system_program.key().to_string() == LIGHT_SYSTEM_PROGRAM_ID
    )]
    pub light_system_program: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    
    // Remaining account is the decompressed request data
    /// CHECK: This contains the decompressed request data
    pub compressed_request_data: UncheckedAccount<'info>,
} 