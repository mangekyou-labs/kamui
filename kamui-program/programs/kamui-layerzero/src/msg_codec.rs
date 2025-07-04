use anchor_lang::prelude::error_code;
use std::str;
use crate::state::{MessageType, VrfRequestPayload, VrfFulfillmentPayload};

// -----------------------------------------------------------------------------
// This file defines how the example program encodes and decodes its messages.
// Each OApp can implement its own layout as long as the sending and receiving
// chains agree.  Here we simply prefix a UTF-8 string with a 32 byte length
// header. In this example, the EVM-side equivalant is in `contracts/libs/StringMsgCodec.sol`
// -----------------------------------------------------------------------------


// The message is a UTF-8 encoded string prefixed with a 32 byte header.
// The following is the layout of the message:
// Offset →
// 0                     28     32                     32+N
// |---------------------|------|---------------------------->
// |     28 bytes        | 4B   |     N bytes                |
// |    zero padding     | len  | UTF-8 encoded string       |
// |---------------------|------|----------------------------|


// We prefix the encoded string with a 32 byte length header.
pub const LENGTH_OFFSET: usize = 0;
pub const STRING_OFFSET: usize = 32;

#[error_code]
pub enum MsgCodecError {
    /// Buffer too short to even contain the 32‐byte length header
    InvalidLength,
    /// Header says "string is N bytes" but buffer < 32+N
    BodyTooShort,
    /// Payload bytes aren't valid UTF-8
    InvalidUtf8,
}

/// Extract the string length
fn decode_string_len(buf: &[u8]) -> Result<usize, MsgCodecError> {
    // Header not long enough
    if buf.len() < STRING_OFFSET {
        return Err(MsgCodecError::InvalidLength);
    }
    let mut string_len_bytes = [0u8;32];
    string_len_bytes.copy_from_slice(&buf[LENGTH_OFFSET..LENGTH_OFFSET+32]);
    // The length is stored in the last 4 bytes (big endian)
    Ok(u32::from_be_bytes(string_len_bytes[28..32].try_into().unwrap()) as usize)
}

// Encode a UTF-8 string into a message format with a 32 byte header
pub fn encode(string: &str) -> Vec<u8> {
    let string_bytes = string.as_bytes();
    let mut msg = Vec::with_capacity(
        STRING_OFFSET +               // header length
        string_bytes.len()            // string bytes
    );

    // 4 byte length stored at the end of the 32 byte header
    msg.extend(std::iter::repeat(0).take(28)); // padding
    msg.extend_from_slice(&(string_bytes.len() as u32).to_be_bytes());

    // string
    msg.extend_from_slice(string_bytes);

    msg
}

// Decode a message format with a 32 byte header into a UTF-8 string
// Returns an error if the message is malformed or not valid UTF-8
pub fn decode(message: &[u8]) -> Result<String, MsgCodecError> {
    // Read the declared payload length from the header
    let string_len = decode_string_len(message)?;

    let start = STRING_OFFSET;
    // Safely compute end index and check for overflow
    let end = start
        .checked_add(string_len)
        .ok_or(MsgCodecError::InvalidLength)?;

    // Ensure the buffer actually contains the full payload
    if end > message.len() {
        return Err(MsgCodecError::BodyTooShort);
    }

    // Slice out the payload bytes
    let payload = &message[start..end];
    // Attempt to convert the bytes into a Rust string
    match str::from_utf8(payload) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => Err(MsgCodecError::InvalidUtf8),
    }
}

/// Message codec for VRF and other LayerZero messages
pub struct MessageCodec;

impl MessageCodec {
    /// Encode a VRF request payload
    pub fn encode_vrf_request(payload: &VrfRequestPayload) -> Result<Vec<u8>, MsgCodecError> {
        let mut message = Vec::new();
        
        // Message type (1 byte)
        message.push(MessageType::VrfRequest as u8);
        
        // Requester (32 bytes)
        message.extend_from_slice(&payload.requester);
        
        // Seed (32 bytes)
        message.extend_from_slice(&payload.seed);
        
        // Number of words (1 byte)
        message.push(payload.num_words);
        
        // Callback data length (4 bytes)
        message.extend_from_slice(&(payload.callback_data.len() as u32).to_be_bytes());
        
        // Callback data
        message.extend_from_slice(&payload.callback_data);
        
        Ok(message)
    }
    
    /// Encode a VRF fulfillment payload
    pub fn encode_vrf_fulfillment(payload: &VrfFulfillmentPayload) -> Result<Vec<u8>, MsgCodecError> {
        let mut message = Vec::new();
        
        // Message type (1 byte)
        message.push(MessageType::VrfFulfillment as u8);
        
        // Request ID (32 bytes)
        message.extend_from_slice(&payload.request_id);
        
        // Randomness length (4 bytes)
        message.extend_from_slice(&(payload.randomness.len() as u32).to_be_bytes());
        
        // Randomness values (8 bytes each)
        for &value in &payload.randomness {
            message.extend_from_slice(&value.to_be_bytes());
        }
        
        // Proof length (4 bytes)
        message.extend_from_slice(&(payload.proof.len() as u32).to_be_bytes());
        
        // Proof data
        message.extend_from_slice(&payload.proof);
        
        Ok(message)
    }
    
    /// Decode a LayerZero message and determine its type
    pub fn decode_message_type(message: &[u8]) -> Result<MessageType, MsgCodecError> {
        if message.is_empty() {
            return Err(MsgCodecError::InvalidLength);
        }
        
        match message[0] {
            0 => Ok(MessageType::VrfRequest),
            1 => Ok(MessageType::VrfFulfillment),
            _ => Ok(MessageType::Generic),
        }
    }
    
    /// Decode a VRF request message
    pub fn decode_vrf_request(message: &[u8]) -> Result<VrfRequestPayload, MsgCodecError> {
        if message.len() < 70 { // Minimum size: 1 + 32 + 32 + 1 + 4 = 70 bytes
            return Err(MsgCodecError::InvalidLength);
        }
        
        let mut offset = 1; // Skip message type
        
        // Requester (32 bytes)
        let mut requester = [0u8; 32];
        requester.copy_from_slice(&message[offset..offset + 32]);
        offset += 32;
        
        // Seed (32 bytes)
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&message[offset..offset + 32]);
        offset += 32;
        
        // Number of words (1 byte)
        let num_words = message[offset];
        offset += 1;
        
        // Callback data length (4 bytes)
        let callback_len = u32::from_be_bytes([
            message[offset], message[offset + 1], message[offset + 2], message[offset + 3]
        ]) as usize;
        offset += 4;
        
        // Callback data
        if offset + callback_len > message.len() {
            return Err(MsgCodecError::BodyTooShort);
        }
        
        let callback_data = message[offset..offset + callback_len].to_vec();
        
        Ok(VrfRequestPayload {
            msg_type: MessageType::VrfRequest,
            requester,
            seed,
            num_words,
            callback_data,
        })
    }
} 