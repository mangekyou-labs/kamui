use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::{STORE_SEED, PEER_SEED};
use crate::errors::LayerZeroError;
use oapp::{endpoint_cpi::{self}, endpoint::{ID as ENDPOINT_ID, instructions::SendParams}};

#[derive(Accounts)]
#[instruction(params: LzSendParams)]
pub struct LzSend<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    
    #[account(
        mut,
        seeds = [STORE_SEED],
        bump = store.bump,
        constraint = store.admin == sender.key() @ LayerZeroError::Unauthorized
    )]
    pub store: Account<'info, Store>,
    
    #[account(
        seeds = [PEER_SEED, store.key().as_ref(), &params.dst_eid.to_be_bytes()],
        bump = peer.bump
    )]
    pub peer: Account<'info, PeerConfig>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LzSend>, params: LzSendParams) -> Result<()> {
    // TODO: Add endpoint validation if needed
    // utils::validate_endpoint_id(params.dst_eid)?;
    
    // TODO: Add message size validation if needed
    // utils::validate_message_size(&params.message)?;
    
    // Get message size before moving
    let message_size = params.message.len();
    
    // Prepare LayerZero send parameters
    let send_params = SendParams {
        dst_eid: params.dst_eid,
        receiver: ctx.accounts.peer.peer_address,
        message: params.message,
        options: params.options,
        native_fee: params.fee,
        lz_token_fee: 0,
    };
    
    // Prepare seeds for CPI
    let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];
    
    // Send message via LayerZero endpoint
    endpoint_cpi::send(
        ENDPOINT_ID,
        ctx.accounts.store.key(),
        ctx.remaining_accounts,
        seeds,
        send_params,
    )?;
    
    msg!("LayerZero message sent successfully");
    msg!("Destination endpoint: {}", params.dst_eid);
    msg!("Message size: {}", message_size);
    msg!("Fee: {}", params.fee);
    
    Ok(())
} 