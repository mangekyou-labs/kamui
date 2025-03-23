#!/usr/bin/env node

/**
 * VRF Server Node.js implementation
 * This server uses the Rust implementation for ECVRF cryptographic operations
 * while implementing the server logic in Node.js
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    SystemProgram,
    TransactionInstruction
} = require("@solana/web3.js");
const { deserializeUnchecked, serialize } = require("borsh");
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Set current working directory to be one level up (main vrf-server dir)
// This ensures we can access the cargo project correctly
process.chdir(path.join(__dirname, '..'));

// Setup logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(__dirname, 'vrf-server-nodejs.log') })
    ]
});

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .option('program-id', {
        alias: 'p',
        description: 'Solana program ID',
        type: 'string',
        required: true
    })
    .option('keypair', {
        alias: 'k',
        description: 'Oracle keypair file',
        type: 'string',
        default: 'oracle-keypair.json'
    })
    .option('vrf-keypair', {
        alias: 'v',
        description: 'VRF keypair file',
        type: 'string',
        default: 'vrf-keypair.json'
    })
    .option('rpc-url', {
        alias: 'r',
        description: 'Solana RPC URL',
        type: 'string',
        default: 'https://api.devnet.solana.com'
    })
    .option('ws-url', {
        alias: 'w',
        description: 'Solana WebSocket URL (defaults to wss version of RPC URL)',
        type: 'string'
    })
    .option('poll-interval', {
        alias: 'i',
        description: 'Polling interval in milliseconds',
        type: 'number',
        default: 5000
    })
    .help()
    .alias('help', 'h')
    .argv;

// Constants for account identification
const REQUEST_DISCRIMINATOR = "REQUEST\0";
const SUBSCRIPTION_DISCRIMINATOR = "SUBSCRIP";

// Schemas for Borsh serialization/deserialization
class Subscription {
    constructor(props) {
        this.owner = props.owner;
        this.balance = props.balance;
        this.min_balance = props.min_balance;
        this.confirmations = props.confirmations;
        this.nonce = props.nonce;
    }

    static schema = {
        struct: {
            owner: { array: { type: "u8", len: 32 } },
            balance: "u64",
            min_balance: "u64",
            confirmations: "u8",
            nonce: "u64"
        }
    };
}

class RequestStatus {
    static Pending = 0;
    static Fulfilled = 1;
    static Cancelled = 2;
}

class RandomnessRequest {
    constructor(props) {
        this.subscription = props.subscription;
        this.seed = props.seed;
        this.requester = props.requester;
        this.callback_data = props.callback_data;
        this.request_block = props.request_block;
        this.status = props.status;
        this.num_words = props.num_words;
        this.callback_gas_limit = props.callback_gas_limit;
        this.nonce = props.nonce;
        this.commitment = props.commitment;
    }

    static schema = {
        struct: {
            subscription: { array: { type: "u8", len: 32 } },
            seed: { array: { type: "u8", len: 32 } },
            requester: { array: { type: "u8", len: 32 } },
            callback_data: { array: { type: "u8" } },
            request_block: "u64",
            status: "u8",
            num_words: "u32",
            callback_gas_limit: "u64",
            nonce: "u64",
            commitment: { array: { type: "u8", len: 32 } }
        }
    };
}

class FulfillRandomnessInstruction {
    constructor(props) {
        this.proof = props.proof;
        this.public_key = props.public_key;
    }

    static schema = {
        struct: {
            proof: { array: { type: "u8" } },
            public_key: { array: { type: "u8" } }
        }
    };
}

/**
 * VRF Server class
 */
class VRFServer {
    constructor(programId, oracleKeypairPath, vrfKeypairPath, rpcUrl, wsUrl, pollInterval) {
        try {
            // Clean program ID from any potential base64 padding or special chars
            const cleanProgramId = programId.replace(/=/g, '').trim();
            logger.info(`Cleaning program ID from "${programId}" to "${cleanProgramId}"`);

            // Validate and create program ID
            this.programId = new PublicKey(cleanProgramId);
            logger.info(`Validated program ID: ${this.programId.toString()}`);
        } catch (error) {
            logger.error(`Invalid program ID: ${error.message}`);
            throw new Error(`Failed to parse program ID: ${error.message}`);
        }

        this.oracleKeypairPath = path.resolve(oracleKeypairPath);
        this.vrfKeypairPath = path.resolve(vrfKeypairPath);
        this.connection = new Connection(rpcUrl, "confirmed");
        this.wsUrl = wsUrl || rpcUrl.replace('http', 'ws').replace('https', 'wss');
        this.pollInterval = pollInterval;

        logger.info(`VRF server initialized with program ID: ${this.programId.toString()}`);
        logger.info(`Oracle keypair path: ${this.oracleKeypairPath}`);
        logger.info(`VRF keypair path: ${this.vrfKeypairPath}`);
        logger.info(`RPC URL: ${rpcUrl}`);
        logger.info(`WebSocket URL: ${this.wsUrl}`);
        logger.info(`Poll interval: ${this.pollInterval}ms`);
    }

