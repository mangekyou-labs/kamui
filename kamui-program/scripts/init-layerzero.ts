import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { KamuiLayerzero } from '../target/types/kamui_layerzero';

// LayerZero seeds
const ENDPOINT_AUTHORITY_SEED = Buffer.from('endpoint_authority');
const EVENT_AUTHORITY_SEED = Buffer.from('event_authority');
const OAPP_SEED = Buffer.from('oapp');

async function main() {
    // Configure the client
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const layerzeroProgram = anchor.workspace.KamuiLayerzero as Program<KamuiLayerzero>;

    const owner = provider.wallet;

    // Find PDAs
    const [endpointAuthority, endpointAuthorityBump] = await PublicKey.findProgramAddress(
        [ENDPOINT_AUTHORITY_SEED],
        layerzeroProgram.programId
    );

    const [eventTracker] = await PublicKey.findProgramAddress(
        [EVENT_AUTHORITY_SEED],
        layerzeroProgram.programId
    );

    const [oappAccount] = await PublicKey.findProgramAddress(
        [OAPP_SEED, owner.publicKey.toBuffer()],
        layerzeroProgram.programId
    );

    console.log('Initializing LayerZero endpoint...');

    // Initialize the endpoint
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

        // Register the OApp
        // Create emitter address as bytes (convert PublicKey to 32 byte array)
        const emitterAddress = new Uint8Array(32);
        owner.publicKey.toBuffer().copy(emitterAddress);

        const registerTx = await layerzeroProgram.methods
            .registerOapp(0, emitterAddress) // 0 is Solana chain ID
            .accounts({
                owner: owner.publicKey,
                endpoint: endpointAuthority,
                oapp: oappAccount,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log('OApp registered:', registerTx);
        console.log('OApp address:', oappAccount.toString());

        console.log('LayerZero initialization completed successfully!');
    } catch (e) {
        console.error('Error initializing LayerZero:', e);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
}); 