import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { expect } from "chai";

describe("VRF Request Tests - Devnet", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;

    let ownerKeypair: Keypair;
    let seedKeypair: Keypair;
    let poolId = 1;
    let subscriptionPda: PublicKey;
    let requestPoolPda: PublicKey;

    before(async () => {
        // Generate keypairs for testing
        ownerKeypair = Keypair.generate();
        seedKeypair = Keypair.generate();

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

            console.log("Setup completed successfully");
        } catch (error) {
            console.error("Setup failed:", error);
            throw error;
        }
    });

    it("Requests randomness successfully", async () => {
        // Generate a random seed for VRF
        const seed = Keypair.generate().publicKey.toBuffer();
        const callbackData = Buffer.from("test-callback");
        const numWords = 1;
        const minConfirmations = 3;
        const callbackGasLimit = new anchor.BN(100000);

        // Find the randomness request PDA
        const [requestPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vrf_request"), seed],
            program.programId
        );

        try {
            const tx = await program.methods
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

            console.log("Randomness requested:", tx);

            // Verify request was created correctly
            const requestAccount = await program.account.randomnessRequest.fetch(
                requestPda
            );

            expect(Buffer.from(requestAccount.seed)).to.deep.equal(seed);
            expect(requestAccount.subscription.toString()).to.equal(subscriptionPda.toString());
            expect(requestAccount.numWords).to.equal(numWords);
            expect(requestAccount.callbackGasLimit.toNumber()).to.equal(callbackGasLimit.toNumber());
            expect(requestAccount.poolId).to.equal(poolId);

            // Verify pool was updated
            const poolAccount = await program.account.requestPool.fetch(requestPoolPda);
            expect(poolAccount.requestCount).to.be.greaterThan(0);

        } catch (error) {
            console.error("Randomness request failed:", error);
            throw error;
        }
    });

    it("Rejects request with insufficient balance", async () => {
        // Generate a random seed for VRF
        const seed = Keypair.generate().publicKey.toBuffer();
        const callbackData = Buffer.from("test-callback");
        const numWords = 1;
        const minConfirmations = 3;
        const callbackGasLimit = new anchor.BN(100000);

        // Create a new subscription with zero balance
        const newSeedKeypair = Keypair.generate();
        const [newSubscriptionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subscription"), newSeedKeypair.publicKey.toBuffer()],
            program.programId
        );

        const [newRequestPoolPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("request_pool"),
                newSubscriptionPda.toBuffer(),
                Buffer.from([poolId])
            ],
            program.programId
        );

        // Create subscription without funding it
        await program.methods
            .createEnhancedSubscription(new anchor.BN(1000000), 3, 50)
            .accounts({
                owner: ownerKeypair.publicKey,
                subscription: newSubscriptionPda,
                seed: newSeedKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([ownerKeypair])
            .rpc();

        // Initialize pool
        await program.methods
            .initializeRequestPool(poolId, 32)
            .accounts({
                owner: ownerKeypair.publicKey,
                subscription: newSubscriptionPda,
                requestPool: newRequestPoolPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([ownerKeypair])
            .rpc();

        // Find the randomness request PDA
        const [requestPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vrf_request"), seed],
            program.programId
        );

        try {
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
                    subscription: newSubscriptionPda,
                    requestPool: newRequestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Should not reach here
            expect.fail("Expected transaction to fail with insufficient balance");
        } catch (error) {
            console.log("Expected error for insufficient balance:", error.message);
            expect(error.message).to.include("InsufficientBalance");
        }
    });

    after(async () => {
        console.log("\n=== Test Summary ===");
        console.log(`Owner Address: ${ownerKeypair.publicKey.toString()}`);
        console.log(`Subscription PDA: ${subscriptionPda.toString()}`);
        console.log(`Request Pool PDA: ${requestPoolPda.toString()}`);

        try {
            const subscriptionAccount = await program.account.enhancedSubscription.fetch(
                subscriptionPda
            );
            const poolAccount = await program.account.requestPool.fetch(requestPoolPda);

            console.log(`Subscription Balance: ${subscriptionAccount.balance.toString()} lamports`);
            console.log(`Active Requests: ${subscriptionAccount.activeRequests}`);
            console.log(`Pool Request Count: ${poolAccount.requestCount}`);
        } catch (error) {
            console.log("Could not fetch final state");
        }
    });
}); 