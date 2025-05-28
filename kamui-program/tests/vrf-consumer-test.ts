import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { KamuiVrfConsumer } from "../target/types/kamui_vrf_consumer";
import { expect } from "chai";

describe("VRF Consumer Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vrfProgram = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer as Program<KamuiVrfConsumer>;

    let ownerKeypair: Keypair;
    let oracleKeypair: Keypair;
    let registryPda: PublicKey;
    let oracleConfigPda: PublicKey;
    let subscriptionPda: PublicKey;
    let requestPoolPda: PublicKey;
    let consumerStatePda: PublicKey;
    const poolId = 1;

    before(async () => {
        // Generate test keypairs
        ownerKeypair = Keypair.generate();
        oracleKeypair = Keypair.generate();

        // Derive PDAs
        [registryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("oracle_registry")],
            vrfProgram.programId
        );

        [oracleConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("oracle_config"), oracleKeypair.publicKey.toBuffer()],
            vrfProgram.programId
        );

        [subscriptionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subscription"), ownerKeypair.publicKey.toBuffer()],
            vrfProgram.programId
        );

        [requestPoolPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("request_pool"),
                subscriptionPda.toBuffer(),
                Buffer.from([poolId])
            ],
            vrfProgram.programId
        );

        [consumerStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("consumer_state"), ownerKeypair.publicKey.toBuffer()],
            consumerProgram.programId
        );

        // Airdrop SOL to owner and oracle
        const signature1 = await provider.connection.requestAirdrop(
            ownerKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature1);

        const signature2 = await provider.connection.requestAirdrop(
            oracleKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature2);
    });

    it("Can request and consume randomness through consumer program", async () => {
        try {
            // Initialize oracle registry
            await vrfProgram.methods
                .initializeOracleRegistry(
                    new anchor.BN(1000000), // min_stake
                    new anchor.BN(500) // rotation_frequency
                )
                .accounts({
                    admin: ownerKeypair.publicKey,
                    registry: registryPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Register an oracle
            const vrfKey = Buffer.alloc(32).fill(1);
            await vrfProgram.methods
                .registerOracle(
                    Array.from(vrfKey),
                    new anchor.BN(1000000) // stake_amount
                )
                .accounts({
                    oracleAuthority: oracleKeypair.publicKey,
                    oracleConfig: oracleConfigPda,
                    registry: registryPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([oracleKeypair])
                .rpc();

            // Create subscription
            await vrfProgram.methods
                .createEnhancedSubscription(
                    new anchor.BN(1000000), // min_balance
                    3, // confirmations
                    50 // max_requests
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Create request pool
            await vrfProgram.methods
                .initializeRequestPool(
                    poolId,
                    32 // max_size
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Initialize consumer state
            await consumerProgram.methods
                .initialize()
                .accounts({
                    owner: ownerKeypair.publicKey,
                    consumerState: consumerStatePda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Request randomness through consumer
            const seed = Buffer.alloc(32).fill(1);
            const [requestPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("vrf_request"), seed],
                vrfProgram.programId
            );

            await consumerProgram.methods
                .requestRandomness(
                    Array.from(seed), // seed
                    poolId // pool_id
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    consumerState: consumerStatePda,
                    vrfProgram: vrfProgram.programId,
                    request: requestPda,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify consumer state was updated
            const consumerState = await consumerProgram.account.consumerState.fetch(consumerStatePda);
            expect(consumerState.lastRequestId).to.deep.equal(Array.from(seed));
            expect(consumerState.requestsPending).to.equal(1);

            // Fulfill randomness
            const [vrfResultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("vrf_result"), requestPda.toBuffer()],
                vrfProgram.programId
            );

            const proof = Buffer.alloc(32).fill(2);
            await vrfProgram.methods
                .fulfillRandomness(
                    Array.from(proof), // proof
                    Array.from(vrfKey), // public_key
                    Array.from(seed), // request_id
                    poolId,
                    0 // request_index
                )
                .accounts({
                    oracle: oracleKeypair.publicKey,
                    request: requestPda,
                    vrf_result: vrfResultPda,
                    requestPool: requestPoolPda,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([oracleKeypair])
                .rpc();

            // Process VRF callback through consumer
            await consumerProgram.methods
                .consumeRandomness()
                .accounts({
                    owner: ownerKeypair.publicKey,
                    consumerState: consumerStatePda,
                    vrfProgram: vrfProgram.programId,
                    request: requestPda,
                    subscription: subscriptionPda,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify consumer state was updated
            const updatedConsumerState = await consumerProgram.account.consumerState.fetch(consumerStatePda);
            expect(updatedConsumerState.requestsPending).to.equal(0);
            expect(updatedConsumerState.lastRandomValue).to.not.be.null;

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });
}); 