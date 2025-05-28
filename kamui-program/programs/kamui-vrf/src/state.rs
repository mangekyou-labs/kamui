use anchor_lang::prelude::*;
use anchor_lang::solana_program::{clock::Clock, keccak::hash, sysvar::Sysvar};
use anchor_lang::Space;

// Enum definitions
#[derive(Clone, PartialEq, Debug, AnchorSerialize, AnchorDeserialize)]
pub enum RequestStatus {
    Pending,
    Fulfilled,
    Cancelled,
    Expired,
}

impl Space for RequestStatus {
    const INIT_SPACE: usize = 1; // Enum discriminant size
}

// Enhanced Subscription with built-in request tracking
#[account]
#[derive(InitSpace)]
pub struct EnhancedSubscription {
    /// The owner of this subscription
    pub owner: Pubkey,
    /// Current balance for VRF requests
    pub balance: u64,
    /// Minimum balance required for requests
    pub min_balance: u64,
    /// Number of confirmations required before generating VRF proof
    pub confirmations: u8,
    /// Number of active requests
    pub active_requests: u16,
    /// Maximum allowed concurrent requests
    pub max_requests: u16,
    /// Current request counter (for generating unique IDs)
    pub request_counter: u64,
    /// Truncated hashes of active request keys for quick lookup
    #[max_len(16)]
    pub request_keys: Vec<[u8; 16]>,
    /// Associated request pool IDs
    #[max_len(16)]
    pub pool_ids: Vec<u8>,
}

/// Request Pool - organized by subscription
#[account]
#[derive(InitSpace)]
pub struct RequestPool {
    /// The subscription this pool belongs to
    pub subscription: Pubkey,
    /// Pool identifier
    pub pool_id: u8,
    /// Current number of requests in the pool
    pub request_count: u32,
    /// Maximum capacity of this pool
    pub max_size: u32,
    /// List of request summaries in the pool
    #[max_len(64)]
    pub request_entries: Vec<RequestEntry>,
    /// Last slot this pool was processed
    pub last_processed_slot: u64,
}

/// Request entry for storage in pools
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct RequestEntry {
    /// Request index
    pub index: u32,
    /// Request summary data
    pub data: RequestSummary,
}

/// Compact request summary for storage in pools
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct RequestSummary {
    /// The requestor's program ID
    pub requester: Pubkey,
    /// Hash of the original seed (for verification)
    pub seed_hash: [u8; 32],
    /// Timestamp of request creation
    pub timestamp: i64,
    /// Current status of the request
    pub status: RequestStatus,
    /// Block height when request was made
    pub request_slot: u64,
    /// Callback gas limit
    pub callback_gas_limit: u64,
}

/// Detailed request data for processing
#[account]
#[derive(InitSpace)]
pub struct RandomnessRequest {
    /// The subscription this request belongs to
    pub subscription: Pubkey,
    /// The seed used for randomness
    pub seed: [u8; 32],
    /// The requester's program ID that will receive the callback
    pub requester: Pubkey,
    /// The callback function data
    #[max_len(256)]
    pub callback_data: Vec<u8>,
    /// Block number when request was made
    pub request_slot: u64,
    /// Status of the request
    pub status: RequestStatus,
    /// Number of random words requested
    pub num_words: u32,
    /// Maximum compute units for callback
    pub callback_gas_limit: u64,
    /// Request pool ID
    pub pool_id: u8,
    /// Request index in pool
    pub request_index: u32,
    /// Unique request identifier
    pub request_id: [u8; 32],
}

/// VRF result data
#[account]
#[derive(InitSpace)]
pub struct VrfResult {
    /// The randomness outputs
    #[max_len(100)]
    pub randomness: Vec<[u8; 64]>,
    /// The VRF proof
    #[max_len(512)]
    pub proof: Vec<u8>,
    /// Block number when proof was generated
    pub proof_slot: u64,
    /// Request ID this result is for
    pub request_id: [u8; 32],
}

/// VRF Result stored in a compressed account format
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct CompressedVrfResult {
    /// The randomness outputs
    #[max_len(100)]
    pub randomness: Vec<[u8; 64]>,
    /// The VRF proof
    #[max_len(512)]
    pub proof: Vec<u8>,
    /// Block number when proof was generated
    pub proof_slot: u64,
    /// Request ID this result is for
    pub request_id: [u8; 32],
    /// Compression metadata
    pub compressed: bool,
    /// Proof verification status
    pub verified: bool,
}

