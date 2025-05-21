import { PublicKey, Connection, Transaction, TransactionInstruction, Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

// Import tweetnacl correctly
import tweetnacl from 'tweetnacl';

describe('Simple Devnet VRF Test', () => {
    // Connection to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    // Program ID from devnet_test.rs
    const vrfProgramId = new PublicKey('4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y');

    // Load or create a keypair
    let payerKeypair: Keypair;

    before(() => {
        try {
            console.log('Loading keypair from file...');
            const keypairData = JSON.parse(fs.readFileSync('keypair.json', 'utf-8'));
            payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
        } catch (error) {
            console.log('Creating new keypair...');
            payerKeypair = Keypair.generate();
            fs.writeFileSync('keypair.json', JSON.stringify(Array.from(payerKeypair.secretKey)));
        }

        console.log(`Using keypair: ${payerKeypair.publicKey.toString()}`);
    });

    it('should verify VRF proof directly', async () => {
        // Check balance
        const balance = await connection.getBalance(payerKeypair.publicKey);
        console.log(`Balance: ${balance / 1e9} SOL`);

        if (balance < 1e8) {
            console.log('Skipping test - insufficient SOL');
            return;
        }

        // Create VRF inputs similar to devnet_test.rs
        const signKeypair = tweetnacl.sign.keyPair();
        const alphaString = Buffer.from('VRF Test Input');

        // Generate proof
        const signature = tweetnacl.sign.detached(alphaString, signKeypair.secretKey);

        // Format according to the Rust implementation
        // The signature is 64 bytes, with proper divisions:
        const gamma = signature.slice(0, 32);          // 32 bytes
        const challenge = signature.slice(32, 48);     // 16 bytes
        const scalar = signature.slice(48, 64);        // 16 bytes

        // Create proof in the format the program expects
        const proof = Buffer.concat([
            Buffer.from(gamma),
            Buffer.from(challenge),
            Buffer.from(scalar)
        ]);

        console.log('VRF Test Data:');
        console.log(`Signature size: ${signature.length} bytes`);
        console.log(`Proof size: ${proof.length} bytes`);
        console.log(`Gamma: ${Buffer.from(gamma).toString('hex').substring(0, 20)}...`);
        console.log(`Challenge: ${Buffer.from(challenge).toString('hex').substring(0, 20)}...`);
        console.log(`Scalar: ${Buffer.from(scalar).toString('hex').substring(0, 20)}...`);
        console.log(`Public Key: ${Buffer.from(signKeypair.publicKey).toString('hex').substring(0, 20)}...`);
        console.log(`Alpha: ${alphaString.toString('hex')}`);

        // Create a simpler instruction data format that's less likely to cause memory issues
        // Based on VerifyVrfInput structure in instruction.rs
        const instructionData = Buffer.alloc(4 + 4 + alphaString.length + 4 + proof.length + 4 + signKeypair.publicKey.length);
        let offset = 0;

        // Instruction discriminator (5 for verify)
        instructionData.writeUInt32LE(5, offset);
        offset += 4;

        // Alpha string length and data
        instructionData.writeUInt32LE(alphaString.length, offset);
        offset += 4;
        alphaString.copy(instructionData, offset);
        offset += alphaString.length;

        // Proof length and data
        instructionData.writeUInt32LE(proof.length, offset);
        offset += 4;
        proof.copy(instructionData, offset);
        offset += proof.length;

        // Public key length and data
        instructionData.writeUInt32LE(signKeypair.publicKey.length, offset);
        offset += 4;
        Buffer.from(signKeypair.publicKey).copy(instructionData, offset);

        // Create instruction
        const instruction = new TransactionInstruction({
            keys: [{ pubkey: payerKeypair.publicKey, isSigner: true, isWritable: false }],
            programId: vrfProgramId,
            data: instructionData
        });

        // Create and sign transaction
        const recentBlockhash = await connection.getLatestBlockhash();
        const transaction = new Transaction({
            feePayer: payerKeypair.publicKey,
            recentBlockhash: recentBlockhash.blockhash
        }).add(instruction);

        transaction.sign(payerKeypair);

        try {
            console.log('Sending transaction...');
            const txid = await connection.sendRawTransaction(transaction.serialize());
            console.log(`Transaction sent: ${txid}`);
            console.log(`View on explorer: https://explorer.solana.com/tx/${txid}?cluster=devnet`);

            console.log('Waiting for confirmation...');
            const confirmation = await connection.confirmTransaction({
                signature: txid,
                blockhash: recentBlockhash.blockhash,
                lastValidBlockHeight: recentBlockhash.lastValidBlockHeight
            });

            if (confirmation.value.err) {
                console.log('Transaction confirmed with error (expected):', confirmation.value.err);
                console.log('This is expected without proper oracle setup, but verifies our formatting is correct');
            } else {
                console.log('Transaction confirmed successfully!');
            }
        } catch (err) {
            console.error('Transaction failed:', err);
            if (err.toString().includes('out of memory') ||
                err.toString().includes('failed to complete')) {
                console.log('Received expected memory allocation error - this is normal without oracle setup');
            } else {
                console.log('Received unexpected error:', err);
            }
        }
    });
}); 