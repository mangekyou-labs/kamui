use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{keccak::hashv, pubkey::Pubkey},
    std::collections::BTreeMap,
};

pub const SUBSCRIPTION_DISCRIMINATOR: [u8; 8] = *b"SUBSCRIP";
pub const REQUEST_POOL_DISCRIMINATOR: [u8; 8] = [80, 79, 79, 76, 0, 0, 0, 0];
pub const REQUEST_DISCRIMINATOR: [u8; 8] = [82, 69, 81, 85, 69, 83, 84, 0];
pub const RESULT_DISCRIMINATOR: [u8; 8] = [82, 69, 83, 85, 76, 84, 0, 0];
pub const REGISTRY_DISCRIMINATOR: [u8; 8] = *b"REGISTRY";
pub const ORACLE_DISCRIMINATOR: [u8; 8] = [79, 82, 65, 67, 76, 69, 0, 0];

pub const MINIMUM_REQUEST_CONFIRMATIONS: u8 = 1;
pub const MAXIMUM_REQUEST_CONFIRMATIONS: u8 = 255;
pub const MINIMUM_CALLBACK_GAS_LIMIT: u64 = 10_000;
pub const MAXIMUM_CALLBACK_GAS_LIMIT: u64 = 1_000_000;
pub const MAXIMUM_RANDOM_WORDS: u32 = 100;
pub const MAX_REQUESTS_PER_SUBSCRIPTION: u16 = 100;
pub const MAX_ACTIVE_ORACLES: u16 = 10;
pub const MAX_CALLBACK_DATA_LEN: usize = 1024;
pub const MAX_PROOF_LEN: usize = 512;
pub const REQUEST_EXPIRY_SLOTS: u64 = 3 * 60 * 60;
pub const ORACLE_ROTATION_FREQUENCY: u64 = 500;

pub const REQUEST_SUMMARY_SERIALIZED_SIZE: usize = 32 + 32 + 8 + 1 + 8 + 8;
pub const ENHANCED_ORACLE_SERIALIZED_SIZE: usize = 32 + 32 + 8 + 2 + 8 + 1 + 8 + 8;

