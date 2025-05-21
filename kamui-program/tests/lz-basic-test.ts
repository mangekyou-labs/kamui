import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';

describe('LayerZero Basic Test', () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Get program reference - don't use the type import that might be causing issues
    const program = anchor.workspace.KamuiLayerzero;

    // Constants for testing
    const ENDPOINT_AUTHORITY_SEED = Buffer.from('endpoint_authority');
    const EVENT_AUTHORITY_SEED = Buffer.from('event_authority');
    const OAPP_SEED = Buffer.from('oapp');

    // Find PDAs
    let endpointAuthority: PublicKey;
    let endpointAuthorityBump: number;
    let eventTracker: PublicKey;
    let oapp: PublicKey;

    before(async () => {
        console.log('Setting up test environment...');

        // Find program PDAs
        [endpointAuthority, endpointAuthorityBump] = await PublicKey.findProgramAddress(
            [ENDPOINT_AUTHORITY_SEED],
            program.programId
        );

        [eventTracker] = await PublicKey.findProgramAddress(
            [EVENT_AUTHORITY_SEED],
            program.programId
        );

        [oapp] = await PublicKey.findProgramAddress(
            [OAPP_SEED, provider.wallet.publicKey.toBuffer()],
            program.programId
        );

        console.log("Endpoint authority:", endpointAuthority.toString());
        console.log("Event tracker:", eventTracker.toString());
        console.log("OApp:", oapp.toString());
    });

    it('Can initialize the LayerZero endpoint', async () => {
        console.log('Attempting to initialize the endpoint...');

        try {
            // Initialize the endpoint
            const tx = await program.methods
                .initializeEndpoint(endpointAuthorityBump)
                .accounts({
                    payer: provider.wallet.publicKey,
                    endpoint: endpointAuthority,
                    eventTracker: eventTracker,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log('Endpoint initialized successfully:', tx);
        } catch (error) {
            console.error('Failed to initialize endpoint:', error);
            throw error;
        }
    });

    it('Can register an OApp', async () => {
        console.log('Attempting to register OApp...');

        try {
            // Create emitter address (convert PublicKey to 32 byte array)
            const emitterAddress = Buffer.alloc(32);
            provider.wallet.publicKey.toBuffer().copy(emitterAddress);

            // Register the OApp
            const tx = await program.methods
                .registerOapp(0, Array.from(emitterAddress)) // 0 is Solana chain ID
                .accounts({
                    owner: provider.wallet.publicKey,
                    endpoint: endpointAuthority,
                    oapp: oapp,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log('OApp registered successfully:', tx);
        } catch (error) {
            console.error('Failed to register OApp:', error);
            throw error;
        }
    });
}); 