/// Compressed randomness request to reduce fees
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct CompressedRandomnessRequest {
    /// The subscription this request belongs to
    pub subscription: Pubkey,
    /// The seed used for randomness
    pub seed: [u8; 32],
    /// The requester's program ID that will receive the callback
    pub requester: Pubkey,
    /// The callback function data (compressed for efficiency)
    #[max_len(256)]
    pub callback_data: Vec<u8>,
    /// Block number when request was made
    pub request_slot: u64,
    /// Status of the request
    pub status: RequestStatus,
    /// Number of random words requested
    pub num_words: u32,
    /// Maximum compute units for callback
    pub callback_gas_limit: u64,
    /// Request pool ID
    pub pool_id: u8,
    /// Request index in pool
    pub request_index: u32,
    /// Unique request identifier
    pub request_id: [u8; 32],
    /// Compressed storage flag
    pub compressed: bool,
}

/// Structure to hold multiple compressed VRF requests
#[account]
#[derive(InitSpace)]
pub struct CompressedRequestBatch {
    /// The subscription this batch belongs to
    pub subscription: Pubkey,
    /// Current number of requests in the batch
    pub request_count: u32,
    /// Maximum capacity of this batch
    pub max_size: u32,
    /// List of compressed request entries
    #[max_len(64)]
    pub request_entries: Vec<CompressedRequestEntry>,
    /// Merkle tree address for compressed storage
    pub merkle_tree: Pubkey,
}

/// Compressed request entry for storage in batches
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct CompressedRequestEntry {
    /// Request index
    pub index: u32,
    /// Compressed request summary data
    pub data: RequestSummary,
    /// Compressed account leaf index
    pub leaf_index: u64,
}

/// Oracle registry for managing multiple oracles
#[account]
#[derive(InitSpace)]
pub struct OracleRegistry {
    /// Admin authority
    pub admin: Pubkey,
    /// Current number of active oracles
    pub oracle_count: u16,
    /// Minimum stake amount required
    pub min_stake: u64,
    /// Slots between oracle rotation
    pub rotation_frequency: u64,
    /// Last slot when oracles were rotated
    pub last_rotation: u64,
    /// List of oracle public keys
    #[max_len(50)]
    pub oracles: Vec<Pubkey>,
}

/// Enhanced oracle with stake and reputation
#[account]
#[derive(InitSpace)]
pub struct EnhancedOracle {
    /// The oracle's authority
    pub authority: Pubkey,
    /// The oracle's VRF public key
    pub vrf_key: [u8; 32],
    /// Staked amount
    pub stake_amount: u64,
    /// Reputation score (successful fulfillments)
    pub reputation: u16,
    /// Last active slot
    pub last_active: u64,
    /// Whether the oracle is active
    pub is_active: bool,
    /// Number of successful fulfillments
    pub fulfillment_count: u64,
    /// Number of failed fulfillments
    pub failure_count: u64,
}

// Implement utility functions for RequestPool
impl RequestPool {
    /// Generate a unique request ID
    pub fn generate_request_id(
        seed: &[u8; 32],
        requester: &Pubkey,
        subscription: &Pubkey,
        pool_id: u8,
        request_index: u32,
    ) -> [u8; 32] {
        let current_slot = Clock::get().unwrap().slot;
        let timestamp = Clock::get().unwrap().unix_timestamp;
        
        let mut data_to_hash = Vec::with_capacity(32 + 32 + 32 + 8 + 8 + 1 + 4);
        data_to_hash.extend_from_slice(seed);
        data_to_hash.extend_from_slice(&requester.to_bytes());
        data_to_hash.extend_from_slice(&subscription.to_bytes());
        data_to_hash.extend_from_slice(&current_slot.to_le_bytes());
        data_to_hash.extend_from_slice(&timestamp.to_le_bytes());
        data_to_hash.push(pool_id);
        data_to_hash.extend_from_slice(&request_index.to_le_bytes());
        
        hash(&data_to_hash).to_bytes()
    }
    
