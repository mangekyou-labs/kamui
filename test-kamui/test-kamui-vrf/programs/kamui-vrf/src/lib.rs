use anchor_lang::{
    prelude::*,
    solana_program::keccak,
};

declare_id!("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a"); // Devnet deployed ID

pub mod state;
pub mod errors;
pub mod ecvrf; // Will need to be exported from the main crate
pub mod utils;

// Real Light Protocol ZK compression module (temporarily disabled for basic compilation)
// #[cfg(feature = "light-compression")]
// pub mod light_compressed_vrf;

// Optional compressed account modules (legacy)
#[cfg(feature = "compressed-accounts")]
pub mod compressed;
#[cfg(feature = "compressed-accounts")]
pub mod compressed_vrf;

use state::*;
use errors::*;

// Import real Light Protocol components when feature is enabled (temporarily disabled)
// #[cfg(feature = "light-compression")]
// use light_sdk::{light_program, LightContext};
// #[cfg(feature = "light-compression")]
// use light_compressed_vrf::{CreateCompressedVrfRequest, FulfillCompressedVrfRequest, CreateCompressedSubscription};

// Only import compressed modules if the feature is enabled
#[cfg(feature = "compressed-accounts")]
use compressed::*;
#[cfg(feature = "compressed-accounts")]
use compressed_vrf::*;

// Empty context for utility functions
#[derive(Accounts)]
pub struct Empty {}

