use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Accounts)]
pub struct SendVrfFulfillment<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    
    #[account(
        mut,
        seeds = [OAPP_SEED, sender.key().as_ref()],
        bump,
        constraint = oapp.owner == sender.key() @ LayerZeroError::Unauthorized
    )]
    pub oapp: Account<'info, OApp>,
    
    #[account(
        mut,
        seeds = [ENDPOINT_AUTHORITY_SEED],
        bump
    )]
    pub endpoint: Account<'info, Endpoint>,
    
    #[account(
        mut,
        seeds = [EVENT_AUTHORITY_SEED],
        bump
    )]
    pub event_tracker: Account<'info, EventTracker>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: &Context<SendVrfFulfillment>,
    dst_chain_id: u16,
    request_id: [u8; 32],
    randomness: [u8; 64],
    fee: u64,
) -> Result<()> {
    if dst_chain_id == SOLANA_CHAIN_ID {
        return Err(LayerZeroError::InvalidDestinationChain.into());
    }
    
    // Check if the destination chain is in the trusted remotes
    let oapp = &ctx.accounts.oapp;
    let destination_opt = oapp.trusted_remotes.iter().find(|remote| remote.chain_id == dst_chain_id);
    
    if destination_opt.is_none() {
        return Err(LayerZeroError::RemoteNotTrusted.into());
    }
    
    // Clone the destination to avoid borrow issues
    let destination = destination_opt.unwrap().clone();
    
    // Find the request in pending requests
    let request_idx = oapp.pending_requests.iter().position(|req| {
        req.request_id == request_id && req.src_chain_id == dst_chain_id
    });
    
    if request_idx.is_none() {
        return Err(LayerZeroError::RequestNotFound.into());
    }
    
    let request_idx = request_idx.unwrap();
    
    {
        let oapp_ref = &ctx.accounts.oapp;
        if oapp_ref.pending_requests[request_idx].fulfilled {
            return Err(LayerZeroError::RequestAlreadyFulfilled.into());
        }
    }
    
    // Create VRF fulfillment payload
    let fulfillment = VrfFulfillmentPayload {
        request_id,
        randomness,
    };
    
    // Serialize the payload with message type
    let mut payload = vec![1]; // 1 = VrfFulfillment message type
    fulfillment.serialize(&mut payload)?;
    
    // Check if sufficient fee is provided
    if fee < oapp.config.default_fee {
        return Err(LayerZeroError::InsufficientFee.into());
    }
    
    // Transfer fee to the endpoint
    let sender_info = ctx.accounts.sender.to_account_info();
    let endpoint_info = ctx.accounts.endpoint.to_account_info();
    
    if fee > 0 {
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &sender_info.key(),
            &endpoint_info.key(),
            fee,
        );
        
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                sender_info.clone(),
                endpoint_info.clone(),
            ],
        )?;
        
        // Update endpoint fee collection
        let endpoint = &mut ctx.accounts.endpoint;
        endpoint.collected_fees = endpoint.collected_fees
            .checked_add(fee)
            .ok_or(LayerZeroError::ArithmeticOverflow)?;
    }
    
    // We need to mutate the oapp after getting data from it
    let mut oapp_data = ctx.accounts.oapp.to_account_info().data.borrow_mut();
    let oapp_mut = &mut ctx.accounts.oapp;

    // Increment the nonce for the outbound message
    let new_nonce = oapp_mut.outbound_nonce
        .checked_add(1)
        .ok_or(LayerZeroError::ArithmeticOverflow)?;
    oapp_mut.outbound_nonce = new_nonce;
    
    // Increment the event tracker for the outbound event
    let event_tracker = &mut ctx.accounts.event_tracker;
    let event_id = event_tracker.next_event_id;
    event_tracker.next_event_id = event_tracker.next_event_id
        .checked_add(1)
        .ok_or(LayerZeroError::ArithmeticOverflow)?;
    
    // Get app_id for message hash
    let app_id_bytes = oapp_mut.app_id.to_bytes();
    
    // Generate a message hash for the event
    let message_hash = keccak::hash(
        &[
            &app_id_bytes[..],
            &dst_chain_id.to_le_bytes()[..],
            &new_nonce.to_le_bytes()[..],
            payload.as_slice(),
        ].concat()
    );
    
    // Mark the request as fulfilled
    oapp_mut.pending_requests[request_idx].fulfilled = true;
    
    // Emit an event with the message details
    msg!("LayerZero VRF fulfillment sent:");
    msg!("  Event ID: {}", event_id);
    msg!("  Source App: {}", oapp_mut.app_id);
    msg!("  Destination Chain: {}", dst_chain_id);
    msg!("  Destination Address: {:?}", destination.address);
    msg!("  Nonce: {}", new_nonce);
    msg!("  Request ID: {:?}", request_id);
    msg!("  Message Hash: {:?}", message_hash.to_bytes());
    
    Ok(())
} 