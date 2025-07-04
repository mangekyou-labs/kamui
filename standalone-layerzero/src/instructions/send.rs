use anchor_lang::prelude::*;
use crate::state::*;
use crate::msg_codec;
use crate::{PEER_SEED, STORE_SEED};
use oapp::endpoint::{
    instructions::SendParams, state::EndpointSettings, ENDPOINT_SEED, ID as ENDPOINT_ID,
};

#[derive(Accounts)]
#[instruction(params: SendMessageParams)]
pub struct SendMessage<'info> {
    #[account(
        seeds = [
            PEER_SEED,
            &store.key().to_bytes(),
            &params.dst_eid.to_be_bytes()
        ],
        bump = peer.bump
    )]
    /// Configuration for the destination chain. Holds the peer address and any
    /// enforced messaging options.
    pub peer: Account<'info, PeerConfig>,
    #[account(seeds = [STORE_SEED], bump = store.bump)]
    /// OApp Store PDA that signs the send instruction
    pub store: Account<'info, Store>,
    #[account(seeds = [ENDPOINT_SEED], bump = endpoint.bump, seeds::program = ENDPOINT_ID)]
    pub endpoint: Account<'info, EndpointSettings>,
}

pub fn handler(ctx: Context<SendMessage>, params: SendMessageParams) -> Result<()> {
    // Serialize the message according to our codec
    let message = msg_codec::encode(&params.message);
    // Prepare the seeds for the OApp Store PDA, which is used to sign the CPI call to the Endpoint program.
    let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];

    // Prepare the SendParams for the Endpoint::send CPI call.
    let send_params = SendParams {
        dst_eid: params.dst_eid,
        receiver: ctx.accounts.peer.peer_address,
        message,
        options: ctx
            .accounts
            .peer
            .enforced_options
            .combine_options(&None::<Vec<u8>>, &params.options)?,
        native_fee: params.native_fee,
        lz_token_fee: params.lz_token_fee,
    };
    // Call the Endpoint::send CPI to send the message.
    oapp::endpoint_cpi::send(
        ENDPOINT_ID,
        ctx.accounts.store.key(), // payer/signer derived from seeds
        ctx.remaining_accounts,
        seeds,
        send_params,
    )?;
    
    msg!("LayerZero message sent successfully");
    msg!("Destination endpoint: {}", params.dst_eid);
    msg!("Message: {}", params.message);
    msg!("Native fee: {}", params.native_fee);
    msg!("LZ token fee: {}", params.lz_token_fee);
    
    Ok(())
}