use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use std::io::{Error, ErrorKind};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct VerifyVrfInput {
    pub alpha_string: Vec<u8>,
    pub proof_bytes: Vec<u8>,
    pub public_key_bytes: Vec<u8>,
}

impl VerifyVrfInput {
    pub fn is_valid(&self) -> bool {
        !self.alpha_string.is_empty()
            && !self.proof_bytes.is_empty()
            && !self.public_key_bytes.is_empty()
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
    FundSubscription { amount: u64 },

    /// Initialize a request pool for a subscription
    /// Accounts expected:
    /// 0. `[signer]` Subscription owner
    /// 1. `[]` Subscription account
    /// 2. `[writable]` Request pool account (PDA)
    /// 3. `[]` System program
    InitializeRequestPool { pool_id: u8, max_size: u32 },

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
    CleanExpiredRequests { pool_id: u8 },

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
    fn parse_tagged(input: &[u8]) -> Result<Self, std::io::Error> {
        if input.len() < 8 {
            return Err(Error::new(
                ErrorKind::UnexpectedEof,
                "instruction data too short for tagged format",
            ));
        }
        if !input[1..8].iter().all(|byte| *byte == 0) {
            return Err(Error::new(
                ErrorKind::InvalidData,
                "invalid tagged instruction header",
            ));
        }

        let mut payload = &input[8..];
        let instruction = match input[0] {
            0 => {
                let args = CreateEnhancedSubscriptionArgs::deserialize(&mut payload)?;
                Self::CreateEnhancedSubscription {
                    min_balance: args.min_balance,
                    confirmations: args.confirmations,
                    max_requests: args.max_requests,
                }
            }
            1 => {
                let args = FundSubscriptionArgs::deserialize(&mut payload)?;
                Self::FundSubscription {
                    amount: args.amount,
                }
            }
            2 => {
                let args = InitializeRequestPoolArgs::deserialize(&mut payload)?;
                Self::InitializeRequestPool {
                    pool_id: args.pool_id,
                    max_size: args.max_size,
                }
            }
            3 => {
                let args = RequestRandomnessArgs::deserialize(&mut payload)?;
                Self::RequestRandomness {
                    seed: args.seed,
                    callback_data: args.callback_data,
                    num_words: args.num_words,
                    minimum_confirmations: args.minimum_confirmations,
                    callback_gas_limit: args.callback_gas_limit,
                    pool_id: args.pool_id,
                }
            }
            4 => {
                let args = FulfillRandomnessArgs::deserialize(&mut payload)?;
                Self::FulfillRandomness {
                    proof: args.proof,
                    public_key: args.public_key,
                    request_id: args.request_id,
                    pool_id: args.pool_id,
                    request_index: args.request_index,
                }
            }
            5 => {
                let args = CancelRequestArgs::deserialize(&mut payload)?;
                Self::CancelRequest {
                    request_id: args.request_id,
                    pool_id: args.pool_id,
                    request_index: args.request_index,
                }
            }
            6 => {
                let args = CleanExpiredRequestsArgs::deserialize(&mut payload)?;
                Self::CleanExpiredRequests {
                    pool_id: args.pool_id,
                }
            }
            7 => {
                let args = InitializeOracleRegistryArgs::deserialize(&mut payload)?;
                Self::InitializeOracleRegistry {
                    min_stake: args.min_stake,
                    rotation_frequency: args.rotation_frequency,
                }
            }
            8 => {
                let args = RegisterOracleArgs::deserialize(&mut payload)?;
                Self::RegisterOracle {
                    vrf_key: args.vrf_key,
                    stake_amount: args.stake_amount,
                }
            }
            9 => Self::DeactivateOracle,
            10 => {
                let args = ProcessRequestBatchArgs::deserialize(&mut payload)?;
                Self::ProcessRequestBatch {
                    request_ids: args.request_ids,
                    proofs: args.proofs,
                    public_keys: args.public_keys,
                    pool_id: args.pool_id,
                    request_indices: args.request_indices,
                }
            }
            11 => Self::RotateOracles,
            12 => {
                let args = UpdateOracleReputationArgs::deserialize(&mut payload)?;
                Self::UpdateOracleReputation {
                    oracle_authority: args.oracle_authority,
                    successful_fulfillments: args.successful_fulfillments,
                    failed_fulfillments: args.failed_fulfillments,
                }
            }
            _ => {
                return Err(Error::new(
                    ErrorKind::InvalidData,
                    "unknown tagged instruction opcode",
                ))
            }
        };

        if !payload.is_empty() {
            return Err(Error::new(
                ErrorKind::InvalidData,
                "trailing bytes in tagged instruction payload",
            ));
        }

        Ok(instruction)
    }

    /// Unpacks instruction bytes.
    /// Supports both:
    /// - tagged format `[tag, 0, 0, 0, 0, 0, 0, 0, borsh_payload...]`
    /// - legacy Borsh enum encoding
    pub fn unpack(input: &[u8]) -> Result<Self, std::io::Error> {
        if input.len() >= 8 && input[1..8].iter().all(|byte| *byte == 0) {
            return Self::parse_tagged(input);
        }
        Self::try_from_slice(input)
    }
}

#[derive(BorshDeserialize)]
struct CreateEnhancedSubscriptionArgs {
    min_balance: u64,
    confirmations: u8,
    max_requests: u16,
}

#[derive(BorshDeserialize)]
struct FundSubscriptionArgs {
    amount: u64,
}

#[derive(BorshDeserialize)]
struct InitializeRequestPoolArgs {
    pool_id: u8,
    max_size: u32,
}

#[derive(BorshDeserialize)]
struct RequestRandomnessArgs {
    seed: [u8; 32],
    callback_data: Vec<u8>,
    num_words: u32,
    minimum_confirmations: u8,
    callback_gas_limit: u64,
    pool_id: u8,
}

#[derive(BorshDeserialize)]
struct FulfillRandomnessArgs {
    proof: Vec<u8>,
    public_key: Vec<u8>,
    request_id: [u8; 32],
    pool_id: u8,
    request_index: u32,
}

#[derive(BorshDeserialize)]
struct CancelRequestArgs {
    request_id: [u8; 32],
    pool_id: u8,
    request_index: u32,
}

#[derive(BorshDeserialize)]
struct CleanExpiredRequestsArgs {
    pool_id: u8,
}

#[derive(BorshDeserialize)]
struct InitializeOracleRegistryArgs {
    min_stake: u64,
    rotation_frequency: u64,
}

#[derive(BorshDeserialize)]
struct RegisterOracleArgs {
    vrf_key: [u8; 32],
    stake_amount: u64,
}

#[derive(BorshDeserialize)]
struct ProcessRequestBatchArgs {
    request_ids: Vec<[u8; 32]>,
    proofs: Vec<Vec<u8>>,
    public_keys: Vec<Vec<u8>>,
    pool_id: u8,
    request_indices: Vec<u32>,
}

#[derive(BorshDeserialize)]
struct UpdateOracleReputationArgs {
    oracle_authority: Pubkey,
    successful_fulfillments: u16,
    failed_fulfillments: u16,
}
