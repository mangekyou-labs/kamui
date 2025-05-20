use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum VrfCoordinatorError {
    #[error("Invalid instruction")]
    InvalidInstruction,

    #[error("Not rent exempt")]
    NotRentExempt,

    #[error("Insufficient balance")]
    InsufficientBalance,

    #[error("Invalid subscription owner")]
    InvalidSubscriptionOwner,

    #[error("Invalid request status")]
    InvalidRequestStatus,

    #[error("Invalid oracle signer")]
    InvalidOracleSigner,

    #[error("Invalid VRF proof")]
    InvalidVrfProof,

    #[error("Request already fulfilled")]
    RequestAlreadyFulfilled,

    #[error("Insufficient confirmations")]
    InsufficientConfirmations,

    #[error("Invalid request confirmations")]
    InvalidRequestConfirmations,

    #[error("Invalid callback gas limit")]
    InvalidCallbackGasLimit,

    #[error("Invalid number of words")]
    InvalidNumberOfWords,

    #[error("Invalid oracle")]
    InvalidOracle,

    #[error("Invalid commitment")]
    InvalidCommitment,

    #[error("Callback failed")]
    CallbackFailed,

    #[error("Request expired")]
    RequestExpired,

    #[error("Invalid request parameters")]
    InvalidRequestParameters,
    
    #[error("Pool is full")]
    PoolIsFull,
    
    #[error("Invalid pool ID")]
    InvalidPoolId,
    
    #[error("Request not found")]
    RequestNotFound,
    
    #[error("Subscription request limit exceeded")]
    SubscriptionRequestLimitExceeded,
    
    #[error("Invalid request ID")]
    InvalidRequestId,
    
    #[error("Invalid batch parameters")]
    InvalidBatchParameters,
    
    #[error("Invalid oracle authority")]
    InvalidOracleAuthority,
    
    #[error("Insufficient stake")]
    InsufficientStake,
    
    #[error("Oracle not registered")]
    OracleNotRegistered,
    
    #[error("Registry not initialized")]
    RegistryNotInitialized,
    
    #[error("Invalid admin")]
    InvalidAdmin,
    
    #[error("No requests to process")]
    NoRequestsToProcess,
    
    #[error("Oracle reputation too low")]
    OracleReputationTooLow,
    
    #[error("Rotation not due")]
    RotationNotDue,
    
    #[error("Oracle already registered")]
    OracleAlreadyRegistered,
    
    #[error("Request pool not initialized")]
    RequestPoolNotInitialized,
    
    #[error("Request ID mismatch")]
    RequestIdMismatch,
}

impl From<VrfCoordinatorError> for ProgramError {
    fn from(e: VrfCoordinatorError) -> Self {
        ProgramError::Custom(e as u32)
    }
} 