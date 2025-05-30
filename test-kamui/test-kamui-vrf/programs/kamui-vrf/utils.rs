use anchor_lang::solana_program::keccak::hash;

/// Generate a pseudo-random value from input bytes
pub fn generate_pseudo_random(input: &[u8], counter: u32) -> [u8; 32] {
    let mut data = Vec::with_capacity(input.len() + 4);
    data.extend_from_slice(input);
    data.extend_from_slice(&counter.to_le_bytes());
    hash(&data).to_bytes()
}

/// Convert bytes to a u64 value
pub fn bytes_to_u64(bytes: &[u8]) -> u64 {
    let mut array = [0u8; 8];
    let len = std::cmp::min(bytes.len(), 8);
    array[..len].copy_from_slice(&bytes[..len]);
    u64::from_le_bytes(array)
}

/// Get a bounded random value between min and max (inclusive)
pub fn bounded_random(random_bytes: &[u8], min: u64, max: u64) -> u64 {
    if min >= max {
        return min;
    }
    
    let range = max - min + 1;
    let random_value = bytes_to_u64(random_bytes);
    min + (random_value % range)
}

/// Derive a 64 byte randomness output from a 32 byte input 
pub fn expand_randomness(input: &[u8; 32]) -> [u8; 64] {
    let mut result = [0u8; 64];
    result[0..32].copy_from_slice(input);
    
    let hash2 = hash(input).to_bytes();
    result[32..64].copy_from_slice(&hash2);
    
    result
}

/// Calculate the delay for a request based on confirmations
pub fn calculate_confirmation_delay(confirmations: u8) -> u64 {
    u64::from(confirmations).saturating_mul(2) // 2 slots per confirmation as an example
} 