use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{msg, pubkey::Pubkey},
    base64::Engine,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum VrfEvent {
    RandomnessRequested {
        request_id: [u8; 32],
        requester: Pubkey,
        subscription: Pubkey,
        seed: [u8; 32],
        pool_id: u8,
        request_index: u32,
    },
    RandomnessFulfilled {
        request_id: [u8; 32],
        requester: Pubkey,
        randomness: [u8; 64],
        oracle: Pubkey,
    },
    SubscriptionCreated {
        subscription: Pubkey,
        owner: Pubkey,
        min_balance: u64,
        max_requests: u16,
    },
    SubscriptionFunded {
        subscription: Pubkey,
        funder: Pubkey,
        amount: u64,
    },
    RequestCancelled {
        request_id: [u8; 32],
        subscription: Pubkey,
        pool_id: u8,
        request_index: u32,
    },
    RequestPoolInitialized {
        subscription: Pubkey,
        pool_id: u8,
        max_size: u32,
    },
    RequestPoolCleaned {
        subscription: Pubkey,
        pool_id: u8,
        expired_count: u32,
    },
    OracleRegistryInitialized {
        admin: Pubkey,
        min_stake: u64,
        rotation_frequency: u64,
    },
    OracleRegistered {
        authority: Pubkey,
        oracle_account: Pubkey,
        stake_amount: u64,
    },
    OracleDeactivated {
        authority: Pubkey,
        oracle_account: Pubkey,
    },
    OraclesRotated {
        registry: Pubkey,
        active_count: u16,
    },
    OracleReputationUpdated {
        authority: Pubkey,
        oracle_account: Pubkey,
        reputation: u16,
    },
    BatchProcessed {
        oracle: Pubkey,
        pool_id: u8,
        count: u32,
    },
    RequestExpired {
        request_id: [u8; 32],
        subscription: Pubkey,
        pool_id: u8,
        request_index: u32,
    },
}

impl VrfEvent {
    pub fn emit(&self) {
        let data = borsh::to_vec(self).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        msg!("VRF_EVENT:{}", b64);
    }
} 