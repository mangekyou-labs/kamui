use anchor_lang::prelude::*;
<<<<<<< HEAD
=======
use anchor_lang::solana_program::keccak;
>>>>>>> main

declare_id!("9BpzQBQkCfyGya9YgTnvHYPzWZZdTTVQZCXdqNPZfKFs");

pub mod state;
pub mod errors;
pub mod instructions;
pub mod constants;

// Import instruction structs explicitly
<<<<<<< HEAD
use instructions::initialize_endpoint::*;
use instructions::register_oapp::*;
use instructions::set_trusted_remote::*;
use instructions::send_message::*;
use instructions::receive_message::*;
use instructions::process_vrf_request::*;
use instructions::send_vrf_fulfillment::*;
use instructions::receive_vrf_fulfillment::*;
=======
use crate::instructions::initialize_endpoint::InitializeEndpoint;
use crate::instructions::register_oapp::RegisterOApp;
use crate::instructions::set_trusted_remote::SetTrustedRemote;
use crate::instructions::send_message::SendMessage;
use crate::instructions::receive_message::ReceiveMessage;
use crate::instructions::process_vrf_request::ProcessVrfRequest;
use crate::instructions::send_vrf_fulfillment::SendVrfFulfillment;
use crate::instructions::receive_vrf_fulfillment::ReceiveVrfFulfillment;
>>>>>>> main

#[program]
pub mod kamui_layerzero {
    use super::*;

    /// Initialize the LayerZero program endpoint
    pub fn initialize_endpoint(
<<<<<<< HEAD
        mut ctx: Context<InitializeEndpoint>,
        authority_bump: u8,
    ) -> Result<()> {
        instructions::initialize_endpoint::handle(&mut ctx, authority_bump)
=======
        ctx: Context<InitializeEndpoint>,
        authority_bump: u8,
    ) -> Result<()> {
        instructions::initialize_endpoint::handle(&ctx, authority_bump)
>>>>>>> main
    }

    /// Register an OApp that can send and receive messages
    pub fn register_oapp(
<<<<<<< HEAD
        mut ctx: Context<RegisterOApp>,
        emitter_chain_id: u16,
        emitter_address: [u8; 32],
    ) -> Result<()> {
        instructions::register_oapp::handle(&mut ctx, emitter_chain_id, emitter_address)
=======
        ctx: Context<RegisterOApp>,
        emitter_chain_id: u16,
        emitter_address: [u8; 32],
    ) -> Result<()> {
        instructions::register_oapp::handle(&ctx, emitter_chain_id, emitter_address)
>>>>>>> main
    }

    /// Set a trusted remote OApp on another chain
    pub fn set_trusted_remote(
<<<<<<< HEAD
        mut ctx: Context<SetTrustedRemote>,
        remote_chain_id: u16,
        remote_address: [u8; 32],
    ) -> Result<()> {
        instructions::set_trusted_remote::handle(&mut ctx, remote_chain_id, remote_address)
=======
        ctx: Context<SetTrustedRemote>,
        remote_chain_id: u16,
        remote_address: [u8; 32],
    ) -> Result<()> {
        instructions::set_trusted_remote::handle(&ctx, remote_chain_id, remote_address)
>>>>>>> main
    }

    /// Send a cross-chain message to request VRF on Solana
    pub fn send_message(
<<<<<<< HEAD
        mut ctx: Context<SendMessage>,
=======
        ctx: Context<SendMessage>,
>>>>>>> main
        dst_chain_id: u16,
        adapter_params: Vec<u8>,
        payload: Vec<u8>,
        fee: u64,
    ) -> Result<()> {
<<<<<<< HEAD
        instructions::send_message::handle(&mut ctx, dst_chain_id, adapter_params, payload, fee)
=======
        instructions::send_message::handle(&ctx, dst_chain_id, adapter_params, payload, fee)
>>>>>>> main
    }

    /// Receive a message from another chain and process the VRF request
    pub fn receive_message(
<<<<<<< HEAD
        mut ctx: Context<ReceiveMessage>,
=======
        ctx: Context<ReceiveMessage>,
>>>>>>> main
        src_chain_id: u16,
        src_address: [u8; 32],
        nonce: u64,
        payload: Vec<u8>,
    ) -> Result<()> {
<<<<<<< HEAD
        instructions::receive_message::handle(&mut ctx, src_chain_id, src_address, nonce, payload)
=======
        instructions::receive_message::handle(&ctx, src_chain_id, src_address, nonce, payload)
>>>>>>> main
    }

    /// Process a VRF request from LayerZero message
    pub fn process_vrf_request(
<<<<<<< HEAD
        mut ctx: Context<ProcessVrfRequest>,
=======
        ctx: Context<ProcessVrfRequest>,
>>>>>>> main
        seed: [u8; 32],
        callback_data: Vec<u8>,
        num_words: u32,
        pool_id: u8,
    ) -> Result<()> {
<<<<<<< HEAD
        instructions::process_vrf_request::handle(&mut ctx, seed, callback_data, num_words, pool_id)
=======
        instructions::process_vrf_request::handle(&ctx, seed, callback_data, num_words, pool_id)
>>>>>>> main
    }

    /// Send VRF fulfillment back to the source chain
    pub fn send_vrf_fulfillment(
<<<<<<< HEAD
        mut ctx: Context<SendVrfFulfillment>,
=======
        ctx: Context<SendVrfFulfillment>,
>>>>>>> main
        dst_chain_id: u16,
        request_id: [u8; 32],
        randomness: [u8; 64],
        fee: u64,
    ) -> Result<()> {
<<<<<<< HEAD
        instructions::send_vrf_fulfillment::handle(&mut ctx, dst_chain_id, request_id, randomness, fee)
=======
        instructions::send_vrf_fulfillment::handle(&ctx, dst_chain_id, request_id, randomness, fee)
>>>>>>> main
    }

    /// Receive VRF fulfillment from Solana and forward to EVM consumer contract
    pub fn receive_vrf_fulfillment(
<<<<<<< HEAD
        mut ctx: Context<ReceiveVrfFulfillment>,
=======
        ctx: Context<ReceiveVrfFulfillment>,
>>>>>>> main
        src_chain_id: u16,
        src_address: [u8; 32],
        nonce: u64,
        request_id: [u8; 32],
        randomness: [u8; 64],
    ) -> Result<()> {
<<<<<<< HEAD
        instructions::receive_vrf_fulfillment::handle(&mut ctx, src_chain_id, src_address, nonce, request_id, randomness)
=======
        instructions::receive_vrf_fulfillment::handle(&ctx, src_chain_id, src_address, nonce, request_id, randomness)
>>>>>>> main
    }
} 