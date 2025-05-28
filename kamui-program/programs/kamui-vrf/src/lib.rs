use anchor_lang::{
    prelude::*,
    solana_program::keccak,
};

declare_id!("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a"); // Devnet deployed ID

pub mod state;
pub mod errors;
pub mod ecvrf; // Will need to be exported from the main crate
pub mod utils;

// Light Protocol ZK compression module
#[cfg(feature = "light-compression")]
pub mod light_compressed_vrf;

// Optional compressed account modules (legacy)
#[cfg(feature = "compressed-accounts")]
pub mod compressed;
#[cfg(feature = "compressed-accounts")]
pub mod compressed_vrf;

use state::*;
use errors::*;

// Import Light Protocol components when feature is enabled
#[cfg(feature = "light-compression")]
use light_compressed_vrf::{CreateCompressedVrfRequest, FulfillCompressedVrfRequest};

// Only import compressed modules if the feature is enabled
#[cfg(feature = "compressed-accounts")]
use compressed::*;
#[cfg(feature = "compressed-accounts")]
use compressed_vrf::*;

#[program]
pub mod kamui_vrf {
    use super::*;

    // Light Protocol compressed VRF functions
    #[cfg(feature = "light-compression")]
    pub fn create_compressed_vrf_request(
        ctx: Context<CreateCompressedVrfRequest>,
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

    #[cfg(feature = "light-compression")]
    pub fn fulfill_compressed_vrf_request(
        ctx: Context<FulfillCompressedVrfRequest>,
        random_value: [u8; 32],
        proof: Vec<u8>,
    ) -> Result<()> {
        light_compressed_vrf::instructions::fulfill_compressed_vrf_request(
            ctx,
            random_value,
            proof,
        )
    }

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

    // Conditional compilation for compressed VRF features (legacy)
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
    
    // Conditional compilation for compressed VRF features (legacy)
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
    
    // Conditional compilation for compressed VRF features (legacy)
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
        
        let subscription = &ctx.accounts.subscription;
        let pool = &mut ctx.accounts.request_pool;
        
        // Verify pool belongs to subscription
        require!(pool.subscription == subscription.key(), KamuiVrfError::InvalidPoolSubscription);
        require!(pool.pool_id == pool_id, KamuiVrfError::InvalidPoolId);
        
        // Check capacity
        require!(
            (pool.request_count as usize) < pool.max_size as usize,
            KamuiVrfError::PoolCapacityExceeded
        );
        
        // Check subscription limits
        require!(
            subscription.active_requests < subscription.max_requests,
            KamuiVrfError::TooManyRequests
        );
        
        // Initialize VRF request using the proper field names
        let request = &mut ctx.accounts.request;
        request.subscription = subscription.key();
        request.pool_id = pool_id;
        request.requester = ctx.accounts.owner.key();
        request.seed = seed;
        request.callback_data = callback_data;
        request.num_words = num_words;
        request.callback_gas_limit = callback_gas_limit;
        request.status = RequestStatus::Pending;
        request.request_index = pool.request_count;
        request.request_slot = Clock::get()?.slot;
        
        // Generate request ID
        request.request_id = RequestPool::generate_request_id(
            &seed,
            &ctx.accounts.owner.key(),
            &subscription.key(),
            pool_id,
            pool.request_count,
        );
        
        // Update pool
        pool.request_count += 1;
        
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
        let request = &mut ctx.accounts.request;
        let vrf_result = &mut ctx.accounts.vrf_result;
        let pool = &ctx.accounts.request_pool;
        
        // Verify request is pending
        require!(
            request.status == RequestStatus::Pending,
            KamuiVrfError::RequestNotPending
        );
        
        // Verify pool information
        require!(request.pool_id == pool_id, KamuiVrfError::InvalidPoolId);
        require!(request.request_index == request_index, KamuiVrfError::InvalidRequestIndex);
        
        // Verify proof (simplified verification)
        if proof.is_empty() {
            return Err(KamuiVrfError::ProofVerificationFailed.into());
        }
        
        // Generate random value from request_id (for demonstration)
        let random_value = keccak::hash(&request_id).to_bytes();
        
        // Update request status
        request.status = RequestStatus::Fulfilled;
        
        // Store VRF result - convert [u8; 32] to [u8; 64] by padding with zeros
        let mut padded_random_value = [0u8; 64];
        padded_random_value[..32].copy_from_slice(&random_value);
        
        vrf_result.randomness = vec![padded_random_value]; 
        vrf_result.proof = proof;
        vrf_result.proof_slot = Clock::get()?.slot;
        vrf_result.request_id = request_id;
        
        msg!("VRF request fulfilled with random value: {:?}", hex::encode(random_value));
        
        Ok(())
    }

    pub fn initialize_oracle_registry(
        ctx: Context<InitializeOracleRegistry>,
        min_stake: u64,
        rotation_frequency: u64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.admin = ctx.accounts.admin.key();
        registry.min_stake = min_stake;
        registry.rotation_frequency = rotation_frequency;
        registry.last_rotation = Clock::get()?.slot;
        registry.oracles = Vec::new();
        registry.oracle_count = 0;
        
        Ok(())
    }

    pub fn register_oracle(
        ctx: Context<RegisterOracle>,
        vrf_key: [u8; 32],
        stake_amount: u64,
    ) -> Result<()> {
        let registry = &ctx.accounts.registry;
        let oracle_config = &mut ctx.accounts.oracle_config;
        
        require!(stake_amount >= registry.min_stake, KamuiVrfError::InsufficientStake);
        
        oracle_config.authority = ctx.accounts.oracle_authority.key();
        oracle_config.vrf_key = vrf_key;
        oracle_config.stake_amount = stake_amount;
        oracle_config.reputation = 0;
        oracle_config.last_active = Clock::get()?.slot;
        oracle_config.is_active = true;
        oracle_config.fulfillment_count = 0;
        oracle_config.failure_count = 0;
        
        // Add to registry
        let registry_mut = &mut ctx.accounts.registry;
        if !registry_mut.oracles.contains(&ctx.accounts.oracle_authority.key()) {
            registry_mut.oracles.push(ctx.accounts.oracle_authority.key());
            registry_mut.oracle_count += 1;
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

pub const MINIMUM_REQUEST_CONFIRMATIONS: u8 = 1;
pub const MAXIMUM_REQUEST_CONFIRMATIONS: u8 = 255;
pub const MINIMUM_CALLBACK_GAS_LIMIT: u64 = 10_000;
pub const MAXIMUM_CALLBACK_GAS_LIMIT: u64 = 1_000_000;
pub const MAXIMUM_RANDOM_WORDS: u32 = 100;
pub const MAX_REQUESTS_PER_SUBSCRIPTION: u16 = 100;
pub const MAX_ACTIVE_ORACLES: u16 = 10;
pub const REQUEST_EXPIRY_SLOTS: u64 = 3 * 60 * 60; // 3 hours in slots
pub const ORACLE_ROTATION_FREQUENCY: u64 = 500; // Rotate oracles every 500 slots 