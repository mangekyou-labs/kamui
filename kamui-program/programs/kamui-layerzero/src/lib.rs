use anchor_lang::prelude::*;

declare_id!("9BpzQBQkCfyGya9YgTnvHYPzWZZdTTVQZCXdqNPZfKFs");

pub mod state;
pub mod errors;
pub mod instructions;
pub mod constants;

// Import instruction structs explicitly
use instructions::initialize_endpoint::*;
use instructions::register_oapp::*;
use instructions::set_trusted_remote::*;
use instructions::send_message::*;
use instructions::receive_message::*;
use instructions::process_vrf_request::*;
use instructions::send_vrf_fulfillment::*;
use instructions::receive_vrf_fulfillment::*;

#[program]
pub mod kamui_layerzero {
    use super::*;

    /// Initialize the LayerZero program endpoint
    pub fn initialize_endpoint(
        mut ctx: Context<InitializeEndpoint>,
        authority_bump: u8,
    ) -> Result<()> {
        instructions::initialize_endpoint::handle(&mut ctx, authority_bump)
    }

    /// Register an OApp that can send and receive messages
    pub fn register_oapp(
        mut ctx: Context<RegisterOApp>,
        emitter_chain_id: u16,
        emitter_address: [u8; 32],
    ) -> Result<()> {
        instructions::register_oapp::handle(&mut ctx, emitter_chain_id, emitter_address)
    }

    /// Set a trusted remote OApp on another chain
    pub fn set_trusted_remote(
        mut ctx: Context<SetTrustedRemote>,
        remote_chain_id: u16,
        remote_address: [u8; 32],
    ) -> Result<()> {
        instructions::set_trusted_remote::handle(&mut ctx, remote_chain_id, remote_address)
    }

    /// Send a cross-chain message to request VRF on Solana
    pub fn send_message(
        mut ctx: Context<SendMessage>,
        dst_chain_id: u16,
        adapter_params: Vec<u8>,
        payload: Vec<u8>,
        fee: u64,
    ) -> Result<()> {
        instructions::send_message::handle(&mut ctx, dst_chain_id, adapter_params, payload, fee)
    }

    /// Receive a message from another chain and process the VRF request
    pub fn receive_message(
        mut ctx: Context<ReceiveMessage>,
        src_chain_id: u16,
        src_address: [u8; 32],
        nonce: u64,
        payload: Vec<u8>,
    ) -> Result<()> {
        instructions::receive_message::handle(&mut ctx, src_chain_id, src_address, nonce, payload)
    }

    /// Process a VRF request from LayerZero message
    pub fn process_vrf_request(
        mut ctx: Context<ProcessVrfRequest>,
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        pool_id: u8,
    ) -> Result<()> {
        instructions::process_vrf_request::handle(&mut ctx, seed, callback_data, num_words, pool_id)
    }

    /// Send VRF fulfillment back to the source chain
    pub fn send_vrf_fulfillment(
        mut ctx: Context<SendVrfFulfillment>,
        dst_chain_id: u16,
        request_id: [u8; 32],
        randomness: [u8; 64],
        fee: u64,
    ) -> Result<()> {
        instructions::send_vrf_fulfillment::handle(&mut ctx, dst_chain_id, request_id, randomness, fee)
    }

    /// Receive VRF fulfillment from Solana and forward to EVM consumer contract
    pub fn receive_vrf_fulfillment(
        mut ctx: Context<ReceiveVrfFulfillment>,
        src_chain_id: u16,
        src_address: [u8; 32],
        nonce: u64,
        request_id: [u8; 32],
        randomness: [u8; 64],
    ) -> Result<()> {
        instructions::receive_vrf_fulfillment::handle(&mut ctx, src_chain_id, src_address, nonce, request_id, randomness)
    }
} 