use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VerifyVrfInput {
    pub alpha_string: Vec<u8>,
    pub proof_bytes: Vec<u8>,
    pub public_key_bytes: Vec<u8>,
}

impl VerifyVrfInput {
    pub fn is_valid(&self) -> bool {
        !self.alpha_string.is_empty() && 
        !self.proof_bytes.is_empty() &&
        !self.public_key_bytes.is_empty()
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct VerifyVrfInputZeroCopy {
    pub alpha_string: [u8; 64],
    pub alpha_len: u8,
    pub proof_bytes: [u8; 80],
    pub public_key_bytes: [u8; 32],
    pub _padding: [u8; 7],
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum VrfCoordinatorInstruction {
    /// Create a new enhanced subscription
    /// Accounts expected:
    /// 0. `[signer]` Subscription owner
    /// 1. `[writable]` Subscription account (PDA)
    /// 2. `[]` System program
    CreateEnhancedSubscription {
        min_balance: u64,
        confirmations: u8,
        max_requests: u16,
    },

    /// Fund a subscription
    /// Accounts expected:
    /// 0. `[signer]` Funder
    /// 1. `[writable]` Subscription account
    /// 2. `[]` System program
    FundSubscription {
        amount: u64,
    },

    /// Initialize a request pool for a subscription
    /// Accounts expected:
    /// 0. `[signer]` Subscription owner
    /// 1. `[]` Subscription account
    /// 2. `[writable]` Request pool account (PDA)
    /// 3. `[]` System program
    InitializeRequestPool {
        pool_id: u8,
        max_size: u32,
    },

    /// Request randomness with enhanced ID generation
    /// Accounts expected:
    /// 0. `[signer]` Requester
    /// 1. `[writable]` Request account (PDA)
    /// 2. `[writable]` Subscription account
    /// 3. `[writable]` Request pool account
    /// 4. `[]` System program
    RequestRandomness {
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        minimum_confirmations: u8,
        callback_gas_limit: u64,
        pool_id: u8,
    },

    /// Fulfill randomness request
    /// Accounts expected:
    /// 0. `[signer]` Oracle
    /// 1. `[writable]` Request account
    /// 2. `[writable]` VRF result account (PDA)
    /// 3. `[writable]` Request pool account
    /// 4. `[writable]` Subscription account
    /// 5. `[]` Callback program
    /// 6. `[]` System program
    FulfillRandomness {
        proof: Vec<u8>,
        public_key: Vec<u8>,
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    },

    /// Cancel a request
    /// Accounts expected:
    /// 0. `[signer]` Request owner
    /// 1. `[writable]` Request account
    /// 2. `[writable]` Request pool account
    /// 3. `[writable]` Subscription account
    CancelRequest {
        request_id: [u8; 32],
        pool_id: u8,
        request_index: u32,
    },

    /// Clean expired requests from a pool
    /// Accounts expected:
    /// 0. `[signer]` Any account (permissionless)
    /// 1. `[writable]` Request pool account
    /// 2. `[writable]` Subscription account
    CleanExpiredRequests {
        pool_id: u8,
    },

    /// Initialize Oracle Registry
    /// Accounts expected:
    /// 0. `[signer]` Admin
    /// 1. `[writable]` Oracle registry account (PDA)
    /// 2. `[]` System program
    InitializeOracleRegistry {
        min_stake: u64,
        rotation_frequency: u64,
    },

    /// Register a new oracle with stake
    /// Accounts expected:
    /// 0. `[signer]` Oracle authority
    /// 1. `[writable]` Oracle config account (PDA)
    /// 2. `[writable]` Oracle registry account
    /// 3. `[]` System program
    RegisterOracle {
        vrf_key: [u8; 32],
        stake_amount: u64,
    },

    /// Deactivate an oracle
    /// Accounts expected:
    /// 0. `[signer]` Oracle authority or admin
    /// 1. `[writable]` Oracle config account
    /// 2. `[writable]` Oracle registry account
    DeactivateOracle,

    /// Process a batch of randomness requests
    /// Accounts expected:
    /// 0. `[signer]` Oracle
    /// 1. `[writable]` Oracle config account
    /// 2. `[writable]` Request pool account
    /// 3. `[]` System program
    /// + Variable number of request and result accounts
    ProcessRequestBatch {
        request_ids: Vec<[u8; 32]>,
        proofs: Vec<Vec<u8>>,
        public_keys: Vec<Vec<u8>>,
        pool_id: u8,
        request_indices: Vec<u32>,
    },
    
    /// Rotate active oracles
    /// Accounts expected:
    /// 0. `[signer]` Admin or permissionless
    /// 1. `[writable]` Oracle registry account
    RotateOracles,
    
    /// Update oracle reputation based on performance
    /// Accounts expected:
    /// 0. `[signer]` Admin or permissionless
    /// 1. `[writable]` Oracle config account
    /// 2. `[writable]` Oracle registry account
    UpdateOracleReputation {
        oracle_authority: Pubkey,
        successful_fulfillments: u16,
        failed_fulfillments: u16,
    },
}

impl VrfCoordinatorInstruction {
    /// Unpacks a byte buffer into a VrfCoordinatorInstruction
    pub fn unpack(input: &[u8]) -> Result<Self, std::io::Error> {
        Self::try_from_slice(input)
    }
} 