use anchor_lang::prelude::*;

#[error_code]
pub enum LayerZeroError {
    #[msg("Unauthorized access")]
    Unauthorized,

    #[msg("Invalid destination chain ID")]
    InvalidDestinationChain,

    #[msg("Invalid source chain ID")]
    InvalidSourceChain,

    #[msg("Invalid remote address")]
    InvalidRemoteAddress,

    #[msg("Remote application not trusted")]
    RemoteNotTrusted,

    #[msg("Invalid message type")]
    InvalidMessageType,

    #[msg("Invalid adapter parameters")]
    InvalidAdapterParams,

    #[msg("Insufficient fee for message")]
    InsufficientFee,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Message already processed")]
    MessageAlreadyProcessed,

    #[msg("Invalid nonce")]
    InvalidNonce,

    #[msg("Request not found")]
    RequestNotFound,

    #[msg("Request already fulfilled")]
    RequestAlreadyFulfilled,

    #[msg("Invalid VRF parameters")]
    InvalidVrfParams,
} 