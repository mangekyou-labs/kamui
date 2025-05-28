use anchor_lang::{
    prelude::*,
    solana_program::keccak,
};

declare_id!("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a"); // Devnet deployed ID

pub mod state;
pub mod errors;
pub mod ecvrf; // Will need to be exported from the main crate
pub mod utils;

// Optional compressed account modules
#[cfg(feature = "compressed-accounts")]
pub mod compressed;
#[cfg(feature = "compressed-accounts")]
pub mod compressed_vrf;

use state::*;
use errors::*;

// Only import compressed modules if the feature is enabled
#[cfg(feature = "compressed-accounts")]
use compressed::*;
#[cfg(feature = "compressed-accounts")]
use compressed_vrf::*;

#[program]
pub mod kamui_vrf {
    use super::*;

    // Enhanced Subscription Management
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

    // Conditional compilation for compressed VRF features
    #[cfg(feature = "compressed-accounts")]
    pub fn create_compressed_vrf_accounts(
        ctx: Context<InitializeCompressedVrfAccount>,
        max_depth: u32,
        max_buffer_size: u32,
    ) -> Result<()> {
        // Default parameters if not specified
        let max_depth = if max_depth == 0 { 20 } else { max_depth };
        let max_buffer_size = if max_buffer_size == 0 { 8 } else { max_buffer_size };
        
        // Initialize a compressed account for VRF data
        compressed::instructions::initialize_compressed_vrf_account(
            ctx,
            max_depth,
            max_buffer_size,
        )?;
        
        msg!("Compressed VRF account created successfully");
        Ok(())
    }
    
    // Conditional compilation for compressed VRF features
    #[cfg(feature = "compressed-accounts")]
    pub fn request_compressed_randomness(
        ctx: Context<RequestCompressedRandomness>,
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    ) -> Result<()> {
        compressed_vrf::instructions::request_compressed_randomness(
            ctx,
            seed,
            callback_data,
            num_words,
            minimum_confirmations,
            callback_gas_limit,
            pool_id,
        )
    }
    
