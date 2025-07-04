use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LayerZeroError;
use crate::msg_codec;
use crate::{PEER_SEED, STORE_SEED};
use oapp::{
    endpoint::{
        cpi::accounts::Clear,
        instructions::ClearParams,
        ID as ENDPOINT_ID,
        ConstructCPIContext,
    },
    LzReceiveParams,
};

#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    /// OApp Store PDA.  This account represents the "address" of your OApp on
    /// Solana and can contain any state relevant to your application.
    /// Customize the fields in `Store` as needed.
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    /// Peer config PDA for the sending chain. Ensures `params.sender` can only be the allowed peer from that remote chain.
    #[account(
        seeds = [PEER_SEED, &store.key().to_bytes(), &params.src_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = params.sender == peer.peer_address @ LayerZeroError::InvalidSender
    )]
    pub peer: Account<'info, PeerConfig>
}

pub fn handler(ctx: Context<LzReceive>, params: LzReceiveParams) -> Result<()> {
    // The OApp Store PDA is used to sign the CPI to the Endpoint program.
    let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];

    // The first Clear::MIN_ACCOUNTS_LEN accounts were returned by
    // `lz_receive_types` and are required for Endpoint::clear
    let accounts_for_clear = &ctx.remaining_accounts[0..Clear::MIN_ACCOUNTS_LEN];
    
    // Call the Endpoint::clear CPI to clear the message from the Endpoint program.
    // This is necessary to ensure the message is processed only once and to
    // prevent replays.
    let _ = oapp::endpoint_cpi::clear(
        ENDPOINT_ID,
        ctx.accounts.store.key(),
        accounts_for_clear,
        seeds,
        ClearParams {
            receiver: ctx.accounts.store.key(),
            src_eid: params.src_eid,
            sender: params.sender,
            nonce: params.nonce,
            guid: params.guid,
            message: params.message.clone(),
        },
    )?;

    // From here on, you can process the message as needed by your use case.
    // For this implementation, we'll decode the string message
    let string_value = msg_codec::decode(&params.message)?;
    let store = &mut ctx.accounts.store;
    store.string = string_value;

    msg!("Successfully processed LayerZero message");
    msg!("Source endpoint: {}", params.src_eid);
    msg!("Message content: {}", store.string);
    msg!("Nonce: {}", params.nonce);
    
    Ok(())
} 