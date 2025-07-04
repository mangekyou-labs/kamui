use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::LayerZeroError;

#[derive(Accounts)]
pub struct SetDelegate<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [STORE_SEED],
        bump = store.bump,
        has_one = admin @ LayerZeroError::UnauthorizedAccess
    )]
    pub store: Account<'info, Store>,
}

pub fn handler(ctx: Context<SetDelegate>, delegate: Pubkey) -> Result<()> {
    // Update the admin/delegate in the store
    ctx.accounts.store.admin = delegate;
    
    msg!("Delegate set to: {}", delegate);
    
    Ok(())
} 