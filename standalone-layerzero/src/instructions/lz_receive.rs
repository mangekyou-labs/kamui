use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LayerZeroError;
use crate::msg_codec::{self, MessageCodec};
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

    // Process the message based on its type
    let store = &mut ctx.accounts.store;
    
    // Try to decode the message type first
    match MessageCodec::decode_message_type(&params.message) {
        Ok(MessageType::VrfRequest) => {
            // Handle VRF request message - EVM compatible format
            match MessageCodec::decode_vrf_request(&params.message) {
                Ok(vrf_request) => {
                    // Generate a unique request ID based on the GUID
                    let request_id = params.guid;
                    
                    // Create a VRF request record - EVM compatible format
                    let vrf_req = VrfRequest {
                        request_id,
                        requester: Pubkey::try_from(vrf_request.requester).map_err(|_| LayerZeroError::InvalidRequester)?,
                        seed: vrf_request.seed,
                        num_words: vrf_request.num_words,        // Now u32 for EVM compatibility
                        pool_id: vrf_request.pool_id,            // New field for EVM compatibility
                        callback_data: vrf_request.callback_data, // Fixed 32 bytes for EVM compatibility
                        timestamp: Clock::get()?.unix_timestamp,
                        fulfilled: false,
                    };
                    
                    // Add to pending requests (limit check)
                    if store.vrf_data.pending_requests.len() < 100 {
                        store.vrf_data.pending_requests.push(vrf_req);
                    } else {
                        return Err(LayerZeroError::TooManyPendingRequests.into());
                    }
                    
                    msg!("VRF request received and stored (EVM compatible)");
                    msg!("Request ID: {:?}", request_id);
                    msg!("Requester: {:?}", vrf_request.requester);
                    msg!("Seed: {:?}", vrf_request.seed);
                    msg!("Num words: {}", vrf_request.num_words);
                    msg!("Pool ID: {}", vrf_request.pool_id);
                    msg!("Callback data: {:?}", vrf_request.callback_data);
                }
                Err(e) => {
                    msg!("Failed to decode VRF request: {:?}", e);
                    return Err(LayerZeroError::InvalidMessageFormat.into());
                }
            }
        }
        Ok(MessageType::VrfFulfillment) => {
            // Handle VRF fulfillment message - EVM compatible format
            match MessageCodec::decode_vrf_fulfillment(&params.message) {
                Ok(vrf_fulfillment) => {
                    // Find the corresponding request and mark it as fulfilled
                    let mut request_found = false;
                    for req in &mut store.vrf_data.pending_requests {
                        if req.request_id == vrf_fulfillment.request_id && !req.fulfilled {
                            req.fulfilled = true;
                            request_found = true;
                            break;
                        }
                    }
                    
                    if !request_found {
                        msg!("Warning: VRF fulfillment received for unknown request ID");
                    }
                    
                    msg!("VRF fulfillment received and processed (EVM compatible)");
                    msg!("Request ID: {:?}", vrf_fulfillment.request_id);
                    msg!("Randomness: 64 bytes (EVM compatible format)");
                    msg!("Randomness data: {:?}", vrf_fulfillment.randomness);
                }
                Err(e) => {
                    msg!("Failed to decode VRF fulfillment: {:?}", e);
                    return Err(LayerZeroError::InvalidMessageFormat.into());
                }
            }
        }
        Ok(MessageType::Generic) | Err(_) => {
            // Handle generic string message (fallback to original logic)
            match msg_codec::decode(&params.message) {
                Ok(string_value) => {
                    store.string = string_value;
                    msg!("Generic string message received: {}", store.string);
                }
                Err(e) => {
                    msg!("Failed to decode generic message: {:?}", e);
                    return Err(LayerZeroError::InvalidMessageFormat.into());
                }
            }
        }
    }

    msg!("Successfully processed LayerZero message");
    msg!("Source endpoint: {}", params.src_eid);
    msg!("Nonce: {}", params.nonce);
    msg!("Message type determined and processed");
    
    Ok(())
} 