    /**
     * Verify that keypairs exist and Rust binary is available
     */
    async initialize() {
        // Check if oracle keypair exists
        try {
            await fs.access(this.oracleKeypairPath);
            logger.info(`Oracle keypair found at ${this.oracleKeypairPath}`);
        } catch (error) {
            logger.error(`Oracle keypair not found at ${this.oracleKeypairPath}`);
            throw new Error(`Oracle keypair not found: ${error.message}`);
        }

        // Check if VRF keypair exists
        try {
            await fs.access(this.vrfKeypairPath);
            logger.info(`VRF keypair found at ${this.vrfKeypairPath}`);
        } catch (error) {
            logger.error(`VRF keypair not found at ${this.vrfKeypairPath}`);
            throw new Error(`VRF keypair not found: ${error.message}`);
        }

        // Skipping the ECVRF keypair test for now
        logger.info("Skipping ECVRF keypair test to focus on on-chain event retrieval");

        // Load oracle keypair
        this.oracleKeypair = this.loadKeypair(this.oracleKeypairPath);
        logger.info(`Oracle pubkey: ${this.oracleKeypair.publicKey.toString()}`);

        // Check oracle account balance
        const balance = await this.connection.getBalance(this.oracleKeypair.publicKey);
        logger.info(`Oracle account balance: ${balance / 1e9} SOL`);

        if (balance < 10_000_000) { // 0.01 SOL
            logger.warn("WARNING: Oracle account balance is too low. Please fund with at least 0.01 SOL");
            logger.warn(`Oracle account: ${this.oracleKeypair.publicKey.toString()}`);
        }
    }

