use anchor_lang::prelude::*;
use crate::state::*;
use crate::{PEER_SEED, STORE_SEED};

#[derive(Accounts)]
#[instruction(params: SetPeerConfigParams)]
pub struct SetPeerConfig<'info> {
    #[account(mut, address = store.admin)]
    /// Admin of the OApp store
    pub admin: Signer<'info>,
    #[account(
        init_if_needed,
        payer = admin,
        space = PeerConfig::SIZE,
        seeds = [PEER_SEED, &store.key().to_bytes(), &params.remote_eid.to_be_bytes()],
        bump
    )]
    /// Peer configuration PDA for a specific remote chain
    pub peer: Account<'info, PeerConfig>,
    #[account(seeds = [STORE_SEED], bump = store.bump)]
    /// Store PDA of this OApp
    pub store: Account<'info, Store>,
    pub system_program: Program<'info, System>,
}

impl<'info> SetPeerConfig<'info> {
    pub fn apply(ctx: &mut Context<SetPeerConfig>, params: &SetPeerConfigParams) -> Result<()> {
        // Update or create the peer config PDA
        match params.config.clone() {
            PeerConfigParam::PeerAddress(peer_address) => {
                ctx.accounts.peer.peer_address = peer_address;
            },
            PeerConfigParam::EnforcedOptions { send, send_and_call } => {
                oapp::options::assert_type_3(&send)?;
                ctx.accounts.peer.enforced_options.send = send;
                oapp::options::assert_type_3(&send_and_call)?;
                ctx.accounts.peer.enforced_options.send_and_call = send_and_call;
            },
        }
        // Store the PDA bump for later validation
        ctx.accounts.peer.bump = ctx.bumps.peer;
        
        msg!("Peer config set successfully");
        msg!("Remote EID: {}", params.remote_eid);
        
        Ok(())
    }
}

pub fn handler(mut ctx: Context<SetPeerConfig>, params: SetPeerConfigParams) -> Result<()> {
    SetPeerConfig::apply(&mut ctx, &params)
}

// Parameter structs are now defined in state.rs to avoid duplication 