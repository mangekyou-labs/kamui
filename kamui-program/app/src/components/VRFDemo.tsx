import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

// Program IDs from the deployed contracts
const KAMUI_VRF_PROGRAM_ID = new PublicKey('6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a');
const KAMUI_VRF_CONSUMER_PROGRAM_ID = new PublicKey('2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE');

// Helper function to generate random bytes using Web Crypto API
const generateRandomBytes = (length: number): Buffer => {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return Buffer.from(array);
};

// Helper function to create a hash using Web Crypto API
const sha256 = async (data: string): Promise<Buffer> => {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encodedData);
    return Buffer.from(hashBuffer);
};

const VRFDemo: FC = () => {
    const { connection } = useConnection();
    const { publicKey, sendTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const requestRandomness = useCallback(async () => {
        if (!publicKey || !sendTransaction) {
            setError('Please connect your wallet first');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Generate a unique seed for the request using Web Crypto API
            const seed = generateRandomBytes(32);
            console.log('Request seed:', seed.toString('hex'));

            // Create a new request account keypair
            const requestKeypair = Keypair.generate();
            console.log('Request account:', requestKeypair.publicKey.toString());

            // Find game state PDA
            const [gameState] = PublicKey.findProgramAddressSync(
                [Buffer.from('game'), publicKey.toBuffer()],
                KAMUI_VRF_CONSUMER_PROGRAM_ID
            );

            // Find subscription PDA using a unique seed
            const uniqueSeedString = `kamui-vrf-${publicKey.toString()}-${Date.now()}`;
            const seedHash = await sha256(uniqueSeedString);
            const subscriptionSeed = Keypair.fromSeed(seedHash.slice(0, 32));

            const [subscriptionPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('subscription'), subscriptionSeed.publicKey.toBuffer()],
                KAMUI_VRF_PROGRAM_ID
            );

            // Find request pool PDA
            const [requestPoolPDA] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('request_pool'),
                    subscriptionPDA.toBuffer(),
                    Buffer.from([0]) // pool_id = 0
                ],
                KAMUI_VRF_PROGRAM_ID
            );

            // Initialize request pool
            const initPoolData = Buffer.concat([
                Buffer.from([179, 102, 255, 254, 232, 62, 64, 97]), // initialize_request_pool discriminator
                Buffer.from([0]), // pool_id
                serializeU32(100) // max_size
            ]);

            const initPoolIx = {
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: subscriptionPDA, isSigner: false, isWritable: false },
                    { pubkey: requestPoolPDA, isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: KAMUI_VRF_PROGRAM_ID,
                data: initPoolData,
            };

            // Create subscription if needed
            const minBalance = BigInt(10_000_000); // 0.01 SOL
            const createSubscriptionData = Buffer.concat([
                Buffer.from([75, 228, 93, 239, 254, 201, 220, 235]), // create_enhanced_subscription discriminator
                serializeU64(minBalance),
                Buffer.from([3]), // confirmations
                serializeU16(10) // max_requests
            ]);

            const createSubscriptionIx = {
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: subscriptionPDA, isSigner: false, isWritable: true },
                    { pubkey: subscriptionSeed.publicKey, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: KAMUI_VRF_PROGRAM_ID,
                data: createSubscriptionData,
            };

            // Fund subscription
            const fundingAmount = BigInt(50_000_000); // 0.05 SOL
            const fundData = Buffer.concat([
                Buffer.from([224, 196, 55, 110, 8, 87, 188, 114]), // fund_subscription discriminator
                serializeU64(fundingAmount)
            ]);

            const fundIx = {
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: subscriptionPDA, isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: KAMUI_VRF_PROGRAM_ID,
                data: fundData,
            };

            // Request randomness instruction
            const callbackData = Buffer.alloc(0);
            const requestData = Buffer.concat([
                Buffer.from([213, 5, 173, 166, 37, 236, 31, 18]), // request_randomness discriminator
                seed,
                serializeU32(callbackData.length),
                callbackData,
                serializeU32(1), // num_words
                Buffer.from([1]), // minimum_confirmations
                serializeU64(BigInt(100000)), // callback_gas_limit
                Buffer.from([0]), // pool_id
            ]);

            const requestIx = {
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: requestKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: subscriptionPDA, isSigner: false, isWritable: true },
                    { pubkey: requestPoolPDA, isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: KAMUI_VRF_PROGRAM_ID,
                data: requestData,
            };

            // Get recent blockhash
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            // Create transaction with all instructions in correct order
            const tx = new Transaction({
                feePayer: publicKey,
                blockhash,
                lastValidBlockHeight,
            }).add(
                createSubscriptionIx,
                fundIx,
                initPoolIx,
                requestIx
            );

            // Partially sign with our keypairs first
            tx.sign(subscriptionSeed, requestKeypair);

            // Send transaction (wallet will sign automatically)
            const signature = await sendTransaction(tx, connection, {
                skipPreflight: true // Skip preflight to see actual errors
            });

            // Wait for confirmation
            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight,
            });

            if (confirmation.value.err) {
                console.error('Transaction error details:', confirmation.value.err);
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log('Transaction successful:', signature);

            // Start polling for result
            pollForResult(requestKeypair.publicKey);

        } catch (err) {
            console.error('Error requesting randomness:', err);
            let errorMessage = 'An error occurred';

            if (err instanceof Error) {
                errorMessage = err.message;
            } else if (typeof err === 'object' && err !== null) {
                errorMessage = JSON.stringify(err, null, 2);
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [publicKey, connection, sendTransaction]);

    // Helper functions for serialization
    const serializeU64 = (value: bigint): Buffer => {
        const buffer = Buffer.alloc(8);
        let val = value;
        for (let i = 0; i < 8; i++) {
            buffer[i] = Number(val & BigInt(0xFF));
            val = val >> BigInt(8);
        }
        return buffer;
    };

    const serializeU32 = (value: number): Buffer => {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32LE(value, 0);
        return buffer;
    };

    const serializeU16 = (value: number): Buffer => {
        const buffer = Buffer.alloc(2);
        buffer.writeUInt16LE(value, 0);
        return buffer;
    };

    const pollForResult = async (requestPubkey: PublicKey) => {
        const interval = setInterval(async () => {
            try {
                const account = await connection.getAccountInfo(requestPubkey);
                if (account) {
                    const result = account.data.readUInt32LE(41);
                    if (result > 0) {
                        setResult(result);
                        clearInterval(interval);
                    }
                }
            } catch (err) {
                console.error('Error polling for result:', err);
            }
        }, 2000);

        setTimeout(() => clearInterval(interval), 30000);
    };

    return (
        <div className="max-w-2xl mx-auto bg-white/10 rounded-xl p-8 backdrop-blur-lg">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-4">Verifiable Random Function Demo</h2>
                <p className="text-gray-300 mb-6">
                    Generate provably fair random numbers using Solana's VRF system
                </p>

                <button
                    onClick={requestRandomness}
                    disabled={loading || !publicKey}
                    className={`
                        px-6 py-3 rounded-lg font-semibold text-lg
                        ${loading
                            ? 'bg-purple-500 cursor-not-allowed'
                            : 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800'}
                        transition-colors duration-200
                    `}
                >
                    {loading ? 'Generating...' : 'Generate Random Number'}
                </button>

                {error && (
                    <div className="mt-4 text-red-400 bg-red-900/20 rounded-lg p-3">
                        {error}
                    </div>
                )}

                {result !== null && (
                    <div className="mt-8">
                        <h3 className="text-xl font-semibold mb-2">Your Random Number:</h3>
                        <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                            {result}
                        </div>
                    </div>
                )}
            </div>

            <div className="border-t border-white/10 pt-6 mt-6">
                <h3 className="text-lg font-semibold mb-3">How it works:</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-300">
                    <li>Connect your wallet to get started</li>
                    <li>Click "Generate Random Number" to request randomness</li>
                    <li>The VRF system generates a verifiable random number</li>
                    <li>The result is stored on-chain and displayed here</li>
                </ol>
            </div>
        </div>
    );
};

export default VRFDemo; 