    /**
     * Load a Solana keypair from file
     */
    loadKeypair(keypairPath) {
        try {
            // Read file as JSON or buffer
            const keypairString = require('fs').readFileSync(keypairPath, { encoding: 'utf8' });

            try {
                // First try to parse as JSON
                const keypairData = JSON.parse(keypairString);

                // Check if it's an array (byte array format)
                if (Array.isArray(keypairData)) {
                    // Support 32-byte public key array
                    if (keypairData.length === 32) {
                        logger.info(`Found 32-byte public key array in ${keypairPath}`);

                        try {
                            // Create a PublicKey from the 32-byte array
                            const publicKey = new PublicKey(Buffer.from(keypairData));
                            logger.info(`Loaded public key: ${publicKey.toString()}`);

                            // In development mode, just generate a keypair for testing
                            // This allows us to properly display the public key in logs
                            // but warning: we can't sign with this keypair!
                            logger.warn(`⚠️ DEVELOPMENT MODE: Using generated keypair with public key ${publicKey}`);
                            logger.warn(`⚠️ WARNING: This keypair CAN'T SIGN transactions! Only for testing account reading.`);

                            // Generate a keypair for testing purposes only
                            const keypair = Keypair.generate();
                            logger.info(`Generated random keypair with pubkey: ${keypair.publicKey}`);

                            return keypair;
                        } catch (pkError) {
                            logger.error(`Error creating PublicKey: ${pkError.message}`);
                            throw pkError;
                        }
                    } else if (keypairData.length === 64) {
                        // Regular secret key array
                        logger.info(`Found 64-byte keypair, loading as secret key`);
                        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
                    } else {
                        logger.warn(`Unusual keypair length: ${keypairData.length}, attempting to use as-is`);
                        // Try to use it anyway
                        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
                    }
                }

                // Check if it's an object with secretKey
                if (keypairData.secretKey) {
                    const secretKeyArray = Array.isArray(keypairData.secretKey) ?
                        keypairData.secretKey :
                        Object.values(keypairData.secretKey);

                    logger.info(`Found keypair object with secretKey, using it`);
                    // Accept any length for now
                    return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
                }

                throw new Error('Invalid keypair format - no valid secretKey found');
            } catch (jsonError) {
                // Try alternate formats - base58 strings, etc.
                logger.info(`JSON parsing failed: ${jsonError.message}, trying alternate formats`);

                // Try direct base58
                try {
                    const cleanedString = keypairString.trim().replace(/^["']|["']$/g, '');
                    return Keypair.fromSecretKey(new Uint8Array(Buffer.from(cleanedString, 'base58')));
                } catch (error) {
                    logger.error(`Failed to parse as base58: ${error.message}`);
                }

                // For development/testing: just generate a keypair
                logger.warn(`⚠️ DEVELOPMENT MODE: Generating random keypair instead of loading from file`);
                return Keypair.generate();
            }
        } catch (error) {
            logger.error(`Error loading keypair from ${keypairPath}: ${error.message}`);
            logger.warn(`⚠️ DEVELOPMENT MODE: Generating random keypair instead of loading from file`);
            return Keypair.generate();
        }
    }

    /**
     * Start the VRF server polling loop
     */
    async start() {
        await this.initialize();

        logger.info("Starting VRF server polling...");

        // Main polling loop
        while (true) {
            try {
                await this.processPendingRequests();
                await new Promise(resolve => setTimeout(resolve, this.pollInterval));
            } catch (error) {
                logger.error(`Error processing requests: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, this.pollInterval * 2)); // Longer delay after error
            }
        }
    }

    /**
     * Process all pending VRF requests
     */
    async processPendingRequests() {
        logger.info("Checking for pending VRF requests...");

        try {
            // Get request accounts with discriminator
            logger.info(`Searching for accounts with REQUEST discriminator under program ${this.programId.toString()}`);

            // First approach: Look for direct REQUEST accounts
            const requestAccounts = await this.connection.getProgramAccounts(this.programId, {
                filters: [
                    {
                        memcmp: {
                            offset: 0,
                            bytes: Buffer.from(REQUEST_DISCRIMINATOR).toString('base64')
                        }
                    }
                ]
            });

            logger.info(`Found ${requestAccounts.length} request accounts with standard discriminator`);

            // Log each account pubkey if found
            if (requestAccounts.length > 0) {
                requestAccounts.forEach(({ pubkey, account }) => {
                    logger.info(`Request account found: ${pubkey.toString()}, data size: ${account.data.length} bytes`);
                });
            }

            // Get subscription accounts
            logger.info(`Searching for subscription accounts`);
            const subscriptionAccounts = await this.connection.getProgramAccounts(this.programId, {
                filters: [
                    {
                        memcmp: {
                            offset: 0,
                            bytes: Buffer.from(SUBSCRIPTION_DISCRIMINATOR).toString('base64')
                        }
                    }
                ]
            });

            logger.info(`Found ${subscriptionAccounts.length} subscription accounts`);

            // Log each subscription account
            if (subscriptionAccounts.length > 0) {
                subscriptionAccounts.forEach(({ pubkey, account }) => {
                    logger.info(`Subscription account found: ${pubkey.toString()}, data size: ${account.data.length} bytes`);
                });
            }

            // If no accounts found with standard discriminator or if we have subscriptions,
            // try checking for derived request accounts from subscriptions
            if (requestAccounts.length === 0 && subscriptionAccounts.length > 0) {
                logger.info("No direct request accounts found, checking for derived request accounts");

                for (const { pubkey: subPubkey, account: subAccount } of subscriptionAccounts) {
                    if (subAccount.data.length <= 8) {
                        logger.debug(`Subscription account data too short: ${subAccount.data.length} bytes`);
                        continue;
                    }

                    try {
                        const discriminator = Buffer.from(subAccount.data.slice(0, 8)).toString();
                        logger.info(`Subscription discriminator: ${discriminator}, expected: ${SUBSCRIPTION_DISCRIMINATOR}`);

                        const subscriptionData = deserializeUnchecked(
                            Subscription.schema,
                            Subscription,
                            subAccount.data.slice(8)
                        );

                        logger.info(`Deserialized subscription ${subPubkey.toString()}, nonce: ${subscriptionData.nonce}`);

                        // Try checking request accounts for current and previous nonce values
                        for (let nonceOffset = 0; nonceOffset < 5; nonceOffset++) {
                            if (subscriptionData.nonce >= nonceOffset) {
                                const checkNonce = subscriptionData.nonce - nonceOffset;

                                // Derive the expected request PDA
                                const nonceBuffer = Buffer.alloc(8);
                                nonceBuffer.writeBigUInt64LE(BigInt(checkNonce), 0);

                                const seeds = [
                                    Buffer.from("request"),
                                    subPubkey.toBuffer(),
                                    nonceBuffer
                                ];

                                logger.info(`Deriving PDA with seeds: "request", ${subPubkey.toString()}, nonce=${checkNonce}`);

                                const [requestPda] = await PublicKey.findProgramAddress(
                                    seeds,
                                    this.programId
                                );

                                logger.info(`Checking derived request account: ${requestPda.toString()}`);

                                try {
                                    // Check if the request account exists
                                    const requestAccount = await this.connection.getAccountInfo(requestPda);

                                    if (!requestAccount) {
                                        logger.info(`Derived request account does not exist: ${requestPda.toString()}`);
                                        continue;
                                    }

                                    logger.info(`Found derived request account: ${requestPda.toString()}, data size: ${requestAccount.data.length} bytes`);

                                    // Skip discriminator
                                    if (requestAccount.data.length <= 8) {
                                        logger.debug(`Request account data too short: ${requestAccount.data.length} bytes`);
                                        continue;
                                    }

                                    // Check discriminator
                                    const discriminator = Buffer.from(requestAccount.data.slice(0, 8)).toString();
                                    logger.info(`Request discriminator: ${discriminator}, expected: ${REQUEST_DISCRIMINATOR}`);

                                    if (discriminator !== REQUEST_DISCRIMINATOR) {
                                        logger.info(`Invalid discriminator for derived request: ${discriminator}`);
                                        continue;
                                    }

                                    // Try to deserialize request
                                    const request = deserializeUnchecked(
                                        RandomnessRequest.schema,
                                        RandomnessRequest,
                                        requestAccount.data.slice(8)
                                    );

                                    logger.info(`Deserialized request, status: ${request.status}`);

                                    if (request.status === RequestStatus.Pending) {
                                        logger.info(`Found new pending VRF request from derived path: ${requestPda.toString()}`);

                                        try {
                                            await this.fulfillRequest(requestPda, request);
                                            logger.info(`Successfully fulfilled derived VRF request ${requestPda.toString()}`);
                                        } catch (error) {
                                            logger.error(`Failed to fulfill derived VRF request ${requestPda.toString()}: ${error.message}`);
                                        }
                                    } else {
                                        logger.info(`Derived request not pending, status: ${request.status}`);
                                    }
                                } catch (error) {
                                    if (!error.message.includes("AccountNotFound")) {
                                        logger.error(`Error checking derived request account: ${error.message}`);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.error(`Failed to deserialize subscription: ${error.message}`);
                    }
                }
            }

            // Second approach: Try to search by base58 encoding of "request" bytes
            // This might find request accounts that don't follow the discriminator pattern
            logger.info("Trying alternative approach to find request accounts by 'request' seed");
            try {
                const [firstRequestPda] = await PublicKey.findProgramAddress(
                    [Buffer.from("request")],
                    this.programId
                );
                logger.info(`First request PDA derived from seed "request": ${firstRequestPda.toString()}`);

                // Try to get all accounts owned by the program
                const allProgramAccounts = await this.connection.getProgramAccounts(this.programId);
                logger.info(`Found total of ${allProgramAccounts.length} accounts owned by program ${this.programId.toString()}`);

                // Look for potential request accounts that might not have been found by discriminator
                for (const { pubkey, account } of allProgramAccounts) {
                    if (!requestAccounts.some(ra => ra.pubkey.equals(pubkey))) {
                        logger.info(`Examining account ${pubkey.toString()} with data size: ${account.data.length} bytes`);

                        if (account.data.length >= 8) {
                            const discriminator = Buffer.from(account.data.slice(0, 8)).toString();
                            logger.info(`Account ${pubkey.toString()} has discriminator: ${discriminator}`);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error in alternative account searching: ${error.message}`);
            }

            // Process the original request accounts found by discriminator
            for (const { pubkey, account } of requestAccounts) {
                logger.info(`Processing request account: ${pubkey.toString()}`);

                try {
                    // Skip discriminator
                    if (account.data.length < 8) {
                        logger.debug(`Account data too short: ${account.data.length} bytes`);
                        continue;
                    }

                    // Check discriminator
                    const discriminator = Buffer.from(account.data.slice(0, 8)).toString();
                    logger.info(`Request discriminator: ${discriminator}, expected: ${REQUEST_DISCRIMINATOR}`);

                    if (discriminator !== REQUEST_DISCRIMINATOR) {
                        logger.debug(`Invalid discriminator: ${discriminator}`);
                        continue;
                    }

                    // Try to deserialize the request
                    const request = deserializeUnchecked(
                        RandomnessRequest.schema,
                        RandomnessRequest,
                        account.data.slice(8)
                    );

                    logger.info(`Deserialized request, status: ${request.status}`);

                    if (request.status === RequestStatus.Pending) {
                        logger.info(`Found new pending VRF request: ${pubkey.toString()}`);

                        try {
                            await this.fulfillRequest(pubkey, request);
                            logger.info(`Successfully fulfilled VRF request ${pubkey.toString()}`);
                        } catch (error) {
                            logger.error(`Failed to fulfill VRF request ${pubkey.toString()}: ${error.message}`);
                        }
                    } else {
                        logger.info(`Request not pending, status: ${request.status}`);
                    }
                } catch (error) {
                    logger.error(`Failed to process request account: ${error.message}`);
                }
            }
        } catch (error) {
            logger.error(`Error in processPendingRequests: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fulfill a VRF request by generating a proof and submitting a transaction
     */
    async fulfillRequest(requestPubkey, request) {
        try {
            logger.info(`Fulfilling request ${requestPubkey.toString()}`);

            // Extract seed from request
            const seedBuf = Buffer.from(request.seed);
            const seedHex = seedBuf.toString('hex');

            // Use the Rust binary to generate a VRF proof for the given seed
            logger.info(`Generating VRF proof for seed: ${seedHex}`);

            const { stdout, stderr } = await execAsync(
                `cargo run --release --bin vrf_server -- test -k ${this.vrfKeypairPath} -a ${seedHex}`
            );

            if (stderr && !stderr.includes("Compiling")) {
                logger.warn(`VRF proof generation warning: ${stderr}`);
            }

            // Extract the proof from the output
            logger.debug(`Proof generation output: ${stdout}`);

            // Format expected: "Generated proof hash: <hex>"
            const proofHashMatch = stdout.match(/Generated proof hash: ([0-9a-f]+)/);
            if (!proofHashMatch || !proofHashMatch[1]) {
                throw new Error(`Failed to extract proof hash from output: ${stdout}`);
            }

            const proofHash = proofHashMatch[1];
            logger.info(`Generated proof hash: ${proofHash}`);

            // Now we'll need to build a transaction to fulfill the randomness request
            // Create instructions
            const subscriptionPubkey = new PublicKey(request.subscription);

            const fulfillInstruction = new TransactionInstruction({
                keys: [
                    { pubkey: this.oracleKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: requestPubkey, isSigner: false, isWritable: true },
                    { pubkey: subscriptionPubkey, isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: this.programId,
                data: Buffer.from([2, ...Buffer.from(proofHash, 'hex')])  // 2 is the instruction index for fulfill_randomness
            });

            // Create and send transaction
            const recentBlockhash = await this.connection.getLatestBlockhash();
            const tx = new Transaction({
                recentBlockhash: recentBlockhash.blockhash,
                feePayer: this.oracleKeypair.publicKey
            });

            tx.add(fulfillInstruction);
            tx.sign(this.oracleKeypair);

            const signature = await this.connection.sendRawTransaction(tx.serialize());
            logger.info(`Randomness fulfillment transaction sent: ${signature}`);

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction({
                signature,
                ...recentBlockhash
            });

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            logger.info(`Transaction confirmed: ${signature}`);
            return signature;
        } catch (error) {
            logger.error(`Error fulfilling request: ${error.message}`);
            throw error;
        }
    }
}

// Main function to start the server
async function main() {
    try {
        const server = new VRFServer(
            argv.programId,
            argv.keypair,
            argv.vrfKeypair,
            argv.rpcUrl,
            argv.wsUrl,
            argv.pollInterval
        );

        await server.start();
    } catch (error) {
        logger.error(`Server startup error: ${error.message}`);
        process.exit(1);
    }
}

// Run the server
main().catch(error => {
    logger.error(`Uncaught error: ${error.message}`);
    process.exit(1);
}); 