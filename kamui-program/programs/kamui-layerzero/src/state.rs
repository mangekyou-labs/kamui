use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Endpoint {
    /// The admin of the endpoint
    pub authority: Pubkey,
    /// The bump seed for the endpoint PDA
    pub authority_bump: u8,
    /// The number of messages sent so far
    pub outbound_nonce: u64,
    /// Funds collected from users for message fees
    pub collected_fees: u64,
}

#[account]
pub struct OApp {
    /// The owner of the OApp
    pub owner: Pubkey,
    /// The OApp identifier
    pub app_id: Pubkey,
    /// The app config for message sending
    pub config: AppConfig,
    /// The next nonce to use for outgoing messages
    pub outbound_nonce: u64,
    /// Trusted remote applications, keyed by chain ID
    pub trusted_remotes: Vec<TrustedRemote>,
    /// List of pending VRF requests keyed by request ID
    pub pending_requests: Vec<PendingVrfRequest>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct AppConfig {
    /// Default gas to use on destination chain
    pub default_gas_limit: u64,
    /// Default fees to collect for messages
    pub default_fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TrustedRemote {
    /// Remote chain ID
    pub chain_id: u16,
    /// Remote contract address (32 bytes to support both EVM and non-EVM chains)
    pub address: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PendingVrfRequest {
    /// Request ID
    pub request_id: [u8; 32],
    /// Source chain that requested the VRF
    pub src_chain_id: u16,
    /// Source contract that requested the VRF
    pub src_address: [u8; 32],
    /// Timestamp when the request was made
    pub timestamp: i64,
    /// The VRF seed used for the request
    pub seed: [u8; 32],
    /// Whether the request has been fulfilled
    pub fulfilled: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum MessageType {
    VrfRequest,
    VrfFulfillment,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VrfRequestPayload {
    /// Requesting contract identifier
    pub requester: [u8; 32],
    /// Seed for VRF
    pub seed: [u8; 32],
    /// Any additional data provided by the requester
    pub callback_data: Vec<u8>,
    /// Number of random words requested
    pub num_words: u32,
    /// Pool ID for the VRF request
    pub pool_id: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VrfFulfillmentPayload {
    /// Original request ID
    pub request_id: [u8; 32],
    /// Random bytes generated
    pub randomness: [u8; 64],
}

/// LayerZero inbound message hash to avoid replay attacks
#[account]
pub struct NonceAccount {
    /// The chain ID of the source chain
    pub src_chain_id: u16,
    /// The address of the source contract
    pub src_address: [u8; 32],
    /// The current inbound nonce
    pub inbound_nonce: u64,
}

/// LayerZero event emitter to keep track of outbound messages
#[account]
pub struct EventTracker {
    /// The next event to emit
    pub next_event_id: u64,
} 