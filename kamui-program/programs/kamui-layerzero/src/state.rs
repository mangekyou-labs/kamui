use anchor_lang::prelude::*;

/// The main OApp Store PDA that acts as the OApp address
#[account]
pub struct Store {
    pub admin: Pubkey, // This is required and should be consistent.
    pub bump: u8, // This is required and should be consistent.
    pub endpoint_program: Pubkey, // This is required and should be consistent.
    pub string: String, // This is specific to this string-passing example.
    pub vrf_data: VrfData, // VRF-specific data for the OApp
    // You can add more fields as needed for your OApp implementation.
}

impl Store {
    pub const MAX_STRING_LENGTH: usize = 256;
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>() + Self::MAX_STRING_LENGTH;
}

// The LzReceiveTypesAccounts PDA is used by the Executor as a prerequisite to calling `lz_receive`.
#[account]
pub struct LzReceiveTypesAccounts {
    pub store: Pubkey, // This is required and should be consistent.
}

impl LzReceiveTypesAccounts {
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>();
}

pub const ENFORCED_OPTIONS_SEND_MAX_LEN: usize = 512;
pub const ENFORCED_OPTIONS_SEND_AND_CALL_MAX_LEN: usize = 1024;

#[account]
pub struct PeerConfig {
    pub peer_address: [u8; 32],
    pub enforced_options: EnforcedOptions,
    pub bump: u8,
}

impl PeerConfig {
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>();
}

#[derive(Clone, Default, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct EnforcedOptions {
    #[max_len(ENFORCED_OPTIONS_SEND_MAX_LEN)]
    pub send: Vec<u8>,
    #[max_len(ENFORCED_OPTIONS_SEND_AND_CALL_MAX_LEN)]
    pub send_and_call: Vec<u8>,
}

impl EnforcedOptions {
    pub fn get_enforced_options(&self, composed_msg: &Option<Vec<u8>>) -> Vec<u8> {
        if composed_msg.is_none() {
            self.send.clone()
        } else {
            self.send_and_call.clone()
        }
    }

    pub fn combine_options(
        &self,
        compose_msg: &Option<Vec<u8>>,
        extra_options: &Vec<u8>,
    ) -> Result<Vec<u8>> {
        let enforced_options = self.get_enforced_options(compose_msg);
        oapp::options::combine_options(enforced_options, extra_options)
    }
}

/// Parameters for initializing the Store
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitStoreParams {
    /// The admin/owner of the OApp
    pub admin: Pubkey,
    /// The LayerZero endpoint program ID
    pub endpoint: Pubkey,
}

/// Parameters for setting a peer
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetPeerConfigParams {
    pub remote_eid: u32,
    pub config: PeerConfigParam,
}

/// Configuration parameter for a peer
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum PeerConfigParam {
    PeerAddress([u8; 32]),
    /// Optionally enforce specific send options for this peer
    EnforcedOptions { send: Vec<u8>, send_and_call: Vec<u8> },
}

/// Parameters for sending a message
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SendMessageParams {
    pub dst_eid: u32,
    pub message: String,
    pub options: Vec<u8>,
    pub native_fee: u64,
    pub lz_token_fee: u64,
}

/// Parameters for quoting send fee
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct QuoteSendParams {
    pub dst_eid: u32,
    pub receiver: [u8; 32],
    pub message: String,
    pub options: Vec<u8>,
    pub pay_in_lz_token: bool,
}

// MessagingFee is now imported from oapp::endpoint::MessagingFee

/// Message types for LayerZero messages
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum MessageType {
    VrfRequest,
    VrfFulfillment,
    Generic,
}

/// Parameters for VRF requests
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RequestVrfParams {
    pub dst_eid: u32,
    pub seed: [u8; 32],
    pub num_words: u8,
    pub callback_data: Vec<u8>,
    pub fee: u64,
}

/// VRF request payload structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VrfRequestPayload {
    pub msg_type: MessageType,
    pub requester: [u8; 32],
    pub seed: [u8; 32],
    pub num_words: u8,
    pub callback_data: Vec<u8>,
}

/// VRF fulfillment parameters
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FulfillVrfParams {
    pub dst_eid: u32,
    pub request_id: [u8; 32],
    pub randomness: Vec<u64>,
    pub proof: Vec<u8>,
    pub fee: u64,
}

/// VRF fulfillment payload structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VrfFulfillmentPayload {
    pub msg_type: MessageType,
    pub request_id: [u8; 32],
    pub randomness: Vec<u64>,
    pub proof: Vec<u8>,
}

/// Parameters for lz_send instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LzSendParams {
    pub dst_eid: u32,
    pub message: Vec<u8>,
    pub options: Vec<u8>,
    pub fee: u64,
}

/// VRF-specific data for the OApp
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct VrfData {
    pub oracle_pubkey: Option<Pubkey>,
    pub pending_requests: Vec<VrfRequest>,
}

/// VRF request structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VrfRequest {
    pub request_id: [u8; 32],
    pub requester: Pubkey,
    pub seed: [u8; 32],
    pub num_words: u8,
    pub callback_data: Vec<u8>,
    pub timestamp: i64,
    pub fulfilled: bool,
} 