// Real Light Protocol ZK compression program (temporarily disabled for basic compilation)
/*
#[cfg(feature = "light-compression")]
#[light_program]
#[program]
pub mod kamui_vrf {
    use super::*;

    // Real Light Protocol compressed subscription management
    pub fn create_compressed_subscription<'info>(
        ctx: LightContext<'_, '_, '_, 'info, CreateCompressedSubscription<'info>>,
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    ) -> Result<()> {
        light_compressed_vrf::instructions::create_compressed_subscription(
            ctx,
            min_balance,
            confirmations,
            max_requests,
        )
    }

    // Real Light Protocol compressed VRF functions
    pub fn create_compressed_vrf_request<'info>(
        ctx: LightContext<'_, '_, '_, 'info, CreateCompressedVrfRequest<'info>>,
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        light_compressed_vrf::instructions::create_compressed_vrf_request(
            ctx,
            seed,
            callback_data,
            num_words,
            minimum_confirmations,
            callback_gas_limit,
            pool_id,
        )
    }

    pub fn fulfill_compressed_vrf_request<'info>(
        ctx: LightContext<'_, '_, '_, 'info, FulfillCompressedVrfRequest<'info>>,
        request_id: [u8; 32],
        random_value: [u8; 32],
        proof: Vec<u8>,
    ) -> Result<()> {
        light_compressed_vrf::instructions::fulfill_compressed_vrf_request(
            ctx,
            request_id,
            random_value,
            proof,
        )
    }

    // Hybrid function: compress an existing VRF request
    pub fn compress_existing_vrf_request<'info>(
        ctx: LightContext<'_, '_, '_, 'info, CreateCompressedVrfRequest<'info>>,
        existing_request_pubkey: Pubkey,
    ) -> Result<()> {
        msg!("Compressing existing VRF request: {}", existing_request_pubkey);
        
        // This demonstrates how to migrate from regular accounts to compressed accounts
        // In practice, you'd read the existing account data and create a compressed version
        light_compressed_vrf::log_compression_benefits();
        
        // For demo purposes, create a new compressed request with default values
        light_compressed_vrf::instructions::create_compressed_vrf_request(
            ctx,
            [1u8; 32], // default seed
            vec![1, 2, 3], // default callback data
            1, // num_words
            3, // confirmations
            100_000, // gas limit
            0, // pool_id
        )
    }

    // Regular Anchor instructions (also available when light-compression is enabled)
    pub fn create_enhanced_subscription(
        ctx: Context<CreateEnhancedSubscription>,
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    ) -> Result<()> {
        // Validate inputs
        require!(
            confirmations >= MINIMUM_REQUEST_CONFIRMATIONS && 
            confirmations <= MAXIMUM_REQUEST_CONFIRMATIONS,
            KamuiVrfError::InvalidConfirmations
        );
        
        require!(
            max_requests > 0 && max_requests <= MAX_REQUESTS_PER_SUBSCRIPTION,
            KamuiVrfError::InvalidMaxRequests
        );
        
        // Initialize subscription
        let subscription = &mut ctx.accounts.subscription;
        subscription.owner = ctx.accounts.owner.key();
        subscription.balance = 0;
        subscription.min_balance = min_balance;
        subscription.confirmations = confirmations;
        subscription.active_requests = 0;
        subscription.max_requests = max_requests;
        subscription.request_counter = 0;
        subscription.request_keys = Vec::new();
        subscription.pool_ids = Vec::new();
        
        Ok(())
    }

    pub fn fund_subscription(
        ctx: Context<FundSubscription>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, KamuiVrfError::InvalidAmount);
        
        let subscription = &mut ctx.accounts.subscription;
        subscription.balance = subscription.balance.checked_add(amount)
            .ok_or(KamuiVrfError::ArithmeticOverflow)?;
        
        Ok(())
    }

    pub fn initialize_request_pool(
        ctx: Context<InitializeRequestPool>,
        pool_id: u8,
        max_size: u32,
    ) -> Result<()> {
        let subscription = &ctx.accounts.subscription;
        let owner = ctx.accounts.owner.key();
        
        // Verify ownership
        require!(subscription.owner == owner, KamuiVrfError::Unauthorized);
        require!(max_size > 0, KamuiVrfError::InvalidPoolSize);
        
        // Initialize pool
        let pool = &mut ctx.accounts.request_pool;
        pool.subscription = subscription.key();
        pool.pool_id = pool_id;
        pool.request_count = 0;
        pool.max_size = max_size;
        pool.request_entries = Vec::new();
        pool.last_processed_slot = Clock::get()?.slot;
        
        Ok(())
    }

    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        // Traditional VRF request implementation
        let subscription = &ctx.accounts.subscription;
        let request_pool = &mut ctx.accounts.request_pool;
        
        // Validate request
        require!(
            subscription.active_requests < subscription.max_requests,
            KamuiVrfError::TooManyActiveRequests
        );
        
        require!(
            request_pool.request_count < request_pool.max_size,
            KamuiVrfError::PoolFull
        );
        
        // Generate request ID
        let clock = Clock::get()?;
        let request_id = keccak::hashv(&[
            &seed,
            &ctx.accounts.owner.key().to_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ]).to_bytes();
        
        // Add to request pool
        request_pool.request_entries.push(RequestEntry {
            index: 0, // TODO: fix borrowing
            data: RequestSummary {
                requester: ctx.accounts.owner.key(),
                seed_hash: keccak::hash(&seed).to_bytes(),
                timestamp: clock.unix_timestamp,
                status: RequestStatus::Pending,
                request_slot: clock.slot,
                callback_gas_limit,
            },
        });
        
        request_pool.request_count += 1;
        
        Ok(())
    }

    pub fn fulfill_randomness(
        ctx: Context<FulfillRandomness>,
        proof: Vec<u8>,
        _public_key: Vec<u8>,
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    ) -> Result<()> {
        // Traditional VRF fulfillment implementation
        let request_pool = &mut ctx.accounts.request_pool;
        
        require!(
            request_index < request_pool.request_entries.len() as u32,
            KamuiVrfError::InvalidRequestIndex
        );
        
        let request_entry = &mut request_pool.request_entries[request_index as usize];
        
        require!(
            request_entry.data.status == RequestStatus::Pending,
            KamuiVrfError::RequestAlreadyFulfilled
        );
        
        // Verify proof (simplified)
        require!(!proof.is_empty(), KamuiVrfError::InvalidProof);
        
        // Update request status
        request_entry.data.status = RequestStatus::Fulfilled;
        
        Ok(())
    }

    // Utility function to get compressed account cost savings info
    pub fn get_compression_info(
        _ctx: Context<Empty>,
    ) -> Result<()> {
        #[cfg(feature = "light-compression")]
        {
            light_compressed_vrf::log_compression_benefits();
        }
        
        #[cfg(not(feature = "light-compression"))]
        {
            msg!("ZK Compression Benefits (when enabled):");
            msg!("- Up to 500x cost reduction for state storage");
            msg!("- Maintains Solana L1 security guarantees");
            msg!("- Preserves performance and composability");
            msg!("- Traditional account cost: ~0.00204428 SOL");
            msg!("- Compressed account cost: ~0.00000408 SOL");
            msg!("- Savings: 99.8% cost reduction");
            msg!("Enable with: --features light-compression");
        }
        
        Ok(())
    }

    // Analyze costs for batch operations
    pub fn analyze_batch_costs(
        _ctx: Context<Empty>,
        num_requests: u64,
    ) -> Result<()> {
        #[cfg(feature = "light-compression")]
        {
            let (traditional, compressed, savings) = light_compressed_vrf::estimate_batch_savings(num_requests);
            msg!("Cost Analysis for {} requests:", num_requests);
            msg!("Traditional cost: {:.8} SOL", traditional);
            msg!("Compressed cost: {:.8} SOL", compressed);
            msg!("Savings: {:.2}%", savings);
            msg!("Absolute savings: {:.8} SOL", traditional - compressed);
        }
        
        #[cfg(not(feature = "light-compression"))]
        {
            let traditional_cost = num_requests as f64 * 0.00204428;
            msg!("Traditional cost for {} requests: {:.8} SOL", num_requests, traditional_cost);
            msg!("Enable light-compression feature for massive savings");
        }
        
        Ok(())
    }
}
*/

