use anchor_lang::prelude::*;

#[error_code]
pub enum LayerZeroError {
    #[msg("Unauthorized access - only admin can perform this action")]
    Unauthorized,

    #[msg("Invalid endpoint ID")]
    InvalidEndpointId,

    #[msg("Invalid peer address")]
    InvalidPeerAddress,

    #[msg("Peer not found for the given endpoint ID")]
    PeerNotFound,

    #[msg("Message payload too large")]
    MessageTooLarge,

    #[msg("Invalid message format")]
    InvalidMessageFormat,

    #[msg("Invalid VRF parameters")]
    InvalidVrfParams,

    #[msg("VRF request not found")]
    VrfRequestNotFound,

    #[msg("VRF request already fulfilled")]
    VrfRequestAlreadyFulfilled,

    #[msg("Invalid callback data size")]
    InvalidCallbackDataSize,

    #[msg("Maximum number of VRF requests exceeded")]
    MaxVrfRequestsExceeded,

    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[msg("Invalid sender - not from trusted peer")]
    InvalidSender,

    #[msg("Invalid nonce - message ordering issue")]
    InvalidNonce,

    #[msg("Invalid GUID - message identifier issue")]
    InvalidGuid,

    #[msg("Failed to decode message payload")]
    MessageDecodingFailed,

    #[msg("LayerZero endpoint CPI failed")]
    EndpointCpiFailed,

    #[msg("Insufficient fee for LayerZero message")]
    InsufficientFee,

    #[msg("Invalid message type")]
    InvalidMessageType,

    #[msg("Account constraint violation")]
    AccountConstraintViolation,

    #[msg("Invalid account size")]
    InvalidAccountSize,

    #[msg("Store not initialized")]
    StoreNotInitialized,

    #[msg("Invalid compose message")]
    InvalidComposeMessage,

    #[msg("Failed to encode message")]
    MessageEncodingError,

    #[msg("Failed to decode message")]
    MessageDecodingError,

    #[msg("Request not found")]
    RequestNotFound,

    #[msg("Unauthorized oracle")]
    UnauthorizedOracle,

    #[msg("Unauthorized access")]
    UnauthorizedAccess,

    // Additional error variants needed by instruction files
    #[msg("Invalid remote address")]
    InvalidRemoteAddress,

    #[msg("Invalid destination chain")]
    InvalidDestinationChain,

    #[msg("Remote not trusted")]
    RemoteNotTrusted,

    #[msg("Invalid adapter parameters")]
    InvalidAdapterParams,

    #[msg("Invalid source chain")]
    InvalidSourceChain,

    #[msg("Request already fulfilled")]
    RequestAlreadyFulfilled,

    #[msg("Invalid requester address")]
    InvalidRequester,

    #[msg("Too many pending VRF requests")]
    TooManyPendingRequests,
} 