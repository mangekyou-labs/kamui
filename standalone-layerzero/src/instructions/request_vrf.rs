use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::{STORE_SEED, PEER_SEED, MAX_CALLBACK_DATA_SIZE};
use crate::errors::LayerZeroError;
use crate::msg_codec::MessageCodec;
use oapp::{endpoint_cpi::{self}, endpoint::{ID as ENDPOINT_ID, instructions::SendParams}};

#[derive(Accounts)]
#[instruction(params: RequestVrfParams)]
pub struct RequestVrf<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    
    #[account(
        mut,
        seeds = [STORE_SEED],
        bump = store.bump
    )]
    pub store: Account<'info, Store>,
    
    #[account(
        seeds = [PEER_SEED, store.key().as_ref(), &params.dst_eid.to_be_bytes()],
        bump = peer.bump
    )]
    pub peer: Account<'info, PeerConfig>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RequestVrf>, params: RequestVrfParams) -> Result<()> {
    // Validate parameters
    // TODO: Add endpoint validation if needed
    // utils::validate_endpoint_id(params.dst_eid)?;
    
    if params.num_words == 0 || params.num_words > 10 {
        return Err(LayerZeroError::InvalidVrfParams.into());
    }
    
    // Create VRF request payload - EVM compatible format
    let vrf_request = VrfRequestPayload {
        msg_type: MessageType::VrfRequest,
        requester: ctx.accounts.requester.key().to_bytes(),
        seed: params.seed,
        callback_data: params.callback_data, // Already 32 bytes for EVM compatibility
        num_words: params.num_words,         // Now u32 for EVM compatibility
        pool_id: params.pool_id,             // New field for EVM compatibility
    };
    
    // Encode the message
    let message = MessageCodec::encode_vrf_request(&vrf_request)?;
    
    // Prepare send parameters
    let send_params = SendParams {
        dst_eid: params.dst_eid,
        receiver: ctx.accounts.peer.peer_address,
        message,
        options: vec![], // Default options
        native_fee: params.fee,
        lz_token_fee: 0,
    };
    
    // Send the VRF request via LayerZero
    let seeds = &[STORE_SEED, &[ctx.accounts.store.bump]];
    
    endpoint_cpi::send(
        ENDPOINT_ID,
        ctx.accounts.store.key(),
        ctx.remaining_accounts,
        seeds,
        send_params,
    )?;
    
    msg!("VRF request sent to endpoint: {}", params.dst_eid);
    msg!("Seed: {:?}", params.seed);
    msg!("Num words: {}", params.num_words);
    msg!("Pool ID: {}", params.pool_id);
    msg!("Callback data: {:?}", params.callback_data);
    msg!("Fee: {}", params.fee);
    
    Ok(())
} 