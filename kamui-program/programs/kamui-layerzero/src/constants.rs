/// Seed for the endpoint authority PDA
pub const ENDPOINT_AUTHORITY_SEED: &[u8] = b"endpoint_authority";

/// Seed for the OApp PDA
pub const OAPP_SEED: &[u8] = b"oapp";

/// Seed for the nonce account PDA
pub const NONCE_ACCOUNT_SEED: &[u8] = b"nonce";

/// Seed for the event authority PDA
pub const EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";

/// Maximum size of the payload in bytes
pub const MAX_PAYLOAD_SIZE: usize = 10_000;

/// Chain ID for Solana
pub const SOLANA_CHAIN_ID: u16 = 0;

/// Common EVM Chain IDs used by LayerZero
pub const ETHEREUM_CHAIN_ID: u16 = 1;
pub const OPTIMISM_CHAIN_ID: u16 = 2;
pub const BNB_CHAIN_ID: u16 = 3;
pub const AVALANCHE_CHAIN_ID: u16 = 4;
pub const POLYGON_CHAIN_ID: u16 = 5;
pub const ARBITRUM_CHAIN_ID: u16 = 6;
pub const FANTOM_CHAIN_ID: u16 = 7;
pub const BASE_CHAIN_ID: u16 = 8;

/// Maximum number of trusted remotes an OApp can have
pub const MAX_TRUSTED_REMOTES: usize = 20;

/// Maximum number of pending VRF requests
pub const MAX_PENDING_REQUESTS: usize = 100; 