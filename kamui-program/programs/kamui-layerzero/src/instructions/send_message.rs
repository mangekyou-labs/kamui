use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct SendMessage<'info> {
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
    ctx: &Context<SendMessage>,
    dst_chain_id: u16,
    adapter_params: Vec<u8>,
    payload: Vec<u8>,
    fee: u64,
) -> Result<()> {
    if dst_chain_id == SOLANA_CHAIN_ID {
        return Err(LayerZeroError::InvalidDestinationChain.into());
    }
    
    // Check if the destination chain is in the trusted remotes
    let oapp = &mut ctx.accounts.oapp;
    let destination_found = oapp.trusted_remotes.iter().any(|remote| remote.chain_id == dst_chain_id);
    
    if !destination_found {
        return Err(LayerZeroError::RemoteNotTrusted.into());
    }
    
    // Check if the payload is within size limits
    if payload.len() > MAX_PAYLOAD_SIZE {
        return Err(error!(LayerZeroError::InvalidAdapterParams));
    }
    
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
    
    // Increment the nonce for the outbound message
    oapp.outbound_nonce = oapp.outbound_nonce
        .checked_add(1)
        .ok_or(LayerZeroError::ArithmeticOverflow)?;
    
    // Increment the event tracker for the outbound event
    let event_tracker = &mut ctx.accounts.event_tracker;
    let event_id = event_tracker.next_event_id;
    event_tracker.next_event_id = event_tracker.next_event_id
        .checked_add(1)
        .ok_or(LayerZeroError::ArithmeticOverflow)?;
    
    // Generate a message hash for the event
    let message_hash = keccak::hash(
        &[
            &oapp.app_id.to_bytes()[..],
            &dst_chain_id.to_le_bytes()[..],
            &oapp.outbound_nonce.to_le_bytes()[..],
            payload.as_slice(),
        ].concat()
    );
    
    // Emit an event with the message details
    msg!("LayerZero message sent:");
    msg!("  Event ID: {}", event_id);
    msg!("  Source App: {}", oapp.app_id);
    msg!("  Destination Chain: {}", dst_chain_id);
    msg!("  Nonce: {}", oapp.outbound_nonce);
    msg!("  Payload Size: {}", payload.len());
    msg!("  Message Hash: {:?}", message_hash.to_bytes());
    
    Ok(())
} 