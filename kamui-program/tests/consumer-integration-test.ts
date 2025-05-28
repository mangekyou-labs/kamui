import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { KamuiVrfConsumer } from "../target/types/kamui_vrf_consumer";
import { expect } from "chai";

describe("Consumer Integration Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vrfProgram = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer as Program<KamuiVrfConsumer>;

    let ownerKeypair: Keypair;
    let consumerState: Keypair;
    let subscriptionPda: PublicKey;
    let requestPoolPda: PublicKey;
    let requestPda: PublicKey;
    let seed: Buffer;

    before(async () => {
        // Generate test keypairs
        ownerKeypair = Keypair.generate();
        consumerState = Keypair.generate();
        seed = Buffer.from("test_seed");

        // Derive PDAs
        [subscriptionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subscription"), ownerKeypair.publicKey.toBuffer()],
            vrfProgram.programId
        );

        [requestPoolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("request_pool"), subscriptionPda.toBuffer()],
            vrfProgram.programId
        );

        [requestPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("request"), seed],
            vrfProgram.programId
        );

        // Airdrop SOL to owner
        const signature = await provider.connection.requestAirdrop(
            ownerKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
    });

    it("Can initialize consumer state", async () => {
        try {
            await consumerProgram.methods
                .initialize()
                .accounts({
                    state: consumerState.publicKey,
                    owner: ownerKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([consumerState, ownerKeypair])
                .rpc();

            const stateAccount = await consumerProgram.account.consumerState.fetch(
                consumerState.publicKey
            );
            expect(stateAccount.owner.equals(ownerKeypair.publicKey)).to.be.true;

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });

    it("Can request and consume randomness", async () => {
        try {
            // Create subscription in VRF program
            await vrfProgram.methods
                .createSubscription()
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Create request pool
            await vrfProgram.methods
                .createRequestPool()
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Request randomness through consumer program
            await consumerProgram.methods
                .requestRandomness()
                .accounts({
                    state: consumerState.publicKey,
                    owner: ownerKeypair.publicKey,
                    vrfProgram: vrfProgram.programId,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                    request: requestPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Simulate VRF fulfillment
            const randomValue = Buffer.from("random_bytes_here");
            await vrfProgram.methods
                .fulfillRandomness(randomValue)
                .accounts({
                    request: requestPda,
                    subscription: subscriptionPda,
                    requestPool: requestPoolPda,
                })
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

            // Verify consumer state was updated with random value
            const stateAccount = await consumerProgram.account.consumerState.fetch(
                consumerState.publicKey
            );
            expect(stateAccount.lastRandomValue).to.not.be.null;

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });
}); 