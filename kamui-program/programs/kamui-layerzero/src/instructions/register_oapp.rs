use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct RegisterOApp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [ENDPOINT_AUTHORITY_SEED],
        bump = endpoint.authority_bump,
    )]
    pub endpoint: Account<'info, Endpoint>,

    #[account(
        init,
        payer = owner,
        space = 8 + std::mem::size_of::<OApp>() + 
               (MAX_TRUSTED_REMOTES * std::mem::size_of::<TrustedRemote>()) +
               (MAX_PENDING_REQUESTS * std::mem::size_of::<PendingVrfRequest>()),
        seeds = [OAPP_SEED, owner.key().as_ref()],
        bump
    )]
    pub oapp: Account<'info, OApp>,

    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: &Context<RegisterOApp>,
    emitter_chain_id: u16,
    emitter_address: [u8; 32],
) -> Result<()> {
    // Validate the emitter chain ID
    if emitter_chain_id == SOLANA_CHAIN_ID {
        // If this is a Solana app, make sure the emitter address is valid
        let emitter_key = Pubkey::try_from(&emitter_address[..]).or(Err(LayerZeroError::InvalidRemoteAddress))?;
        if emitter_key != ctx.accounts.owner.key() {
            return Err(LayerZeroError::Unauthorized.into());
        }
    }

    let oapp = &mut ctx.accounts.oapp;
    oapp.owner = ctx.accounts.owner.key();
    let app_id = ctx.accounts.oapp.key();
    oapp.app_id = app_id;
    oapp.config = AppConfig {
        default_gas_limit: 100_000, // Default gas limit
        default_fee: 0,             // Default fee in lamports
    };
    oapp.outbound_nonce = 0;
    oapp.trusted_remotes = Vec::new();
    oapp.pending_requests = Vec::new();

    // If this is a remote emitter, add it to trusted remotes
    if emitter_chain_id != SOLANA_CHAIN_ID {
        oapp.trusted_remotes.push(TrustedRemote {
            chain_id: emitter_chain_id,
            address: emitter_address,
        });
    }

    msg!("OApp registered with app_id: {}", oapp.app_id);
    Ok(())
} 