import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { KamuiVrfConsumer } from "../target/types/kamui_vrf_consumer";
import { expect } from "chai";

describe("VRF Fulfillment Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer as Program<KamuiVrfConsumer>;

    let ownerKeypair: Keypair;
    let seedKeypair: Keypair;
    let poolId = 1;
    let subscriptionPda: PublicKey;
    let requestPoolPda: PublicKey;
    let requestPda: PublicKey;
    let seed: Buffer;

    before(async () => {
        // Generate keypairs for testing
        ownerKeypair = Keypair.generate();
        seedKeypair = Keypair.generate();
        seed = Keypair.generate().publicKey.toBuffer();

        // Airdrop SOL to owner for testing
        try {
            const signature = await provider.connection.requestAirdrop(
                ownerKeypair.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(signature);
            console.log(`Airdropped 2 SOL to owner: ${ownerKeypair.publicKey.toString()}`);
        } catch (error) {
            console.log("Airdrop failed, continuing with existing balance");
        }

        // Setup subscription and pool first
        const minBalance = new anchor.BN(1000000);
        const confirmations = 3;
        const maxRequests = 50;

        // Find PDAs
        [subscriptionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subscription"), seedKeypair.publicKey.toBuffer()],
            program.programId
        );

        [requestPoolPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("request_pool"),
                subscriptionPda.toBuffer(),
                Buffer.from([poolId])
            ],
            program.programId
        );

        [requestPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vrf_request"), seed],
            program.programId
        );

        try {
            // Create subscription
            await program.methods
                .createEnhancedSubscription(minBalance, confirmations, maxRequests)
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    seed: seedKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Fund subscription
            await program.methods
                .fundSubscription(new anchor.BN(500000))
                .accounts({
                    funder: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Initialize request pool
            await program.methods
                .initializeRequestPool(poolId, 32)
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Request randomness
            const callbackData = Buffer.from("test-callback");
            const numWords = 1;
            const minConfirmations = 3;
            const callbackGasLimit = new anchor.BN(100000);

            await program.methods
                .requestRandomness(
                    [...seed],
                    callbackData,
                    numWords,
                    minConfirmations,
                    callbackGasLimit,
                    poolId
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    request: requestPda,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            console.log("Setup completed successfully");
        } catch (error) {
            console.error("Setup failed:", error);
            throw error;
        }
    });

    it("Fulfills VRF request successfully", async () => {
        // Generate mock VRF proof and result
        const proof = Buffer.alloc(80, 1); // Mock proof data
        const result = Buffer.alloc(32, 2); // Mock result data

        try {
            const tx = await program.methods
                .fulfillRandomness(
                    [...proof],
                    [...result]
                )
                .accounts({
                    request: requestPda,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                })
                .rpc();

            console.log("VRF request fulfilled:", tx);

            // Verify request was fulfilled
            const requestAccount = await program.account.randomnessRequest.fetch(
                requestPda
            );

            expect(requestAccount.fulfilled).to.be.true;
            expect(Buffer.from(requestAccount.result)).to.deep.equal(result);

            // Verify pool and subscription were updated
            const poolAccount = await program.account.requestPool.fetch(requestPoolPda);
            const subscriptionAccount = await program.account.enhancedSubscription.fetch(
                subscriptionPda
            );

            expect(poolAccount.requestCount).to.equal(0); // Request removed from pool
            expect(subscriptionAccount.activeRequests).to.equal(0);

        } catch (error) {
            console.error("VRF fulfillment failed:", error);
            throw error;
        }
    });

    it("Executes callback successfully", async () => {
        try {
            const tx = await program.methods
                .executeCallback()
                .accounts({
                    request: requestPda,
                    subscription: subscriptionPda,
                })
                .rpc();

            console.log("Callback executed:", tx);

            // Verify callback was executed
            const requestAccount = await program.account.randomnessRequest.fetch(
                requestPda
            );

            expect(requestAccount.callbackExecuted).to.be.true;

        } catch (error) {
            console.error("Callback execution failed:", error);
            throw error;
        }
    });

    it("Rejects invalid VRF proof", async () => {
        // Generate new request for testing invalid proof
        const newSeed = Keypair.generate().publicKey.toBuffer();
        const [newRequestPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vrf_request"), newSeed],
            program.programId
        );

        // Create new request
        const callbackData = Buffer.from("test-callback");
        const numWords = 1;
        const minConfirmations = 3;
        const callbackGasLimit = new anchor.BN(100000);

        await program.methods
            .requestRandomness(
                [...newSeed],
                callbackData,
                numWords,
                minConfirmations,
                callbackGasLimit,
                poolId
            )
            .accounts({
                owner: ownerKeypair.publicKey,
                request: newRequestPda,
                subscription: subscriptionPda,
                requestPool: requestPoolPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([ownerKeypair])
            .rpc();

        // Try to fulfill with invalid proof
        const invalidProof = Buffer.alloc(80, 0); // Invalid proof
        const result = Buffer.alloc(32, 2);

        try {
            await program.methods
                .fulfillRandomness(
                    [...invalidProof],
                    [...result]
                )
                .accounts({
                    request: newRequestPda,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                })
                .rpc();

            // Should not reach here
            expect.fail("Expected transaction to fail with invalid proof");
        } catch (error) {
            console.log("Expected error for invalid proof:", error.message);
            expect(error.message).to.include("InvalidProof");
        }
    });

    it("Can consume randomness in consumer program", async () => {
        try {
            // Create consumer state account
            const consumerState = Keypair.generate();

            await consumerProgram.methods
                .initialize()
                .accounts({
                    state: consumerState.publicKey,
                    request: requestPda,
                    owner: ownerKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([consumerState, ownerKeypair])
                .rpc();

            // Consume randomness
            await consumerProgram.methods
                .consumeRandomness()
                .accounts({
                    state: consumerState.publicKey,
                    request: requestPda,
                    owner: ownerKeypair.publicKey,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify consumer state was updated
            const stateAccount = await consumerProgram.account.consumerState.fetch(
                consumerState.publicKey
            );
            expect(stateAccount.randomValue).to.not.be.null;

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });

    after(async () => {
        console.log("\n=== Test Summary ===");
        console.log(`Owner Address: ${ownerKeypair.publicKey.toString()}`);
        console.log(`Subscription PDA: ${subscriptionPda.toString()}`);
        console.log(`Request Pool PDA: ${requestPoolPda.toString()}`);
        console.log(`Request PDA: ${requestPda.toString()}`);

        try {
            const subscriptionAccount = await program.account.enhancedSubscription.fetch(
                subscriptionPda
            );
            const poolAccount = await program.account.requestPool.fetch(requestPoolPda);
            const requestAccount = await program.account.randomnessRequest.fetch(
                requestPda
            );

            console.log(`Subscription Balance: ${subscriptionAccount.balance.toString()} lamports`);
            console.log(`Active Requests: ${subscriptionAccount.activeRequests}`);
            console.log(`Pool Request Count: ${poolAccount.requestCount}`);
            console.log(`Request Fulfilled: ${requestAccount.fulfilled}`);
            console.log(`Callback Executed: ${requestAccount.callbackExecuted}`);
        } catch (error) {
            console.log("Could not fetch final state");
        }
    });
}); 