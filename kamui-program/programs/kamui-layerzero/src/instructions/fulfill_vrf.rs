use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::{STORE_SEED, PEER_SEED};
use crate::errors::LayerZeroError;
use crate::msg_codec::MessageCodec;
use oapp::{endpoint_cpi::{self}, endpoint::{ID as ENDPOINT_ID, instructions::SendParams}};

#[derive(Accounts)]
#[instruction(params: FulfillVrfParams)]
pub struct FulfillVrf<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    
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

pub fn handler(ctx: Context<FulfillVrf>, params: FulfillVrfParams) -> Result<()> {
        // Check if oracle is authorized
        if let Some(oracle_pubkey) = ctx.accounts.store.vrf_data.oracle_pubkey {
            if oracle_pubkey != ctx.accounts.oracle.key() {
                return Err(LayerZeroError::UnauthorizedOracle.into());
            }
        }

        // Find the request to fulfill
        let mut request_found = false;
        for request in &mut ctx.accounts.store.vrf_data.pending_requests {
            if request.request_id == params.request_id && !request.fulfilled {
                request.fulfilled = true;
                request_found = true;
                break;
            }
        }

        if !request_found {
            return Err(LayerZeroError::RequestNotFound.into());
        }

        // Create VRF fulfillment payload
        let fulfillment_payload = VrfFulfillmentPayload {
            msg_type: MessageType::VrfFulfillment,
            request_id: params.request_id,
            randomness: params.randomness.clone(),
            proof: params.proof.clone(),
        };

        // Encode the fulfillment message
        let message = MessageCodec::encode_vrf_fulfillment(&fulfillment_payload)?;

        // Send the fulfillment via LayerZero
        let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];
        
        let send_params = SendParams {
            dst_eid: params.dst_eid,
            receiver: ctx.accounts.peer.peer_address,
            message,
            options: vec![], // Default options
            native_fee: params.fee,
            lz_token_fee: 0,
        };

        endpoint_cpi::send(
            ENDPOINT_ID,
            ctx.accounts.store.key(),
            ctx.remaining_accounts,
            seeds,
            send_params,
        )?;

        msg!("VRF fulfillment sent to chain {}", params.dst_eid);
        msg!("Request ID: {:?}", params.request_id);

        Ok(())
} 