const { Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Load keypair directly with better error handling
function loadKeypairFromFile(filePath) {
    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`Keypair file not found: ${filePath}`);
        }

        // Read and parse the file
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const secretKeyData = JSON.parse(fileContent);

        // Convert to Uint8Array
        const secretKey = Uint8Array.from(secretKeyData);

        // Validate length
        if (secretKey.length !== 64) {
            throw new Error(`Invalid keypair length: ${secretKey.length} (expected 64 bytes)`);
        }

        // Create the keypair
        const keypair = Keypair.fromSecretKey(secretKey);

        console.log(`Successfully loaded keypair: ${keypair.publicKey.toString()}`);
        return keypair;
    } catch (error) {
        console.error(`Error loading keypair: ${error.message}`);
        throw error;
    }
}

// Use keypair.json directly - no fallbacks
const keypairPath = path.join(__dirname, 'keypair.json');
console.log(`Loading keypair from: ${keypairPath}`);

let testKeypair;
try {
    testKeypair = loadKeypairFromFile(keypairPath);
} catch (error) {
    console.error('Failed to load keypair.json. Please make sure the file exists with proper format.');
    process.exit(1);
}

// Connect to devnet
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// The program ID for the VRF program
const programId = new PublicKey('BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D');

// Create a test transaction
async function sendTestTransaction() {
    try {
        // Check balance first
        const balance = await connection.getBalance(testKeypair.publicKey);
        console.log(`Current balance: ${balance / 1000000000} SOL`);

        if (balance <= 0) {
            console.log('Balance is zero - testing signing capability only');
            // Create a minimal transaction just to test signing capability
            const transaction = new Transaction();
            const recentBlockhash = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = recentBlockhash.blockhash;
            transaction.feePayer = testKeypair.publicKey;

            // Sign it to test that signing works
            console.log('Testing transaction signing capability...');
            try {
                transaction.sign(testKeypair);
                console.log('☑️ Signing capability test PASSED!');
                const serialized = transaction.serialize();
                console.log(`Transaction serialized successfully (${serialized.length} bytes)`);
                console.log('Keypair is valid for signing - transaction signature verified locally');
                return;
            } catch (signError) {
                console.error('❌ Signing capability test FAILED:', signError.message);
                return;
            }
        }

        // Create a simple transaction
        const transaction = new Transaction();

        // Generate a random recipient for our small transfer
        const recipientKeypair = Keypair.generate();
        console.log(`Sending to recipient: ${recipientKeypair.publicKey.toString()}`);

        // Calculate a safe amount to transfer (leave room for fees)
        const transferAmount = Math.min(1000, balance - 5000); // Very small amount

        if (transferAmount <= 0) {
            console.error('Insufficient balance for transfer');
            console.log('Testing signing capability only...');

            const recentBlockhash = await connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = recentBlockhash.blockhash;
            transaction.feePayer = testKeypair.publicKey;

            transaction.sign(testKeypair);
            console.log('☑️ Signing capability test PASSED!');
            return;
        }

        // Add a transfer instruction
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: testKeypair.publicKey,
                toPubkey: recipientKeypair.publicKey,
                lamports: transferAmount,
            })
        );

        // Get a recent blockhash
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = testKeypair.publicKey;

        // Sign and send the transaction
        console.log('Signing and sending transaction...');
        transaction.sign(testKeypair);

        const signature = await connection.sendTransaction(transaction, [testKeypair]);
        console.log(`Transaction sent! Signature: ${signature}`);
        console.log(`View transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        console.log('Transaction confirmed!', confirmation);

        return signature;
    } catch (error) {
        console.error('Error in test transaction:', error.message);
        if (error.logs) {
            console.error('Transaction logs:');
            error.logs.forEach(log => console.error(log));
        }
    }
}

// Execute the function
sendTestTransaction(); 