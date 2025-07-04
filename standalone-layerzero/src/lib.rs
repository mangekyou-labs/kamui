use anchor_lang::prelude::*;
use oapp::{endpoint::MessagingFee, endpoint_cpi::LzAccount, LzReceiveParams};
use solana_helper::program_id_from_env;

// to build in verifiable mode and using environment variable, run:
// anchor build -v -e KAMUI_LAYERZERO_ID=<OAPP_PROGRAM_ID>
// to build in normal mode and using environment, run:
// KAMUI_LAYERZERO_ID=$PROGRAM_ID anchor build 
declare_id!(anchor_lang::solana_program::pubkey::Pubkey::new_from_array(program_id_from_env!(
    "KAMUI_LAYERZERO_ID",
    "E8ka62cKB63dqbC3CLNReWXRVF4rHJy3qvaXcBimJQSU" // Default ID if environment variable not set
)));

// LayerZero OApp standard seeds - required for LayerZero compatibility
const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes"; // The Executor relies on this exact seed to derive the LzReceiveTypes PDA. Keep it the same.
const STORE_SEED: &[u8] = b"Store"; // You are free to edit this seed.
const PEER_SEED: &[u8] = b"Peer"; // The Executor relies on this exact seed to derive the Peer PDA. Keep it the same.

pub mod state;
pub mod errors;
pub mod instructions;
pub mod constants;
pub mod msg_codec;

// Import all instruction structs and parameter types
use instructions::*;
use state::*;

#[program]
pub mod kamui_layerzero {
    use super::*;

    /// Initialize the OApp Store PDA
    pub fn init_store(
        ctx: Context<InitStore>,
        params: InitStoreParams,
    ) -> Result<()> {
        instructions::init_store::handler(ctx, params)
    }

    /// Set peer configuration for a remote chain
    pub fn set_peer_config(
        ctx: Context<SetPeerConfig>,
        params: SetPeerConfigParams,
    ) -> Result<()> {
        instructions::set_peer_config::handler(ctx, params)
    }

    /// Returns the accounts required for lz_receive
    pub fn lz_receive_types(
        ctx: Context<LzReceiveTypes>,
        params: LzReceiveParams,
    ) -> Result<Vec<LzAccount>> {
        instructions::lz_receive_types::handler(ctx, params)
    }

    /// Process an incoming LayerZero message
    pub fn lz_receive(
        ctx: Context<LzReceive>,
        params: LzReceiveParams,
    ) -> Result<()> {
        instructions::lz_receive::handler(ctx, params)
    }

    /// Set delegate for LayerZero operations
    pub fn set_delegate(
        ctx: Context<SetDelegate>,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::set_delegate::handler(ctx, delegate)
    }

    /// Send a message to another chain
    pub fn send(
        ctx: Context<SendMessage>,
        params: SendMessageParams,
    ) -> Result<()> {
        instructions::send::handler(ctx, params)
    }

    /// Quote the fee for sending a message
    pub fn quote_send(
        ctx: Context<QuoteSend>,
        params: QuoteSendParams,
    ) -> Result<oapp::endpoint::MessagingFee> {
        instructions::quote_send::handler(ctx, params)
    }

    /// Send a LayerZero message with raw bytes
    pub fn lz_send(
        ctx: Context<LzSend>,
        params: LzSendParams,
    ) -> Result<()> {
        instructions::lz_send::handler(ctx, params)
    }

    /// Request VRF from another chain
    pub fn request_vrf(
        ctx: Context<RequestVrf>,
        params: RequestVrfParams,
    ) -> Result<()> {
        instructions::request_vrf::handler(ctx, params)
    }

    /// Fulfill VRF request
    pub fn fulfill_vrf(
        ctx: Context<FulfillVrf>,
        params: FulfillVrfParams,
    ) -> Result<()> {
        instructions::fulfill_vrf::handler(ctx, params)
    }
} 