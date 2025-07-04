use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::LayerZeroError;

// Use LzAccount from lib.rs to avoid duplicate definitions
use crate::LzAccount;

/// LayerZero endpoint CPI interface
pub mod endpoint_cpi {
    use super::*;
    
    /// Parameters for registering an OApp
    #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
    pub struct RegisterOAppParams {
        /// The delegate pubkey for the OApp
        pub delegate: Pubkey,
    }
    
    /// Parameters for clearing a message
    #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
    pub struct ClearParams {
        /// The receiver address
        pub receiver: Pubkey,
        /// Source endpoint ID
        pub src_eid: u32,
        /// Sender address
        pub sender: [u8; 32],
        /// Message nonce
        pub nonce: u64,
        /// Message GUID
        pub guid: [u8; 32],
        /// Message payload
        pub message: Vec<u8>,
    }
    
    /// Parameters for sending a message
    #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
    pub struct SendParams {
        /// Destination endpoint ID
        pub dst_eid: u32,
        /// Receiver address
        pub receiver: [u8; 32],
        /// Message payload
        pub message: Vec<u8>,
        /// Message options
        pub options: Vec<u8>,
        /// Fee amount
        pub fee: u64,
    }
    
    /// Parameters for sending a compose message
    #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
    pub struct SendComposeParams {
        /// Destination address
        pub to: Pubkey,
        /// Message GUID
        pub guid: [u8; 32],
        /// Compose index
        pub index: u16,
        /// Message payload
        pub message: Vec<u8>,
    }
    
    /// Register an OApp with the LayerZero endpoint
    pub fn register_oapp(
        endpoint_id: u32,
        oapp_address: Pubkey,
        remaining_accounts: &[AccountInfo],
        seeds: &[&[u8]],
        params: RegisterOAppParams,
    ) -> Result<()> {
        msg!("Registering OApp with endpoint ID: {}", endpoint_id);
        msg!("OApp address: {}", oapp_address);
        msg!("Delegate: {}", params.delegate);
        
        // Mock LayerZero endpoint CPI (placeholder)
        msg!("Mock: register_oapp called with delegate: {}", params.delegate);
        
        Ok(())
    }
    
    /// Clear a message (replay protection)
    pub fn clear(
        endpoint_id: u32,
        oapp_address: Pubkey,
        remaining_accounts: &[AccountInfo],
        seeds: &[&[u8]],
        params: ClearParams,
    ) -> Result<()> {
        msg!("Clearing message from endpoint ID: {}", params.src_eid);
        msg!("Message nonce: {}", params.nonce);
        msg!("Message GUID: {:?}", params.guid);
        
        // Mock LayerZero endpoint CPI (placeholder)
        msg!("Mock: clear called for nonce: {}", params.nonce);
        
        Ok(())
    }
    
    /// Send a message via LayerZero
    pub fn send(
        endpoint_id: u32,
        oapp_address: Pubkey,
        remaining_accounts: &[AccountInfo],
        seeds: &[&[u8]],
        params: SendParams,
    ) -> Result<()> {
        msg!("Sending message to endpoint ID: {}", params.dst_eid);
        msg!("Message size: {}", params.message.len());
        msg!("Fee: {}", params.fee);
        
        // Mock LayerZero endpoint CPI (placeholder)
        msg!("Mock: send called to EID: {}", params.dst_eid);
        
        Ok(())
    }
    
    /// Send a compose message
    pub fn send_compose(
        endpoint_id: u32,
        oapp_address: Pubkey,
        remaining_accounts: &[AccountInfo],
        seeds: &[&[u8]],
        params: SendComposeParams,
    ) -> Result<()> {
        msg!("Sending compose message to: {}", params.to);
        msg!("GUID: {:?}", params.guid);
        msg!("Index: {}", params.index);
        
        // This is a placeholder for the actual LayerZero endpoint CPI
        // In a real implementation, this would call the LayerZero endpoint program
        Ok(())
    }
}

/// Helper functions for account management
pub mod accounts {
    use super::*;
    
    /// Get accounts required for clearing a message
    pub fn get_accounts_for_clear(
        store: &Pubkey,
        src_eid: u32,
        sender: &[u8; 32],
        nonce: u64,
        guid: &[u8; 32],
        message: &[u8],
    ) -> Result<Vec<LzAccount>> {
        let mut accounts = Vec::new();
        
        // Store account (writable)
        accounts.push(LzAccount {
            pubkey: *store,
            is_signer: false,
            is_writable: true,
        });
        
        // System program
        accounts.push(LzAccount {
            pubkey: anchor_lang::system_program::ID,
            is_signer: false,
            is_writable: false,
        });
        
        // Rent sysvar
        accounts.push(LzAccount {
            pubkey: anchor_lang::solana_program::sysvar::rent::ID,
            is_signer: false,
            is_writable: false,
        });
        
        // Additional accounts for replay protection would be added here
        // This is a simplified version
        
        Ok(accounts)
    }
    
    /// Get accounts required for sending a message
    pub fn get_accounts_for_send(
        store: &Pubkey,
        dst_eid: u32,
        receiver: &[u8; 32],
        message: &[u8],
        options: &[u8],
    ) -> Result<Vec<LzAccount>> {
        let mut accounts = Vec::new();
        
        // Store account (writable)
        accounts.push(LzAccount {
            pubkey: *store,
            is_signer: false,
            is_writable: true,
        });
        
        // System program
        accounts.push(LzAccount {
            pubkey: anchor_lang::system_program::ID,
            is_signer: false,
            is_writable: false,
        });
        
        Ok(accounts)
    }
}

/// Utility functions for LayerZero operations
pub mod utils {
    use super::*;
    
    /// Generate a unique request ID
    pub fn generate_request_id(
        sender: &Pubkey,
        dst_eid: u32,
        seed: &[u8; 32],
        timestamp: i64,
    ) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&sender.to_bytes());
        data.extend_from_slice(&dst_eid.to_le_bytes());
        data.extend_from_slice(seed);
        data.extend_from_slice(&timestamp.to_le_bytes());
        
        let hash = anchor_lang::solana_program::keccak::hash(&data);
        hash.to_bytes()
    }
    
    /// Validate endpoint ID
    pub fn validate_endpoint_id(eid: u32) -> Result<()> {
        match eid {
            ETHEREUM_EID | BINANCE_EID | AVALANCHE_EID | POLYGON_EID | 
            ARBITRUM_EID | OPTIMISM_EID | FANTOM_EID | BASE_EID | SOLANA_EID => Ok(()),
            _ => Err(LayerZeroError::InvalidEndpointId.into()),
        }
    }
    
    /// Validate message size
    pub fn validate_message_size(message: &[u8]) -> Result<()> {
        if message.len() > MAX_MESSAGE_SIZE {
            return Err(LayerZeroError::MessageTooLarge.into());
        }
        Ok(())
    }
    
    /// Validate peer address
    pub fn validate_peer_address(address: &[u8; 32]) -> Result<()> {
        if address.iter().all(|&b| b == 0) {
            return Err(LayerZeroError::InvalidPeerAddress.into());
        }
        Ok(())
    }
} 