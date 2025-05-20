import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("kamui-vrf minimal test", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Let's directly create the program instances
    const kamuiVrfProgramId = new PublicKey("4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1");
    const kamuiVrfConsumerProgramId = new PublicKey("4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y");

    // Load IDL files directly
    const kamuiVrfIdl = JSON.parse(
        fs.readFileSync(
            path.resolve(__dirname, "../target/idl/kamui_vrf.json"),
            "utf8"
        )
    );

    const kamuiVrfConsumerIdl = JSON.parse(
        fs.readFileSync(
            path.resolve(__dirname, "../target/idl/kamui_vrf_consumer.json"),
            "utf8"
        )
    );

    // Create program interfaces
    const kamuiVrfProgram = new Program(kamuiVrfIdl, kamuiVrfProgramId, provider);
    const kamuiVrfConsumerProgram = new Program(kamuiVrfConsumerIdl, kamuiVrfConsumerProgramId, provider);

    // Generate keypairs for testing
    const oracleRegistryKeypair = Keypair.generate();
    const subscriptionAccountKeypair = Keypair.generate();

    it("Can initialize Oracle Registry", async () => {
        console.log("Initializing Oracle Registry");
        await kamuiVrfProgram.methods
            .initializeRegistry()
            .accounts({
                oracleRegistry: oracleRegistryKeypair.publicKey,
                authority: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([oracleRegistryKeypair])
            .rpc();

        const oracleRegistryAccount = await kamuiVrfProgram.account.oracleRegistry.fetch(
            oracleRegistryKeypair.publicKey
        );

        expect(oracleRegistryAccount.authority.toString()).to.equal(
            provider.wallet.publicKey.toString()
        );
        expect(oracleRegistryAccount.oracles.length).to.equal(0);
    });

    it("Can add an oracle to the registry", async () => {
        console.log("Adding oracle to registry");

        const oracleKeypair = Keypair.generate();
        const seed = Buffer.from("fixed_seed_for_testing").toString("hex");

        await kamuiVrfProgram.methods
            .addOracle(seed, oracleKeypair.publicKey)
            .accounts({
                oracleRegistry: oracleRegistryKeypair.publicKey,
                authority: provider.wallet.publicKey,
            })
            .rpc();

        const oracleRegistryAccount = await kamuiVrfProgram.account.oracleRegistry.fetch(
            oracleRegistryKeypair.publicKey
        );

        expect(oracleRegistryAccount.oracles.length).to.equal(1);
        expect(oracleRegistryAccount.oracles[0].pubkey.toString()).to.equal(
            oracleKeypair.publicKey.toString()
        );
        expect(oracleRegistryAccount.oracles[0].seed).to.equal(seed);
    });

    it("Can create a subscription account", async () => {
        console.log("Creating subscription account");

        await kamuiVrfConsumerProgram.methods
            .createSubscription()
            .accounts({
                oracleRegistry: oracleRegistryKeypair.publicKey,
                subscription: subscriptionAccountKeypair.publicKey,
                authority: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([subscriptionAccountKeypair])
            .rpc();

        const subscriptionAccount = await kamuiVrfConsumerProgram.account.subscription.fetch(
            subscriptionAccountKeypair.publicKey
        );

        expect(subscriptionAccount.authority.toString()).to.equal(
            provider.wallet.publicKey.toString()
        );
    });
}); 