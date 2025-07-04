/// LayerZero OApp standard seeds
pub const STORE_SEED: &[u8] = b"Store";
pub const PEER_SEED: &[u8] = b"Peer";
pub const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes";
pub const LZ_COMPOSE_TYPES_SEED: &[u8] = b"LzComposeTypes";

/// LayerZero Endpoint Program ID for Solana Devnet
pub const LAYERZERO_ENDPOINT_PROGRAM_ID: &str = "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6";

/// LayerZero Endpoint ID for operations (Solana Devnet)
pub const ENDPOINT_ID: u32 = SOLANA_DEVNET_EID;

/// LayerZero Endpoint IDs for Mainnet
pub const ETHEREUM_EID: u32 = 30101;
pub const BINANCE_EID: u32 = 30102;
pub const AVALANCHE_EID: u32 = 30106;
pub const POLYGON_EID: u32 = 30109;
pub const ARBITRUM_EID: u32 = 30110;
pub const OPTIMISM_EID: u32 = 30111;
pub const FANTOM_EID: u32 = 30112;
pub const BASE_EID: u32 = 30184;
pub const SOLANA_EID: u32 = 30168;

/// LayerZero Endpoint IDs for Testnets/Devnets
pub const ETHEREUM_SEPOLIA_EID: u32 = 40161;
pub const OPTIMISM_SEPOLIA_EID: u32 = 40232;
pub const ARBITRUM_SEPOLIA_EID: u32 = 40231;
pub const BASE_SEPOLIA_EID: u32 = 40245;
pub const POLYGON_AMOY_EID: u32 = 40267;
pub const AVALANCHE_FUJI_EID: u32 = 40106;
pub const BINANCE_TESTNET_EID: u32 = 40102;
pub const SOLANA_DEVNET_EID: u32 = 40168;

/// Message size limits
pub const MAX_MESSAGE_SIZE: usize = 65535;
pub const MAX_COMPOSE_MESSAGE_SIZE: usize = 65535;

/// VRF specific constants
pub const MAX_VRF_REQUESTS: usize = 100;
pub const MAX_CALLBACK_DATA_SIZE: usize = 32; // Fixed to 32 bytes for EVM compatibility (request ID)
pub const VRF_SEED_SIZE: usize = 32;
pub const VRF_RANDOMNESS_SIZE: usize = 64; // Fixed to 64 bytes for EVM compatibility
pub const VRF_REQUEST_ID_SIZE: usize = 32;

/// Message size constants for EVM compatibility
pub const VRF_REQUEST_MESSAGE_SIZE: usize = 102; // 1 + 32 + 32 + 32 + 4 + 1 bytes
pub const VRF_FULFILLMENT_MESSAGE_SIZE: usize = 97; // 1 + 32 + 64 bytes

/// EVM compatibility constants
pub const EVM_ADDRESS_SIZE: usize = 20;
pub const EVM_ADDRESS_PADDED_SIZE: usize = 32; // EVM addresses padded to 32 bytes for Solana
pub const EVM_UINT32_SIZE: usize = 4;
pub const EVM_UINT8_SIZE: usize = 1;

/// Account space calculations
pub const STORE_ACCOUNT_SIZE: usize = 8 + 32 + 1 + 32 + 256 + 32; // Discriminator + admin + bump + endpoint + vrf_data + custom_data
pub const PEER_ACCOUNT_SIZE: usize = 8 + 4 + 32 + 1; // Discriminator + src_eid + peer_address + bump
pub const LZ_RECEIVE_TYPES_ACCOUNT_SIZE: usize = 8 + 32 + 1; // Discriminator + store + bump
pub const LZ_COMPOSE_TYPES_ACCOUNT_SIZE: usize = 8 + 32 + 1; // Discriminator + store + bump

// Additional constants needed by instruction files
pub const OAPP_SEED: &[u8] = b"OApp";
pub const ENDPOINT_AUTHORITY_SEED: &[u8] = b"EndpointAuthority";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"EventAuthority";
pub const NONCE_ACCOUNT_SEED: &[u8] = b"NonceAccount";
pub const SOLANA_CHAIN_ID: u16 = 40168; // Solana Devnet for testing
