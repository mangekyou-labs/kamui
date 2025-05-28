import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import { KamuiLayerzero } from '../target/types/kamui_layerzero';
import { KamuiVrf } from '../target/types/kamui_vrf';
import { KamuiVrfConsumer } from '../target/types/kamui_vrf_consumer';

describe('LayerZero VRF Integration', () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiLayerzero as Program<KamuiLayerzero>;
    const vrfProgram = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer as Program<KamuiVrfConsumer>;

    // Constants for testing
    const ENDPOINT_AUTHORITY_SEED = Buffer.from('endpoint_authority');
    const EVENT_AUTHORITY_SEED = Buffer.from('event_authority');
    const OAPP_SEED = Buffer.from('oapp');

    // Authority account
    const authority = provider.wallet;

    // Test account keypairs
    const testOwner = Keypair.generate();

    // Find PDAs
    let endpointAuthority: PublicKey;
    let endpointAuthorityBump: number;
    let eventTracker: PublicKey;
    let oapp: PublicKey;

    before(async () => {
        console.log('Setting up test environment...');

        // Airdrop SOL to test owner
        const airdropSignature = await provider.connection.requestAirdrop(
            testOwner.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );

        await provider.connection.confirmTransaction(airdropSignature);

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
            [OAPP_SEED, testOwner.publicKey.toBuffer()],
            program.programId
        );
    });

    it('Can initialize the LayerZero endpoint', async () => {
        console.log('Attempting to initialize the endpoint...');

        try {
            // Initialize the endpoint
            const tx = await program.methods
                .initializeEndpoint(endpointAuthorityBump)
                .accounts({
                    payer: authority.publicKey,
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

    it('Registers an OApp', async () => {
        try {
            // Create emitter address (convert PublicKey to 32 byte array)
            const emitterAddress = Buffer.alloc(32);
            testOwner.publicKey.toBuffer().copy(emitterAddress);

            // Register the OApp
            await program.methods
                .registerOapp(0, [...emitterAddress]) // 0 is Solana chain ID
                .accounts({
                    owner: testOwner.publicKey,
                    endpoint: endpointAuthority,
                    oapp: oapp,
                    systemProgram: SystemProgram.programId,
                })
                .signers([testOwner])
                .rpc();

            console.log('✅ OApp registered successfully');

            // Fetch the OApp account to verify registration
            const oappAccount = await program.account.oApp.fetch(oapp);
            assert.deepEqual(oappAccount.owner.toBase58(), testOwner.publicKey.toBase58());

        } catch (error) {
            console.error('❌ Failed to register OApp:', error);
            throw error;
        }
    });

    // Additional tests would include:
    // - Setting trusted remotes
    // - Sending messages
    // - Receiving messages
    // - Processing VRF requests
    // - Sending VRF fulfillment
    // - Receiving VRF fulfillment
}); 