use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct SetTrustedRemote<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [OAPP_SEED, owner.key().as_ref()],
        bump,
        constraint = oapp.owner == owner.key() @ LayerZeroError::Unauthorized
    )]
    pub oapp: Account<'info, OApp>,
}

pub fn handle(
    ctx: &mut Context<SetTrustedRemote>,
    remote_chain_id: u16,
    remote_address: [u8; 32],
) -> Result<()> {
    // Don't allow setting trusted remote for Solana chain ID
    if remote_chain_id == SOLANA_CHAIN_ID {
        return Err(LayerZeroError::InvalidDestinationChain.into());
    }

    let oapp = &mut ctx.accounts.oapp;
    
    // Check if we already have this remote chain in our trusted remotes
    for trusted_remote in &mut oapp.trusted_remotes {
        if trusted_remote.chain_id == remote_chain_id {
            // Update the address
            trusted_remote.address = remote_address;
            msg!("Updated trusted remote for chain ID: {} with address: {:?}", remote_chain_id, remote_address);
            return Ok(());
        }
    }
    
    // Make sure we don't exceed the maximum allowed
    if oapp.trusted_remotes.len() >= MAX_TRUSTED_REMOTES {
        return Err(error!(LayerZeroError::InvalidRemoteAddress));
    }

    // Add the new trusted remote
    oapp.trusted_remotes.push(TrustedRemote {
        chain_id: remote_chain_id,
        address: remote_address,
    });

    msg!("Added new trusted remote for chain ID: {} with address: {:?}", remote_chain_id, remote_address);
    Ok(())
} 