import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { expect } from "chai";

describe("Oracle Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;

    let adminKeypair: Keypair;
    let oracleKeypair: Keypair;
    let registryPda: PublicKey;
    let oracleConfigPda: PublicKey;

    before(async () => {
        // Generate test keypairs
        adminKeypair = Keypair.generate();
        oracleKeypair = Keypair.generate();

        // Derive PDAs
        [registryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("oracle_registry")],
            program.programId
        );

        [oracleConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("oracle_config"), oracleKeypair.publicKey.toBuffer()],
            program.programId
        );

        // Airdrop SOL to admin and oracle
        const signature1 = await provider.connection.requestAirdrop(
            adminKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature1);

        const signature2 = await provider.connection.requestAirdrop(
            oracleKeypair.publicKey,
            1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature2);
    });

    it("Can initialize oracle registry and register oracle", async () => {
        try {
            // Initialize oracle registry
            await program.methods
                .initializeOracleRegistry(
                    new anchor.BN(1000000), // min_stake
                    new anchor.BN(500) // rotation_frequency
                )
                .accounts({
                    admin: adminKeypair.publicKey,
                    registry: registryPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([adminKeypair])
                .rpc();

            // Verify registry was created
            const registry = await program.account.oracleRegistry.fetch(registryPda);
            expect(registry.admin.equals(adminKeypair.publicKey)).to.be.true;
            expect(registry.minStake.toString()).to.equal("1000000");
            expect(registry.rotationFrequency.toString()).to.equal("500");
            expect(registry.oracleCount).to.equal(0);

            // Register an oracle
            const vrfKey = Buffer.alloc(32).fill(1);
            await program.methods
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

            // Verify oracle was registered
            const oracleConfig = await program.account.enhancedOracle.fetch(oracleConfigPda);
            expect(oracleConfig.authority.equals(oracleKeypair.publicKey)).to.be.true;
            expect(Buffer.from(oracleConfig.vrfKey)).to.deep.equal(vrfKey);
            expect(oracleConfig.stakeAmount.toString()).to.equal("1000000");
            expect(oracleConfig.isActive).to.be.true;

            // Verify registry was updated
            const updatedRegistry = await program.account.oracleRegistry.fetch(registryPda);
            expect(updatedRegistry.oracleCount).to.equal(1);
            expect(updatedRegistry.oracles[0].equals(oracleKeypair.publicKey)).to.be.true;

            // Rotate oracles
            await program.methods
                .rotateOracles()
                .accounts({
                    admin: adminKeypair.publicKey,
                    registry: registryPda,
                })
                .signers([adminKeypair])
                .rpc();

            // Verify rotation updated the registry
            const finalRegistry = await program.account.oracleRegistry.fetch(registryPda);
            expect(finalRegistry.lastRotation.toString()).to.not.equal("0");

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });
}); 