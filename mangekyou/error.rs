//! Collection of errors to be used in mangekyou.
//!
//! A function should validate its arguments and return an indicative errors where needed.
//! However, once the function is executing the cryptographic protocol/algorithm (directly/
//! indirectly) then it should not return explicit errors as it might leak private information.
//! In those cases the function should return the opaque, general error [MangekyouError::GeneralOpaqueError].
//! When in doubt, prefer [MangekyouError::GeneralOpaqueError].

use thiserror::Error;

pub type MangekyouResult<T> = Result<T, MangekyouError>;

/// Collection of errors to be used in Mangekyou.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum MangekyouError {
    /// Invalid value was given to the function
    #[error("Invalid value was given to the function")]
    InvalidInput,

    /// Input is to short.
    #[error("Expected input of length at least {0}")]
    InputTooShort(usize),

    /// Input is to long.
    #[error("Expected input of length at most {0}")]
    InputTooLong(usize),

    /// Input length is wrong.
    #[error("Expected input of length exactly {0}")]
    InputLengthWrong(usize),

    /// Invalid signature was given to the function
    #[error("Invalid signature was given to the function")]
    InvalidSignature,

    /// Invalid proof was given to the function
    #[error("Invalid proof was given to the function")]
    InvalidProof,

    /// Not enough inputs were given to the function, retry with more
    #[error("Not enough inputs were given to the function, retry with more")]
    NotEnoughInputs,

    /// Invalid message was given to the function
    #[error("Invalid message was given to the function")]
    InvalidMessage,

    /// Message should be ignored
    #[error("Message should be ignored")]
    IgnoredMessage,

    /// General cryptographic error.
    #[error("General cryptographic error: {0}")]
    GeneralError(String),

    /// General opaque cryptographic error.
    #[error("General cryptographic error")]
    GeneralOpaqueError,
}

// impl From<signature::Error> for MangekyouError {
//     fn from(_: signature::Error) -> Self {
//         MangekyouError::InvalidSignature
//     }
// }
