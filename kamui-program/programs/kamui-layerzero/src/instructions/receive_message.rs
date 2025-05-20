use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
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
pub struct ReceiveMessage<'info> {
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
    ctx: &mut Context<ReceiveMessage>,
    src_chain_id: u16,
    src_address: [u8; 32],
    nonce: u64,
    payload: Vec<u8>,
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
    
    // Parse message type from payload
    if payload.is_empty() {
        return Err(error!(LayerZeroError::InvalidMessageType));
    }
    
    // First byte is message type
    let message_type = match payload[0] {
        0 => MessageType::VrfRequest,
        1 => MessageType::VrfFulfillment,
        _ => return Err(error!(LayerZeroError::InvalidMessageType)),
    };
    
    // Process based on message type
    match message_type {
        MessageType::VrfRequest => {
            // Attempt to deserialize the VRF request payload
            if let Ok(vrf_payload) = VrfRequestPayload::try_from_slice(&payload[1..]) {
                msg!("Received VRF request from chain {} with seed {:?}", src_chain_id, vrf_payload.seed);
                
                // Generate request ID
                let request_id = keccak::hash(
                    &[
                        &src_chain_id.to_le_bytes()[..],
                        &src_address[..],
                        &nonce.to_le_bytes()[..],
                        &vrf_payload.seed[..],
                    ].concat()
                ).to_bytes();
                
                // Add to pending requests
                let oapp = &mut ctx.accounts.oapp;
                oapp.pending_requests.push(PendingVrfRequest {
                    request_id,
                    src_chain_id,
                    src_address,
                    timestamp: Clock::get()?.unix_timestamp,
                    seed: vrf_payload.seed,
                    fulfilled: false,
                });
                
                msg!("VRF request added with ID: {:?}", request_id);
            } else {
                return Err(error!(LayerZeroError::InvalidMessageType));
            }
        },
        MessageType::VrfFulfillment => {
            msg!("Received VRF fulfillment from chain {}", src_chain_id);
            // This should not happen as fulfillment messages should be handled by
            // the receive_vrf_fulfillment instruction
            return Err(error!(LayerZeroError::InvalidMessageType));
        }
    }
    
    Ok(())
} 