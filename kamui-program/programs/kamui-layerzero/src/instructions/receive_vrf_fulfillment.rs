use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Accounts)]
#[instruction(
    src_chain_id: u16,
    src_address: [u8; 32],
    nonce: u64
)]
pub struct ReceiveVrfFulfillment<'info> {
    #[account(mut)]
    pub receiver: Signer<'info>,
    
    #[account(
        mut,
        seeds = [OAPP_SEED, receiver.key().as_ref()],
        bump,
        constraint = oapp.owner == receiver.key() @ LayerZeroError::Unauthorized
    )]
    pub oapp: Account<'info, OApp>,
    
    #[account(
        init_if_needed,
        payer = receiver,
        space = 8 + std::mem::size_of::<NonceAccount>(),
        seeds = [
            NONCE_ACCOUNT_SEED,
            &oapp.key().to_bytes(),
            &src_chain_id.to_le_bytes(),
            &src_address
        ],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: &mut Context<ReceiveVrfFulfillment>,
    src_chain_id: u16,
    src_address: [u8; 32],
    nonce: u64,
    request_id: [u8; 32],
    randomness: [u8; 64],
) -> Result<()> {
    // Validate the message
    if src_chain_id == SOLANA_CHAIN_ID {
        return Err(LayerZeroError::InvalidSourceChain.into());
    }
    
    // Validate source address from trusted remotes
    let oapp = &ctx.accounts.oapp;
    let source_found = oapp.trusted_remotes.iter().any(|remote| {
        remote.chain_id == src_chain_id && remote.address == src_address
    });
    
    if !source_found {
        return Err(LayerZeroError::RemoteNotTrusted.into());
    }
    
    // Check for replay protection
    let nonce_account = &mut ctx.accounts.nonce_account;
    
    // Initialize nonce account if it's new
    if nonce_account.inbound_nonce == 0 {
        nonce_account.src_chain_id = src_chain_id;
        nonce_account.src_address = src_address;
        nonce_account.inbound_nonce = nonce;
    } else {
        // Validate the nonce is sequential
        if nonce != nonce_account.inbound_nonce + 1 {
            return Err(LayerZeroError::InvalidNonce.into());
        }
        
        // Update the nonce
        nonce_account.inbound_nonce = nonce;
    }
    
    // Process the VRF fulfillment
    msg!("Received VRF fulfillment from chain {} for request ID: {:?}", src_chain_id, request_id);
    
    // Log the received randomness (first 8 bytes as u64 for demonstration)
    if randomness.len() >= 8 {
        let mut rand_value = [0u8; 8];
        rand_value.copy_from_slice(&randomness[0..8]);
        let rand_u64 = u64::from_le_bytes(rand_value);
        
        msg!("Received randomness: {}", rand_u64);
    }
    
    // In a real implementation, this is where you would send the randomness
    // to the EVM contract that requested it, using a LayerZero message
    // or by storing it for later retrieval
    
    // For this example, we just log the randomness and consider it processed
    msg!("VRF fulfillment processed successfully");
    
    Ok(())
} 