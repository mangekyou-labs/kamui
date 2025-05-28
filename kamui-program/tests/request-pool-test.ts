import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { expect } from "chai";

describe("Request Pool Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;

    let ownerKeypair: Keypair;
    let seedKeypair: Keypair;
    let subscriptionPda: PublicKey;
    let requestPoolPda: PublicKey;
    const poolId = 1;

    before(async () => {
        // Generate test keypairs
        ownerKeypair = Keypair.generate();
        seedKeypair = Keypair.generate();

        // Derive PDAs
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

        // Airdrop SOL to owner
        const signature = await provider.connection.requestAirdrop(
            ownerKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
    });

    it("Can create and manage request pool", async () => {
        try {
            // Create subscription first
            await program.methods
                .createEnhancedSubscription(
                    new anchor.BN(1000000), // min_balance
                    3, // confirmations
                    50 // max_requests
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    seed: seedKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Create request pool
            await program.methods
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

            // Verify request pool was created
            const requestPool = await program.account.requestPool.fetch(requestPoolPda);
            expect(requestPool.subscription.equals(subscriptionPda)).to.be.true;
            expect(requestPool.poolId).to.equal(poolId);
            expect(requestPool.requestCount).to.equal(0);
            expect(requestPool.maxSize).to.equal(32);

            // Add some test requests
            const testRequests = 5;
            for (let i = 0; i < testRequests; i++) {
                const seed = Buffer.alloc(32).fill(i); // Create a 32-byte seed
                const [requestPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("vrf_request"), seed],
                    program.programId
                );

                await program.methods
                    .requestRandomness(
                        Array.from(seed), // seed
                        Buffer.from([]), // callback_data
                        1, // num_words
                        3, // minimum_confirmations
                        new anchor.BN(100000), // callback_gas_limit
                        poolId // pool_id
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
            }

            // Verify request pool was updated
            const updatedPool = await program.account.requestPool.fetch(requestPoolPda);
            expect(updatedPool.requestCount).to.equal(testRequests);

            // Try to fulfill a request
            const seed = Buffer.alloc(32).fill(0); // First request seed
            const [requestPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("vrf_request"), seed],
                program.programId
            );

            const [vrfResultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("vrf_result"), requestPda.toBuffer()],
                program.programId
            );

            await program.methods
                .fulfillRandomness(
                    Buffer.from([]), // proof
                    Buffer.from([]), // public_key
                    Array.from(seed), // request_id
                    poolId,
                    0 // request_index
                )
                .accounts({
                    oracle: ownerKeypair.publicKey,
                    request: requestPda,
                    vrf_result: vrfResultPda,
                    requestPool: requestPoolPda,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify request pool count was decremented
            const finalPool = await program.account.requestPool.fetch(requestPoolPda);
            expect(finalPool.requestCount).to.equal(testRequests - 1);

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });
}); 