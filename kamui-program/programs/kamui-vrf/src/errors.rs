use anchor_lang::prelude::*;

#[error_code]
pub enum KamuiVrfError {
    #[msg("The provided confirmations are invalid")]
    InvalidConfirmations,
    
    #[msg("The provided maximum requests value is invalid")]
    InvalidMaxRequests,
    
    #[msg("The provided amount is invalid")]
    InvalidAmount,
    
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid pool size specified")]
    InvalidPoolSize,
    
    #[msg("Invalid pool subscription")]
    InvalidPoolSubscription,
    
    #[msg("Invalid pool ID")]
    InvalidPoolId,
    
    #[msg("Too many active requests")]
    TooManyRequests,
    
    #[msg("Insufficient subscription funds")]
    InsufficientFunds,
    
    #[msg("Request pool capacity exceeded")]
    PoolCapacityExceeded,
    
    #[msg("Invalid word count requested")]
    InvalidWordCount,
    
    #[msg("Invalid gas limit")]
    InvalidGasLimit,
    
    #[msg("Invalid request ID")]
    InvalidRequestId,
    
    #[msg("Invalid request index")]
    InvalidRequestIndex,
    
    #[msg("Request is not in pending state")]
    RequestNotPending,
    
    #[msg("VRF proof verification failed")]
    ProofVerificationFailed,
    
    #[msg("Invalid VRF key")]
    InvalidVrfKey,
    
    #[msg("Invalid subscription owner")]
    InvalidSubscriptionOwner,
    
    #[msg("Request is already fulfilled")]
    RequestAlreadyFulfilled,
    
    #[msg("Request has expired")]
    RequestExpired,
    
    #[msg("Invalid stake amount")]
    InvalidStakeAmount,
    
    #[msg("Insufficient stake")]
    InsufficientStake,
    
    #[msg("Invalid rotation frequency")]
    InvalidRotationFrequency,
    
    #[msg("Oracle not active")]
    OracleNotActive,
    
    #[msg("Batch request limit exceeded")]
    BatchLimitExceeded,
    
    // Light Protocol compression errors
    #[msg("Light compression feature not enabled")]
    FeatureNotEnabled,
    
    #[msg("Invalid compressed account")]
    InvalidCompressedAccount,
    
    #[msg("Compressed account not found")]
    CompressedAccountNotFound,
    
    #[msg("Invalid proof")]
    InvalidProof,
    
    #[msg("Merkle tree operation failed")]
    MerkleTreeFailed,
    
    #[msg("Compression initialization failed")]
    CompressionInitFailed,
} 