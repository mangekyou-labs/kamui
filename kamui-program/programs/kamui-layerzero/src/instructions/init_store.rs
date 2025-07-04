use anchor_lang::prelude::*;
use crate::state::*;
use crate::{LZ_RECEIVE_TYPES_SEED, STORE_SEED};
use oapp::endpoint::{instructions::RegisterOAppParams, ID as ENDPOINT_ID};

#[derive(Accounts)]
pub struct InitStore<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = Store::SIZE,
        seeds = [STORE_SEED],
        bump
    )]
    pub store: Account<'info, Store>,
    
    #[account(
        init,
        payer = admin,
        space = LzReceiveTypesAccounts::SIZE,
        seeds = [LZ_RECEIVE_TYPES_SEED, store.key().as_ref()],
        bump
    )]
    pub lz_receive_types_accounts: Account<'info, LzReceiveTypesAccounts>,
    

    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitStore>, params: InitStoreParams) -> Result<()> {
    ctx.accounts.store.admin = params.admin;
    ctx.accounts.store.bump = ctx.bumps.store;
    ctx.accounts.store.endpoint_program = params.endpoint;
    ctx.accounts.lz_receive_types_accounts.store = ctx.accounts.store.key();
    // the above lines are required for all OApp implementations

    // the line below is specific to this string-passing example
    ctx.accounts.store.string = "Nothing received yet.".to_string();

    // Register with LayerZero endpoint
    let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];
    let register_params = RegisterOAppParams {
        delegate: ctx.accounts.store.admin,
    };
    oapp::endpoint_cpi::register_oapp(
        ENDPOINT_ID,
        ctx.accounts.store.key(),
        ctx.remaining_accounts,
        seeds,
        register_params,
    )?;
    
    msg!("LayerZero OApp Store initialized successfully");
    msg!("Store: {}", ctx.accounts.store.key());
    msg!("Admin: {}", ctx.accounts.store.admin);
    msg!("Endpoint: {}", ctx.accounts.store.endpoint_program);

    Ok(())
} 