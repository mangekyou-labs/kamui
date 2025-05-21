use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::*;
use kamui_vrf::cpi::accounts::RequestRandomness;
use kamui_vrf::cpi::request_randomness;
use kamui_vrf::state::EnhancedSubscription;

#[derive(Accounts)]
pub struct ProcessVrfRequest<'info> {
    #[account(mut)]
    pub processor: Signer<'info>,
    
    #[account(
        mut,
        seeds = [OAPP_SEED, processor.key().as_ref()],
        bump,
        constraint = oapp.owner == processor.key() @ LayerZeroError::Unauthorized
    )]
    pub oapp: Account<'info, OApp>,
    
    /// The Kamui VRF subscription account
    #[account(mut)]
    pub subscription: Account<'info, EnhancedSubscription>,
    
    /// The Kamui VRF request pool
    /// CHECK: This account is validated in the CPI call to the Kamui VRF program
    #[account(mut)]
    pub request_pool: AccountInfo<'info>,
    
    /// The Kamui VRF request account that will be initialized
    /// CHECK: This account is validated in the CPI call to the Kamui VRF program
    #[account(mut)]
    pub request: AccountInfo<'info>,
    
    /// The Kamui VRF program
    pub kamui_vrf_program: Program<'info, kamui_vrf::program::KamuiVrf>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: &mut Context<ProcessVrfRequest>,
    seed: [u8; 32],
    callback_data: Vec<u8>,
    num_words: u32,
    pool_id: u8,
) -> Result<()> {
    // Find a pending VRF request with matching seed
    let oapp = &mut ctx.accounts.oapp;
    let request_found = oapp.pending_requests.iter().position(|req| {
        !req.fulfilled && req.seed == seed
    });
    
    if request_found.is_none() {
        return Err(LayerZeroError::RequestNotFound.into());
    }
    
    // Set minimum confirmations and gas limit
    let minimum_confirmations: u8 = 1; // Single confirmation for Solana
    let callback_gas_limit: u64 = 100_000; // Gas limit for the callback
    
    // Request randomness from Kamui VRF
    let vrf_cpi_accounts = RequestRandomness {
        owner: ctx.accounts.processor.to_account_info(),
        subscription: ctx.accounts.subscription.to_account_info(),
        request_pool: ctx.accounts.request_pool.to_account_info(),
        request: ctx.accounts.request.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    
    let vrf_cpi_context = CpiContext::new(
        ctx.accounts.kamui_vrf_program.to_account_info(),
        vrf_cpi_accounts,
    );
    
    msg!("Requesting randomness from Kamui VRF with seed: {:?}", seed);
    request_randomness(
        vrf_cpi_context,
        seed,
        callback_data,
        num_words,
        minimum_confirmations,
        callback_gas_limit,
        pool_id,
    )?;
    
    // Mark as processing in our state
    if let Some(pos) = request_found {
        let request = &mut oapp.pending_requests[pos];
        request.fulfilled = true;
        msg!("VRF request processed successfully");
    }
    
    Ok(())
} 