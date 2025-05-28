import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("Enhanced VRF System Tests - Simplified", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Get programs - using any to avoid type issues for now
    const vrfConsumerProgram = anchor.workspace.kamuiVrfConsumer as any;

    // Use the provider wallet instead of generating a new one
    const owner = provider.wallet.payer;

    // PDAs
    let gameStatePDA: PublicKey;
    let gameBump: number;

    before(async () => {
        // Derive PDAs for testing
        [gameStatePDA, gameBump] = await PublicKey.findProgramAddress(
            [Buffer.from("game"), owner.publicKey.toBuffer()],
            vrfConsumerProgram.programId
        );
    });

    it("Initializes game state", async () => {
        try {
            // Check if account already exists
            let gameState;
            try {
                gameState = await vrfConsumerProgram.account.gameState.fetch(gameStatePDA);
                console.log("✅ Game state already exists, skipping initialization");
            } catch (fetchError) {
                // Account doesn't exist, initialize it
                await vrfConsumerProgram.methods
                    .initialize(gameBump)
                    .accounts({
                        owner: owner.publicKey,
                        gameState: gameStatePDA,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([owner])
                    .rpc();

                gameState = await vrfConsumerProgram.account.gameState.fetch(gameStatePDA);
                console.log("✅ Game state initialized successfully");
            }

            assert.equal(gameState.owner.toString(), owner.publicKey.toString());
            assert.equal(gameState.bump, gameBump);

        } catch (error) {
            console.log("❌ Error initializing game state:", error);
            throw error;
        }
    });

    it("Consumes randomness", async () => {
        try {
            // Generate some mock randomness (64 bytes)
            const mockRandomness = new Array(64).fill(0).map((_, i) => i % 256);

            await vrfConsumerProgram.methods
                .consumeRandomness(mockRandomness)
                .accounts({
                    caller: owner.publicKey,
                    gameState: gameStatePDA,
                })
                .signers([owner])
                .rpc();

            // Verify the result
            const gameState = await vrfConsumerProgram.account.gameState.fetch(gameStatePDA);
            console.log(`Game result: ${gameState.result}`);
            assert.isTrue(gameState.result > 0 && gameState.result <= 100, "Result should be between 1 and 100");

            console.log("✅ Randomness consumed successfully");
        } catch (error) {
            console.log("❌ Error consuming randomness:", error);
            throw error;
        }
    });

    it("Tests multiple randomness consumption", async () => {
        try {
            const results = [];

            // Test multiple randomness consumptions
            for (let i = 0; i < 3; i++) {
                // Generate different mock randomness each time
                const mockRandomness = new Array(64).fill(0).map((_, j) => (i * 64 + j) % 256);

                await vrfConsumerProgram.methods
                    .consumeRandomness(mockRandomness)
                    .accounts({
                        caller: owner.publicKey,
                        gameState: gameStatePDA,
                    })
                    .signers([owner])
                    .rpc();

                const gameState = await vrfConsumerProgram.account.gameState.fetch(gameStatePDA);
                results.push(gameState.result);
                console.log(`Test ${i + 1} result: ${gameState.result}`);
            }

            // Verify all results are valid
            results.forEach((result, index) => {
                assert.isTrue(result > 0 && result <= 100, `Result ${index + 1} should be between 1 and 100`);
            });

            console.log("✅ Multiple randomness consumption test completed");
            console.log("Results:", results);
        } catch (error) {
            console.log("❌ Error in multiple randomness test:", error);
            throw error;
        }
    });
}); 