    /// Check if a request is expired
    pub fn is_request_expired(request_slot: u64, current_slot: u64, expiry_slots: u64) -> bool {
        current_slot.saturating_sub(request_slot) > expiry_slots
    }
    
    /// Get the next available request index
    pub fn next_request_index(&self) -> u32 {
        if self.request_entries.is_empty() {
            0
        } else {
            // Get the highest index and add 1
            self.request_entries.iter()
                .map(|entry| entry.index)
                .max()
                .unwrap_or(0) + 1
        }
    }
    
    /// Find a request entry by index
    pub fn find_request(&self, index: u32) -> Option<&RequestEntry> {
        self.request_entries.iter().find(|entry| entry.index == index)
    }
    
    /// Find a mutable request entry by index
    pub fn find_request_mut(&mut self, index: u32) -> Option<&mut RequestEntry> {
        self.request_entries.iter_mut().find(|entry| entry.index == index)
    }
    
    /// Add a request entry
    pub fn add_request(&mut self, index: u32, summary: RequestSummary) {
        self.request_entries.push(RequestEntry {
            index,
            data: summary,
        });
    }
    
    /// Remove expired requests and return count of removed
    pub fn clean_expired_requests(&mut self, expiry_slots: u64) -> u32 {
        let current_slot = Clock::get().unwrap().slot;
        let mut expired_count = 0;
        
        for entry in self.request_entries.iter_mut() {
            if entry.data.status == RequestStatus::Pending && 
               Self::is_request_expired(entry.data.request_slot, current_slot, expiry_slots) {
                entry.data.status = RequestStatus::Expired;
                expired_count += 1;
            }
        }
        
        expired_count
    }
}

// Context structs for instructions

#[derive(Accounts)]
pub struct CreateEnhancedSubscription<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + EnhancedSubscription::INIT_SPACE,
        seeds = [b"subscription", seed.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    /// CHECK: This account is used only as a seed for the subscription PDA and is not read or written to
    pub seed: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundSubscription<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    
    #[account(mut)]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u8, max_size: u32)]
pub struct InitializeRequestPool<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        constraint = subscription.owner == owner.key()
    )]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + RequestPool::INIT_SPACE,
        seeds = [
            b"request_pool", 
            subscription.key().as_ref(),
            &[pool_id]
        ],
        bump
    )]
    pub request_pool: Account<'info, RequestPool>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(seed: [u8; 32], callback_data: Vec<u8>, num_words: u32, minimum_confirmations: u8, callback_gas_limit: u64, pool_id: u8)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + RandomnessRequest::INIT_SPACE,
    )]
    pub request: Account<'info, RandomnessRequest>,
    
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
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof: Vec<u8>, _public_key: Vec<u8>, request_id: [u8; 32], pool_id: u8, request_index: u32)]
pub struct FulfillRandomness<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    
    #[account(
        mut,
        constraint = request.request_id == request_id,
        constraint = request.status == RequestStatus::Pending
    )]
    pub request: Account<'info, RandomnessRequest>,
    
    #[account(
        init,
        payer = oracle,
        space = 8 + VrfResult::INIT_SPACE,
        seeds = [b"vrf_result", request.key().as_ref()],
        bump
    )]
    pub vrf_result: Account<'info, VrfResult>,
    
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
        constraint = request.subscription == subscription.key()
    )]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeOracleRegistry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + OracleRegistry::INIT_SPACE,
        seeds = [b"oracle_registry"],
        bump
    )]
    pub registry: Account<'info, OracleRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterOracle<'info> {
    #[account(mut)]
    pub oracle_authority: Signer<'info>,
    
    #[account(
        init,
        payer = oracle_authority,
        space = 8 + EnhancedOracle::INIT_SPACE,
        seeds = [b"oracle_config", oracle_authority.key().as_ref()],
        bump
    )]
    pub oracle_config: Account<'info, EnhancedOracle>,
    
    #[account(
        mut,
        seeds = [b"oracle_registry"],
        bump
    )]
    pub registry: Account<'info, OracleRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RotateOracles<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"oracle_registry"],
        bump,
        constraint = registry.admin == admin.key() || registry.last_rotation + registry.rotation_frequency <= Clock::get().unwrap().slot
    )]
    pub registry: Account<'info, OracleRegistry>,
} 