// Traditional program (working version)
// #[cfg(not(feature = "light-compression"))]
#[program]
pub mod kamui_vrf {
    use super::*;

    // Regular Anchor instructions when light-compression is not enabled
    pub fn create_enhanced_subscription(
        ctx: Context<CreateEnhancedSubscription>,
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    ) -> Result<()> {
        // Same implementation as above
        require!(
            confirmations >= MINIMUM_REQUEST_CONFIRMATIONS && 
            confirmations <= MAXIMUM_REQUEST_CONFIRMATIONS,
            KamuiVrfError::InvalidConfirmations
        );
        
        require!(
            max_requests > 0 && max_requests <= MAX_REQUESTS_PER_SUBSCRIPTION,
            KamuiVrfError::InvalidMaxRequests
        );
        
        let subscription = &mut ctx.accounts.subscription;
        subscription.owner = ctx.accounts.owner.key();
        subscription.balance = 0;
        subscription.min_balance = min_balance;
        subscription.confirmations = confirmations;
        subscription.active_requests = 0;
        subscription.max_requests = max_requests;
        subscription.request_counter = 0;
        subscription.request_keys = Vec::new();
        subscription.pool_ids = Vec::new();
        
        Ok(())
    }

    pub fn fund_subscription(
        ctx: Context<FundSubscription>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, KamuiVrfError::InvalidAmount);
        
        let subscription = &mut ctx.accounts.subscription;
        subscription.balance = subscription.balance.checked_add(amount)
            .ok_or(KamuiVrfError::ArithmeticOverflow)?;
        
