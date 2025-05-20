use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(authority_bump: u8)]
pub struct InitializeEndpoint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<Endpoint>(),
        seeds = [ENDPOINT_AUTHORITY_SEED],
        bump
    )]
    pub endpoint: Account<'info, Endpoint>,

    #[account(
        init, 
        payer = payer,
        space = 8 + std::mem::size_of::<EventTracker>(),
        seeds = [EVENT_AUTHORITY_SEED],
        bump
    )]
    pub event_tracker: Account<'info, EventTracker>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: &Context<InitializeEndpoint>, authority_bump: u8) -> Result<()> {
    let endpoint = &mut ctx.accounts.endpoint;
    endpoint.authority = ctx.accounts.payer.key();
    endpoint.authority_bump = authority_bump;
    endpoint.outbound_nonce = 0;
    endpoint.collected_fees = 0;

    let event_tracker = &mut ctx.accounts.event_tracker;
    event_tracker.next_event_id = 0;

    Ok(())
} 