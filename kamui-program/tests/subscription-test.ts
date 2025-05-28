import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { expect } from "chai";

describe("Subscription Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;

    let ownerKeypair: Keypair;
    let seedKeypair: Keypair;
    let subscriptionPda: PublicKey;

    before(async () => {
        // Generate test keypairs
        ownerKeypair = Keypair.generate();
        seedKeypair = Keypair.generate();

        // Derive PDAs
        [subscriptionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subscription"), seedKeypair.publicKey.toBuffer()],
            program.programId
        );

        // Airdrop SOL to owner
        const signature = await provider.connection.requestAirdrop(
            ownerKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
    });

    it("Can manage subscription lifecycle", async () => {
        try {
            // Create subscription
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

            // Verify subscription was created
            const subscription = await program.account.enhancedSubscription.fetch(subscriptionPda);
            expect(subscription.owner.equals(ownerKeypair.publicKey)).to.be.true;
            expect(subscription.minBalance.toString()).to.equal("1000000");
            expect(subscription.confirmations).to.equal(3);
            expect(subscription.maxRequests).to.equal(50);

            // Fund subscription
            await program.methods
                .fundSubscription(
                    new anchor.BN(2000000) // amount
                )
                .accounts({
                    funder: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify subscription was funded
            const fundedSubscription = await program.account.enhancedSubscription.fetch(subscriptionPda);
            expect(fundedSubscription.balance.toString()).to.equal("2000000");

            // Update subscription config
            await program.methods
                .updateSubscriptionConfig(
                    new anchor.BN(1500000), // min_balance
                    4, // confirmations
                    60 // max_requests
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify subscription was updated
            const updatedSubscription = await program.account.enhancedSubscription.fetch(subscriptionPda);
            expect(updatedSubscription.minBalance.toString()).to.equal("1500000");
            expect(updatedSubscription.confirmations).to.equal(4);
            expect(updatedSubscription.maxRequests).to.equal(60);

            // Withdraw from subscription
            await program.methods
                .withdrawFromSubscription(
                    new anchor.BN(500000) // amount
                )
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify subscription balance was reduced
            const withdrawnSubscription = await program.account.enhancedSubscription.fetch(subscriptionPda);
            expect(withdrawnSubscription.balance.toString()).to.equal("1500000");

            // Cancel subscription
            await program.methods
                .cancelSubscription()
                .accounts({
                    owner: ownerKeypair.publicKey,
                    subscription: subscriptionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([ownerKeypair])
                .rpc();

            // Verify subscription was cancelled
            try {
                await program.account.enhancedSubscription.fetch(subscriptionPda);
                expect.fail("Subscription should have been cancelled");
            } catch (error) {
                expect(error.toString()).to.include("Account does not exist");
            }

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });
}); 