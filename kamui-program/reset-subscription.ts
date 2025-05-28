import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection, clusterApiUrl, Transaction, TransactionInstruction } from "@solana/web3.js";

async function resetSubscription() {
    // Configure the client to use devnet
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    // Load wallet
    const wallet = anchor.AnchorProvider.env().wallet;
    const provider = new anchor.AnchorProvider(
        connection,
        wallet,
        { commitment: 'confirmed' }
    );

    const owner = provider.wallet.payer;
    if (!owner) {
        throw new Error("Wallet payer not found");
    }

    console.log(`Using wallet: ${owner.publicKey.toString()}`);

    // Program IDs
    const KAMUI_VRF_PROGRAM_ID = new PublicKey("6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a");

    // Derive subscription PDA
    const [subscriptionPDA, subscriptionBump] = await PublicKey.findProgramAddress(
        [Buffer.from("subscription"), owner.publicKey.toBuffer()],
        KAMUI_VRF_PROGRAM_ID
    );

    console.log(`Subscription PDA: ${subscriptionPDA.toString()}`);

    try {
        // Check current state
        const subscriptionData = await connection.getAccountInfo(subscriptionPDA);
        if (subscriptionData) {
            console.log(`Current subscription data length: ${subscriptionData.data.length}`);
            console.log(`Current subscription lamports: ${subscriptionData.lamports}`);

            // Read corrupted values
            if (subscriptionData.data.length >= 64) {
                const balance = new DataView(subscriptionData.data.buffer).getBigUint64(40, true);
                const minBalance = new DataView(subscriptionData.data.buffer).getBigUint64(48, true);
                const activeRequests = new DataView(subscriptionData.data.buffer).getUint16(56, true);

                console.log(`Corrupted balance: ${balance}`);
                console.log(`Corrupted min_balance: ${minBalance}`);
                console.log(`Corrupted active_requests: ${activeRequests}`);
            }

            // Try to drain all lamports from the subscription account
            // This will effectively "close" the account
            const drainInstruction = SystemProgram.transfer({
                fromPubkey: subscriptionPDA,
                toPubkey: owner.publicKey,
                lamports: subscriptionData.lamports,
            });

            // Since this is a PDA, we need to use the program to authorize the transfer
            // But the current program doesn't have a close_subscription function
            // So we'll create a new clean subscription with fresh parameters

            console.log("⚠️ Cannot directly close PDA account. Will create new subscription with clean state.");
        } else {
            console.log("✅ No existing subscription found. Ready to create fresh subscription.");
        }

        // Create fresh subscription with clean parameters
        console.log("🔧 Creating fresh subscription with clean parameters...");

        const createSubscriptionData = Buffer.concat([
            // Instruction discriminator for create_enhanced_subscription
            Buffer.from([75, 228, 93, 239, 254, 201, 220, 235]),
            // min_balance (u64) - reasonable amount: 0.001 SOL = 1,000,000 lamports
            Buffer.from(new BigUint64Array([BigInt(1000000)]).buffer),
            // confirmations (u8)
            Buffer.from([3]),
            // max_requests (u16)
            Buffer.from(new Uint16Array([10]).buffer)
        ]);

        const createSubscriptionIx = new TransactionInstruction({
            keys: [
                { pubkey: owner.publicKey, isSigner: true, isWritable: true },
                { pubkey: subscriptionPDA, isSigner: false, isWritable: true },
                { pubkey: owner.publicKey, isSigner: false, isWritable: false }, // seed account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: KAMUI_VRF_PROGRAM_ID,
            data: createSubscriptionData,
        });

        const tx = new Transaction().add(createSubscriptionIx);

        try {
            const signature = await provider.sendAndConfirm(tx, [owner]);
            console.log(`✅ Fresh subscription created: ${signature}`);
            console.log(`🔗 Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        } catch (createError) {
            if (createError.message.includes("already in use")) {
                console.log("⚠️ Subscription account already exists. The corrupted state persists.");
                console.log("📝 Solution: Use a different seed for subscription creation or wait for program upgrade with close function.");

                // Show current state details for debugging
                const currentData = await connection.getAccountInfo(subscriptionPDA);
                if (currentData && currentData.data.length >= 64) {
                    console.log("\n🔍 Current subscription state analysis:");

                    // Parse the account data manually
                    const data = currentData.data;
                    console.log(`Raw data length: ${data.length} bytes`);
                    console.log(`First 64 bytes: ${Buffer.from(data.slice(0, 64)).toString('hex')}`);

                    // Try to read fields at expected offsets
                    try {
                        const owner = new PublicKey(data.slice(8, 40));
                        const balance = new DataView(data.buffer, data.byteOffset + 40).getBigUint64(0, true);
                        const minBalance = new DataView(data.buffer, data.byteOffset + 48).getBigUint64(0, true);
                        const confirmations = data[56];
                        const activeRequests = new DataView(data.buffer, data.byteOffset + 57).getUint16(0, true);
                        const maxRequests = new DataView(data.buffer, data.byteOffset + 59).getUint16(0, true);

                        console.log(`Owner: ${owner.toString()}`);
                        console.log(`Balance: ${balance}`);
                        console.log(`Min Balance: ${minBalance}`);
                        console.log(`Confirmations: ${confirmations}`);
                        console.log(`Active Requests: ${activeRequests}`);
                        console.log(`Max Requests: ${maxRequests}`);

                        // Check if values are reasonable
                        if (balance > BigInt(1000000000000)) { // > 1000 SOL
                            console.log("❌ Balance value is unreasonably high - account is corrupted");
                        }
                        if (minBalance > BigInt(1000000000000)) { // > 1000 SOL  
                            console.log("❌ Min balance value is unreasonably high - account is corrupted");
                        }
                        if (activeRequests > 1000) {
                            console.log("❌ Active requests count is unreasonably high - account is corrupted");
                        }

                    } catch (parseError) {
                        console.log(`❌ Error parsing subscription data: ${parseError.message}`);
                    }
                }
            } else {
                throw createError;
            }
        }

        // Fund the subscription if successfully created
        console.log("💰 Funding fresh subscription...");

        const fundData = Buffer.concat([
            // Instruction discriminator for fund_subscription
            Buffer.from([224, 196, 55, 110, 8, 87, 188, 114]),
            // amount (u64) - 0.1 SOL = 100,000,000 lamports
            Buffer.from(new BigUint64Array([BigInt(100000000)]).buffer)
        ]);

        const fundIx = new TransactionInstruction({
            keys: [
                { pubkey: owner.publicKey, isSigner: true, isWritable: true },
                { pubkey: subscriptionPDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: KAMUI_VRF_PROGRAM_ID,
            data: fundData,
        });

        const fundTx = new Transaction().add(fundIx);
        try {
            const fundSignature = await provider.sendAndConfirm(fundTx, [owner]);
            console.log(`✅ Subscription funded: ${fundSignature}`);
            console.log(`🔗 Explorer: https://explorer.solana.com/tx/${fundSignature}?cluster=devnet`);
        } catch (fundError) {
            console.log(`❌ Failed to fund subscription: ${fundError.message}`);
        }

        // Verify final state
        const finalData = await connection.getAccountInfo(subscriptionPDA);
        if (finalData && finalData.data.length >= 64) {
            const finalBalance = new DataView(finalData.data.buffer).getBigUint64(40, true);
            const finalMinBalance = new DataView(finalData.data.buffer).getBigUint64(48, true);
            const finalActiveRequests = new DataView(finalData.data.buffer).getUint16(56, true);

            console.log("\n✅ Final subscription state:");
            console.log(`Balance: ${finalBalance} lamports (${Number(finalBalance) / 1e9} SOL)`);
            console.log(`Min Balance: ${finalMinBalance} lamports (${Number(finalMinBalance) / 1e9} SOL)`);
            console.log(`Active Requests: ${finalActiveRequests}`);

            if (finalBalance >= finalMinBalance) {
                console.log("🎉 Subscription is properly funded and ready for VRF requests!");
            } else {
                console.log("⚠️ Subscription needs more funding to meet minimum balance requirement");
            }
        }

    } catch (error) {
        console.error("❌ Error resetting subscription:", error);
        throw error;
    }
}

// Self-executing async function
if (require.main === module) {
    resetSubscription().catch(console.error);
}

export { resetSubscription }; 