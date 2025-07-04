import { Keypair, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    // Load the keypair from the correct location
    const keypairPath = path.join(__dirname, '../keypairs/keypair.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    // Get the balance
    const balance = await connection.getBalance(keypair.publicKey);
    console.log(`Found ${balance / LAMPORTS_PER_SOL} SOL in the keypair account`);
    console.log(`Account address: ${keypair.publicKey.toString()}`);

    if (balance <= 0) {
        console.log('No SOL to recover');
        return;
    }

    // Get the recipient address from command line
    const recipientAddress = process.argv[2];
    if (!recipientAddress) {
        console.error('Please provide recipient address as argument');
        process.exit(1);
    }

    const recipient = new PublicKey(recipientAddress);

    // Create transfer transaction
    // Leave enough for rent exemption
    const rentExemption = await connection.getMinimumBalanceForRentExemption(0);
    const transferAmount = balance - rentExemption - 5000; // 5000 lamports for transaction fee

    if (transferAmount <= 0) {
        console.log('Not enough balance to transfer after accounting for rent and fees');
        return;
    }

    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: recipient,
            lamports: transferAmount,
        })
    );

    try {
        const signature = await connection.sendTransaction(transaction, [keypair]);
        console.log(`Transferred ${transferAmount / LAMPORTS_PER_SOL} SOL to ${recipientAddress}`);
        console.log(`Transaction signature: ${signature}`);
    } catch (error) {
        console.error('Error sending transaction:', error);
    }
}

main().catch(console.error); 