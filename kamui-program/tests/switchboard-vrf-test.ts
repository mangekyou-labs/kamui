import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { KamuiVrf } from "../target/types/kamui_vrf";
import { AnchorWallet, SwitchboardTestContext, NodeOracle } from "@switchboard-xyz/solana.js";
import { expect } from "chai";

describe("Switchboard VRF Tests", () => {
    // Configure the client to use devnet
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.KamuiVrf as Program<KamuiVrf>;
    const payer = (provider.wallet as AnchorWallet).payer;

    let switchboard: SwitchboardTestContext;
    let oracle: NodeOracle;

    before(async () => {
        // Initialize Switchboard test context
        switchboard = await SwitchboardTestContext.loadFromProvider(provider, {
            name: "Test Queue",
            queueSize: 10,
            reward: 0,
            minStake: 0,
            oracleTimeout: 900,
            unpermissionedFeeds: true,
            unpermissionedVrf: true,
            enableBufferRelayers: true,
            oracle: {
                name: "Test Oracle",
                enable: true,
            },
        });

        // Start local oracle
        oracle = await NodeOracle.fromReleaseChannel({
            chain: "solana",
            releaseChannel: "testnet",
            network: "localnet",
            rpcUrl: provider.connection.rpcEndpoint,
            oracleKey: switchboard.oracle.publicKey.toBase58(),
            secretPath: switchboard.walletPath,
            silent: false,
            envVariables: {
                VERBOSE: "1",
                DEBUG: "1",
                DISABLE_NONCE_QUEUE: "1",
                DISABLE_METRICS: "1",
            },
        });

        await oracle.startAndAwait();
    });

    it("Can request and receive randomness", async () => {
        // Create VRF account
        const vrfSecret = anchor.web3.Keypair.generate();

        // Create VRF callback
        const vrfCallback = {
            programId: program.programId,
            accounts: [
                // Add required accounts for callback
                { pubkey: payer.publicKey, isSigner: false, isWritable: true },
            ],
            ixData: Buffer.alloc(0), // Add any instruction data needed
        };

        // Create VRF account
        const [vrfAccount] = await switchboard.queue.createVrf({
            callback: vrfCallback,
            authority: payer.publicKey,
            vrfKeypair: vrfSecret,
            enable: !switchboard.queue.unpermissionedVrfEnabled,
        });

        // Request randomness
        const [payerTokenWallet] = await switchboard.program.mint.getOrCreateWrappedUser(
            switchboard.program.walletPubkey,
            { fundUpTo: 1.0 }
        );

        // Request randomness and verify result
        try {
            const vrf = await vrfAccount.loadData();

            // Request randomness
            const tx = await vrfAccount.requestRandomness({
                payer: payerTokenWallet,
                payerAuthority: payer,
            });

            await provider.connection.confirmTransaction(tx);

            // Wait for oracle to respond
            let result: Buffer | null = null;
            while (!result) {
                await new Promise(r => setTimeout(r, 1000));
                const vrf = await vrfAccount.loadData();
                result = vrf.currentRound.result;
                if (result && result.length > 0) {
                    break;
                }
            }

            expect(result).to.not.be.null;
            expect(result!.length).to.be.greaterThan(0);

        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    });

    after(() => {
        oracle?.stop();
    });
}); 