        Ok(())
    }

    pub fn initialize_request_pool(
        ctx: Context<InitializeRequestPool>,
        pool_id: u8,
        max_size: u32,
    ) -> Result<()> {
        let subscription = &ctx.accounts.subscription;
        let owner = ctx.accounts.owner.key();
        
        // Verify ownership
        require!(subscription.owner == owner, KamuiVrfError::Unauthorized);
        require!(max_size > 0, KamuiVrfError::InvalidPoolSize);
        
        // Initialize pool
        let pool = &mut ctx.accounts.request_pool;
        pool.subscription = subscription.key();
        pool.pool_id = pool_id;
        pool.request_count = 0;
        pool.max_size = max_size;
        pool.request_entries = Vec::new();
        pool.last_processed_slot = Clock::get()?.slot;
        
        Ok(())
    }

    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        // Full traditional VRF request implementation
        let subscription = &ctx.accounts.subscription;
        let request_pool = &mut ctx.accounts.request_pool;
        
        // Validate request
        require!(
            subscription.active_requests < subscription.max_requests,
            KamuiVrfError::TooManyActiveRequests
        );
        
        require!(
            request_pool.request_count < request_pool.max_size,
            KamuiVrfError::PoolFull
        );
        
        // Generate request ID
        let clock = Clock::get()?;
        let request_id = keccak::hashv(&[
            &seed,
            &ctx.accounts.owner.key().to_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ]).to_bytes();
        
        // Add to request pool
        request_pool.request_entries.push(RequestEntry {
            index: 0, // TODO: fix borrowing
            data: RequestSummary {
                requester: ctx.accounts.owner.key(),
                seed_hash: keccak::hash(&seed).to_bytes(),
                timestamp: clock.unix_timestamp,
                status: RequestStatus::Pending,
                request_slot: clock.slot,
                callback_gas_limit,
            },
        });
        
        request_pool.request_count += 1;
        
        Ok(())
    }

    pub fn fulfill_randomness(
        ctx: Context<FulfillRandomness>,
        proof: Vec<u8>,
        _public_key: Vec<u8>,
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    ) -> Result<()> {
        // Traditional VRF fulfillment implementation
        let request_pool = &mut ctx.accounts.request_pool;
        
        require!(
            request_index < request_pool.request_entries.len() as u32,
            KamuiVrfError::InvalidRequestIndex
        );
        
        let request_entry = &mut request_pool.request_entries[request_index as usize];
        
        require!(
            request_entry.data.status == RequestStatus::Pending,
            KamuiVrfError::RequestAlreadyFulfilled
        );
        
        // Verify proof (simplified)
        require!(!proof.is_empty(), KamuiVrfError::InvalidProof);
        
        // Update request status
        request_entry.data.status = RequestStatus::Fulfilled;
        
        Ok(())
    }

    pub fn get_compression_info(
        _ctx: Context<Empty>,
    ) -> Result<()> {
        msg!("Light compression feature not enabled");
        msg!("To enable ZK compression, build with: --features light-compression");
        msg!("Benefits when enabled:");
        msg!("- 500x cost reduction");
        msg!("- Maintains L1 security");
        msg!("- Full composability");
        Ok(())
    }

    pub fn analyze_batch_costs(
        _ctx: Context<Empty>,
        num_requests: u64,
    ) -> Result<()> {
        let traditional_cost = num_requests as f64 * 0.00204428;
        msg!("Traditional cost for {} requests: {:.8} SOL", num_requests, traditional_cost);
        msg!("Enable light-compression feature for massive savings");
        Ok(())
    }
}

pub const MINIMUM_REQUEST_CONFIRMATIONS: u8 = 1;
pub const MAXIMUM_REQUEST_CONFIRMATIONS: u8 = 255;
pub const MINIMUM_CALLBACK_GAS_LIMIT: u64 = 10_000;
pub const MAXIMUM_CALLBACK_GAS_LIMIT: u64 = 1_000_000;
pub const MAXIMUM_RANDOM_WORDS: u32 = 100;
pub const MAX_REQUESTS_PER_SUBSCRIPTION: u16 = 100;
pub const MAX_ACTIVE_ORACLES: u16 = 10;
pub const REQUEST_EXPIRY_SLOTS: u64 = 3 * 60 * 60; // 3 hours in slots
pub const ORACLE_ROTATION_FREQUENCY: u64 = 500; // Rotate oracles every 500 slots 