#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq, Clone, Copy)]
pub enum RequestStatus {
    Pending,
    Fulfilled,
    Cancelled,
    Expired,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EnhancedSubscription {
    pub owner: Pubkey,
    pub balance: u64,
    pub min_balance: u64,
    pub confirmations: u8,
    pub active_requests: u16,
    pub max_requests: u16,
    pub request_counter: u64,
    pub request_keys: Vec<[u8; 16]>,
    pub pool_ids: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RequestPool {
    pub subscription: Pubkey,
    pub pool_id: u8,
    pub request_count: u32,
    pub max_size: u32,
    pub requests: BTreeMap<u32, RequestSummary>,
    pub last_processed_slot: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RequestSummary {
    pub requester: Pubkey,
    pub seed_hash: [u8; 32],
    pub timestamp: i64,
    pub status: RequestStatus,
    pub request_slot: u64,
    pub callback_gas_limit: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RandomnessRequest {
    pub subscription: Pubkey,
    pub seed: [u8; 32],
    pub requester: Pubkey,
    pub callback_data: Vec<u8>,
    pub request_slot: u64,
    pub status: RequestStatus,
    pub num_words: u32,
    pub callback_gas_limit: u64,
    pub pool_id: u8,
    pub request_index: u32,
    pub request_id: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VrfResult {
    pub randomness: Vec<[u8; 64]>,
    pub proof: Vec<u8>,
    pub proof_slot: u64,
    pub request_id: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct OracleRegistry {
    pub admin: Pubkey,
    pub oracle_count: u16,
    pub min_stake: u64,
    pub rotation_frequency: u64,
    pub last_rotation: u64,
    pub oracles: Vec<Pubkey>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EnhancedOracle {
    pub authority: Pubkey,
    pub vrf_key: [u8; 32],
    pub stake_amount: u64,
    pub reputation: u16,
    pub last_active: u64,
    pub is_active: bool,
    pub fulfillment_count: u64,
    pub failure_count: u64,
}

impl EnhancedSubscription {
    pub fn space(max_requests: u16, max_pools: usize) -> usize {
        8 + 32 + 8 + 8 + 1 + 2 + 2 + 8 + (4 + (max_requests as usize * 16)) + (4 + max_pools)
    }

    pub fn truncated_request_key(request_id: &[u8; 32]) -> [u8; 16] {
        let mut key = [0u8; 16];
        key.copy_from_slice(&request_id[..16]);
        key
    }

    pub fn track_request(&mut self, request_id: &[u8; 32]) {
        self.request_keys
            .push(Self::truncated_request_key(request_id));
        self.request_counter = self.request_counter.saturating_add(1);
    }

    pub fn untrack_request(&mut self, request_id: &[u8; 32]) {
        let key = Self::truncated_request_key(request_id);
        if let Some(position) = self.request_keys.iter().position(|k| *k == key) {
            self.request_keys.remove(position);
        }
    }
}

impl RequestPool {
    pub fn space(max_size: u32) -> usize {
        let entries = max_size as usize;
        let map_space = 4 + entries * (4 + REQUEST_SUMMARY_SERIALIZED_SIZE);
        8 + 32 + 1 + 4 + 4 + map_space + 8
    }

    pub fn generate_request_id(
        seed: &[u8; 32],
        requester: &Pubkey,
        subscription: &Pubkey,
        pool_id: u8,
        request_index: u32,
        current_slot: u64,
        timestamp: i64,
    ) -> [u8; 32] {
        hashv(&[
            seed,
            &requester.to_bytes(),
            &subscription.to_bytes(),
            &current_slot.to_le_bytes(),
            &timestamp.to_le_bytes(),
            &[pool_id],
            &request_index.to_le_bytes(),
        ])
        .to_bytes()
    }

    pub fn is_request_expired(request_slot: u64, current_slot: u64) -> bool {
        current_slot.saturating_sub(request_slot) > REQUEST_EXPIRY_SLOTS
    }

    pub fn next_request_index(&self) -> Option<u32> {
        self.requests
            .keys()
            .next_back()
            .copied()
            .map_or(Some(0), |last| last.checked_add(1))
    }

    pub fn collect_expired_pending(&self, current_slot: u64) -> Vec<u32> {
        self.requests
            .iter()
            .filter_map(|(index, request)| {
                (request.status == RequestStatus::Pending
                    && Self::is_request_expired(request.request_slot, current_slot))
                .then_some(*index)
            })
            .collect()
    }

    pub fn mark_expired(&mut self, request_indexes: &[u32]) -> u32 {
        let mut updated = 0u32;
        for index in request_indexes {
            if let Some(request) = self.requests.get_mut(index) {
                if request.status == RequestStatus::Pending {
                    request.status = RequestStatus::Expired;
                    updated = updated.saturating_add(1);
                }
            }
        }
        updated
    }
}

impl RandomnessRequest {
    pub fn space(callback_data_len: usize) -> usize {
        8 + 32 + 32 + 32 + (4 + callback_data_len) + 8 + 1 + 4 + 8 + 1 + 4 + 32
    }
}

impl VrfResult {
    pub fn space(num_words: usize, proof_len: usize) -> usize {
        8 + (4 + (num_words * 64)) + (4 + proof_len) + 8 + 32
    }
}

impl OracleRegistry {
    pub fn space(max_oracles: usize) -> usize {
        8 + 32 + 2 + 8 + 8 + 8 + (4 + max_oracles * 32)
    }
}

impl EnhancedOracle {
    pub fn space() -> usize {
        8 + ENHANCED_ORACLE_SERIALIZED_SIZE
    }
}