    // Conditional compilation for compressed VRF features
    #[cfg(feature = "compressed-accounts")]
    pub fn fulfill_compressed_randomness(
        ctx: Context<FulfillCompressedRandomness>,
        proof: Vec<u8>,
        public_key: Vec<u8>,
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    ) -> Result<()> {
        compressed_vrf::instructions::fulfill_compressed_randomness(
            ctx,
            proof,
            public_key,
            request_id,
            pool_id,
            request_index,
        )
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
        
        // Add pool ID to subscription
        if !subscription.pool_ids.contains(&pool_id) {
            // Update subscription directly through the mutable reference
            let subscription_mut = &mut ctx.accounts.subscription;
            if !subscription_mut.pool_ids.contains(&pool_id) {
                subscription_mut.pool_ids.push(pool_id);
            }
        }
        
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
        // Validate inputs
        require!(
            minimum_confirmations >= MINIMUM_REQUEST_CONFIRMATIONS && 
            minimum_confirmations <= MAXIMUM_REQUEST_CONFIRMATIONS,
            KamuiVrfError::InvalidConfirmations
        );
        
        require!(
            num_words > 0 && num_words <= MAXIMUM_RANDOM_WORDS,
            KamuiVrfError::InvalidWordCount
        );
        
        require!(
            callback_gas_limit >= MINIMUM_CALLBACK_GAS_LIMIT && 
            callback_gas_limit <= MAXIMUM_CALLBACK_GAS_LIMIT,
            KamuiVrfError::InvalidGasLimit
        );
        
        let subscription = &mut ctx.accounts.subscription;
        let pool = &mut ctx.accounts.request_pool;
        
        // Verify pool belongs to subscription
        require!(pool.subscription == subscription.key(), KamuiVrfError::InvalidPoolSubscription);
        require!(pool.pool_id == pool_id, KamuiVrfError::InvalidPoolId);
        
        // Check subscription capacity
        require!(
            subscription.active_requests < subscription.max_requests,
            KamuiVrfError::TooManyRequests
        );
        
        // Check subscription balance
        require!(
            subscription.balance >= subscription.min_balance,
            KamuiVrfError::InsufficientFunds
        );
        
        // Check pool capacity
        require!(
            pool.request_count < pool.max_size,
            KamuiVrfError::PoolCapacityExceeded
        );
        
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
        
        // Initialize request
        let current_slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        
        let request = &mut ctx.accounts.request;
        request.subscription = subscription.key();
        request.seed = seed;
        request.requester = requester;
        request.callback_data = callback_data;
        request.request_slot = current_slot;
        request.status = RequestStatus::Pending;
        request.num_words = num_words;
        request.callback_gas_limit = callback_gas_limit;
        request.pool_id = pool_id;
        request.request_index = request_index;
        request.request_id = request_id;
        
        // Add to pool
        let request_summary = RequestSummary {
            requester,
            seed_hash: keccak::hash(&seed).to_bytes(),
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
        let _oracle_pubkey = ctx.accounts.oracle.key();
        let request = &mut ctx.accounts.request;
        let result = &mut ctx.accounts.vrf_result;
        let pool = &mut ctx.accounts.request_pool;
        let subscription = &mut ctx.accounts.subscription;
        
        // Verify request ID
        require!(request.request_id == request_id, KamuiVrfError::InvalidRequestId);
        require!(request.pool_id == pool_id, KamuiVrfError::InvalidPoolId);
        require!(request.request_index == request_index, KamuiVrfError::InvalidRequestIndex);
        
        // Verify request status
        require!(request.status == RequestStatus::Pending, KamuiVrfError::RequestNotPending);
        
        // Verify Oracle (would normally check oracle registry here)
        // For simplicity this is omitted for now
        
        // Verify VRF proof
        // In a production implementation, this would call out to the VRF verification function
        
        // Update request status
        request.status = RequestStatus::Fulfilled;
        
        // Update pool
        if let Some(req_entry) = pool.find_request_mut(request_index) {
            req_entry.data.status = RequestStatus::Fulfilled;
        }
        
        // Store VRF result
        result.randomness = vec![];  // This would normally be derived from the proof
        result.proof = proof;
        result.proof_slot = Clock::get()?.slot;
        result.request_id = request_id;
        
        // Update subscription counters
        subscription.active_requests = subscription.active_requests.saturating_sub(1);
        
        // Remove request key from subscription
        subscription.request_keys.retain(|id| {
            let mut req_id = [0u8; 32];
            req_id[0..16].copy_from_slice(id);
            req_id != request_id
        });
        
        Ok(())
    }

    pub fn initialize_oracle_registry(
        ctx: Context<InitializeOracleRegistry>,
        min_stake: u64,
        rotation_frequency: u64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        
        registry.admin = ctx.accounts.admin.key();
        registry.oracle_count = 0;
        registry.min_stake = min_stake;
        registry.rotation_frequency = rotation_frequency;
        registry.last_rotation = Clock::get()?.slot;
        registry.oracles = Vec::new();
        
        Ok(())
    }

    pub fn register_oracle(
        ctx: Context<RegisterOracle>,
        vrf_key: [u8; 32],
        stake_amount: u64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        let oracle_config = &mut ctx.accounts.oracle_config;
        
        // Check if stake meets minimum
        require!(stake_amount >= registry.min_stake, KamuiVrfError::InsufficientStake);
        
        // Initialize oracle config
        oracle_config.authority = ctx.accounts.oracle_authority.key();
        oracle_config.vrf_key = vrf_key;
        oracle_config.stake_amount = stake_amount;
        oracle_config.reputation = 0;
        oracle_config.last_active = Clock::get()?.slot;
        oracle_config.is_active = true;
        oracle_config.fulfillment_count = 0;
        oracle_config.failure_count = 0;
        
        // Add oracle to registry if not already present
        if !registry.oracles.contains(&ctx.accounts.oracle_authority.key()) {
            registry.oracles.push(ctx.accounts.oracle_authority.key());
            registry.oracle_count += 1;
        }
        
        Ok(())
    }

    pub fn rotate_oracles(ctx: Context<RotateOracles>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        
        // Record new rotation time
        registry.last_rotation = Clock::get()?.slot;
        
        // In a production system, this would implement some logic to 
        // assign oracles to different VRF responsibilities
        
        Ok(())
    }
}

// Constants from original code
pub const MINIMUM_REQUEST_CONFIRMATIONS: u8 = 1;
pub const MAXIMUM_REQUEST_CONFIRMATIONS: u8 = 255;
pub const MINIMUM_CALLBACK_GAS_LIMIT: u64 = 10_000;
pub const MAXIMUM_CALLBACK_GAS_LIMIT: u64 = 1_000_000;
pub const MAXIMUM_RANDOM_WORDS: u32 = 100;
pub const MAX_REQUESTS_PER_SUBSCRIPTION: u16 = 100;
pub const MAX_ACTIVE_ORACLES: u16 = 10;
pub const REQUEST_EXPIRY_SLOTS: u64 = 3 * 60 * 60; // 3 hours in slots
pub const ORACLE_ROTATION_FREQUENCY: u64 = 500; // Rotate oracles every 500 slots 