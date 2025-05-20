import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import { KamuiLayerzero } from '../target/types/kamui_layerzero';
import { KamuiVrf } from '../target/types/kamui_vrf';
import { KamuiVrfConsumer } from '../target/types/kamui_vrf_consumer';

describe('layerzero-vrf-integration', () => {
    // Configure the client
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const layerzeroProgram = anchor.workspace.KamuiLayerzero as Program<KamuiLayerzero>;
    const vrfProgram = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer as Program<KamuiVrfConsumer>;

    const owner = provider.wallet;
    let endpointAuthority: PublicKey;
    let endpointAuthorityBump: number;
    let eventTracker: PublicKey;
    let oappAccount: PublicKey;
    let nonceAccount: PublicKey;

    // Mock EVM chain ID and address
    const mockEvmChainId = 1; // Ethereum
    const mockEvmAddress = Buffer.from(Array(32).fill(1)); // Mock EVM address

    // LayerZero seeds
    const ENDPOINT_AUTHORITY_SEED = Buffer.from('endpoint_authority');
    const EVENT_AUTHORITY_SEED = Buffer.from('event_authority');
    const OAPP_SEED = Buffer.from('oapp');
    const NONCE_ACCOUNT_SEED = Buffer.from('nonce');

    before(async () => {
        // Find PDAs
        [endpointAuthority, endpointAuthorityBump] = await PublicKey.findProgramAddress(
            [ENDPOINT_AUTHORITY_SEED],
            layerzeroProgram.programId
        );

        [eventTracker] = await PublicKey.findProgramAddress(
            [EVENT_AUTHORITY_SEED],
            layerzeroProgram.programId
        );

        [oappAccount] = await PublicKey.findProgramAddress(
            [OAPP_SEED, owner.publicKey.toBuffer()],
            layerzeroProgram.programId
        );

        // For testing, create mock source chain ID and address
        const mockSrcChainId = new Uint8Array(2);
        mockSrcChainId[0] = mockEvmChainId & 0xff;
        mockSrcChainId[1] = (mockEvmChainId >> 8) & 0xff;

        [nonceAccount] = await PublicKey.findProgramAddress(
            [
                NONCE_ACCOUNT_SEED,
                oappAccount.toBuffer(),
                mockSrcChainId,
                mockEvmAddress,
            ],
            layerzeroProgram.programId
        );
    });

    it('Initialize LayerZero endpoint', async () => {
        try {
            const tx = await layerzeroProgram.methods
                .initializeEndpoint(endpointAuthorityBump)
                .accounts({
                    payer: owner.publicKey,
                    endpoint: endpointAuthority,
                    eventTracker: eventTracker,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log('Endpoint initialized:', tx);

            // Fetch the endpoint account
            const endpoint = await layerzeroProgram.account.endpoint.fetch(endpointAuthority);
            assert.equal(endpoint.authority.toString(), owner.publicKey.toString());
            assert.equal(endpoint.authorityBump, endpointAuthorityBump);
            assert.equal(endpoint.outboundNonce, 0);
            assert.equal(endpoint.collectedFees, 0);
        } catch (e) {
            console.error('Failed to initialize endpoint:', e);
            throw e;
        }
    });

    it('Register OApp', async () => {
        try {
            // Create emitter address as bytes (convert PublicKey to 32 byte array)
            const emitterAddress = new Uint8Array(32);
            owner.publicKey.toBuffer().copy(emitterAddress);

            const tx = await layerzeroProgram.methods
                .registerOapp(0, emitterAddress) // 0 is Solana chain ID
                .accounts({
                    owner: owner.publicKey,
                    endpoint: endpointAuthority,
                    oapp: oappAccount,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log('OApp registered:', tx);

            // Fetch the OApp account
            const oapp = await layerzeroProgram.account.oApp.fetch(oappAccount);
            assert.equal(oapp.owner.toString(), owner.publicKey.toString());
            assert.equal(oapp.appId.toString(), oappAccount.toString());
            assert.equal(oapp.outboundNonce, 0);
            assert.equal(oapp.trustedRemotes.length, 0);
            assert.equal(oapp.pendingRequests.length, 0);
        } catch (e) {
            console.error('Failed to register OApp:', e);
            throw e;
        }
    });

    it('Set trusted remote', async () => {
        try {
            const tx = await layerzeroProgram.methods
                .setTrustedRemote(mockEvmChainId, mockEvmAddress)
                .accounts({
                    owner: owner.publicKey,
                    oapp: oappAccount,
                })
                .rpc();

            console.log('Trusted remote set:', tx);

            // Fetch the OApp account
            const oapp = await layerzeroProgram.account.oApp.fetch(oappAccount);
            assert.equal(oapp.trustedRemotes.length, 1);
            assert.equal(oapp.trustedRemotes[0].chainId, mockEvmChainId);
            // Check the address (Buffer.compare returns 0 if equal)
            assert.equal(Buffer.compare(Buffer.from(oapp.trustedRemotes[0].address), mockEvmAddress), 0);
        } catch (e) {
            console.error('Failed to set trusted remote:', e);
            throw e;
        }
    });

    it('Simulate receiving a VRF request from EVM chain', async () => {
        try {
            // Create a random seed
            const seed = Keypair.generate().publicKey.toBuffer().slice(0, 32);
            const callbackData = Buffer.from('test_callback_data');

            // Create payload (message type + request payload)
            const messageType = 0; // VRF Request
            const requester = mockEvmAddress;
            const numWords = 1;
            const poolId = 0;

            // Mock the payload that would come from the EVM chain
            const payload = Buffer.from([messageType, ...requester, ...seed, ...callbackData, numWords, poolId]);

            const tx = await layerzeroProgram.methods
                .receiveMessage(mockEvmChainId, mockEvmAddress, 1, payload)
                .accounts({
                    receiver: owner.publicKey,
                    oapp: oappAccount,
                    nonceAccount: nonceAccount,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log('Received VRF request:', tx);

            // Fetch the OApp account
            const oapp = await layerzeroProgram.account.oApp.fetch(oappAccount);
            assert.equal(oapp.pendingRequests.length, 1);
            assert.equal(oapp.pendingRequests[0].srcChainId, mockEvmChainId);
            assert.equal(Buffer.compare(Buffer.from(oapp.pendingRequests[0].srcAddress), mockEvmAddress), 0);
            assert.equal(oapp.pendingRequests[0].fulfilled, false);
        } catch (e) {
            console.error('Failed to receive VRF request:', e);
            throw e;
        }
    });

    // Additional tests could be added for:
    // - Processing VRF request
    // - Sending VRF fulfillment
    // - Receiving VRF fulfillment
}); 