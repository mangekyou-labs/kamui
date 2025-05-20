use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        pubkey::Pubkey,
        clock::Clock,
        sysvar::Sysvar,
        keccak::hash,
    },
    std::collections::BTreeMap,
};

/// Constants for request validation
pub const MINIMUM_REQUEST_CONFIRMATIONS: u8 = 1;
pub const MAXIMUM_REQUEST_CONFIRMATIONS: u8 = 255;
pub const MINIMUM_CALLBACK_GAS_LIMIT: u64 = 10_000;
pub const MAXIMUM_CALLBACK_GAS_LIMIT: u64 = 1_000_000;
pub const MAXIMUM_RANDOM_WORDS: u32 = 100;
pub const MAX_REQUESTS_PER_SUBSCRIPTION: u16 = 100;
pub const MAX_ACTIVE_ORACLES: u16 = 10;
pub const REQUEST_EXPIRY_SLOTS: u64 = 3 * 60 * 60; // 3 hours in slots
pub const ORACLE_ROTATION_FREQUENCY: u64 = 500; // Rotate oracles every 500 slots

#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Clone)]
pub enum RequestStatus {
    Pending,
    Fulfilled,
    Cancelled,
    Expired,
}

/// Enhanced Subscription with built-in request tracking
#[derive(BorshSerialize, BorshDeserialize, Debug)]
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
    pub request_keys: Vec<[u8; 16]>,
    /// Associated request pool IDs
    pub pool_ids: Vec<u8>,
}

/// Request Pool - organized by subscription
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct RequestPool {
    /// The subscription this pool belongs to
    pub subscription: Pubkey,
    /// Pool identifier
    pub pool_id: u8,
    /// Current number of requests in the pool
    pub request_count: u32,
    /// Maximum capacity of this pool
    pub max_size: u32,
    /// Map of request index to request data
    pub requests: BTreeMap<u32, RequestSummary>,
    /// Last slot this pool was processed
    pub last_processed_slot: u64,
}

/// Compact request summary for storage in pools
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
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
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct RandomnessRequest {
    /// The subscription this request belongs to
    pub subscription: Pubkey,
    /// The seed used for randomness
    pub seed: [u8; 32],
    /// The requester's program ID that will receive the callback
    pub requester: Pubkey,
    /// The callback function data
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

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct VrfResult {
    /// The randomness outputs
    pub randomness: Vec<[u8; 64]>,
    /// The VRF proof
    pub proof: Vec<u8>,
    /// Block number when proof was generated
    pub proof_slot: u64,
    /// Request ID this result is for
    pub request_id: [u8; 32],
}

/// Oracle registry for managing multiple oracles
#[derive(BorshSerialize, BorshDeserialize, Debug)]
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
    pub oracles: Vec<Pubkey>,
}

/// Enhanced oracle with stake and reputation
#[derive(BorshSerialize, BorshDeserialize, Debug)]
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
    pub fn is_request_expired(request_slot: u64, current_slot: u64) -> bool {
        current_slot.saturating_sub(request_slot) > REQUEST_EXPIRY_SLOTS
    }
    
    /// Get the next available request index
    pub fn next_request_index(&self) -> u32 {
        if self.requests.is_empty() {
            0
        } else {
            // Get the highest key and add 1
            self.requests.keys().last().unwrap() + 1
        }
    }
    
    /// Remove expired requests and return count of removed
    pub fn clean_expired_requests(&mut self) -> u32 {
        let current_slot = Clock::get().unwrap().slot;
        let expired_keys: Vec<u32> = self.requests.iter()
            .filter(|(_, request)| {
                request.status == RequestStatus::Pending && 
                Self::is_request_expired(request.request_slot, current_slot)
            })
            .map(|(k, _)| *k)
            .collect();
            
        let count = expired_keys.len() as u32;
        
        for key in expired_keys {
            if let Some(mut request) = self.requests.get_mut(&key) {
                request.status = RequestStatus::Expired;
            }
        }
        
        count
    }
} 