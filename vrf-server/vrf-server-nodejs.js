#!/usr/bin/env node

/**
 * VRF Server Node.js implementation using polling
 * This server monitors VRF request accounts by polling for transactions and processing them
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
const bs58 = require('bs58');
const nacl = require('tweetnacl');

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
    .option('feepayer-keypair', {
        alias: 'f',
        description: 'feePayer keypair file',
        type: 'string',
        default: 'keypair.json'
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
    .option('poll-interval', {
        alias: 'i',
        description: 'Polling interval in milliseconds',
        type: 'number',
        default: 5000
    })
    .option('transaction-limit', {
        alias: 't',
        description: 'Number of recent transactions to check per poll',
        type: 'number',
        default: 20
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
 * Deserialize account data using Borsh
 */
function deserializeAccount(schema, classType, data) {
    // Skip discriminator (first 8 bytes)
    const accountData = data.slice(8);

    // Use the serialize function to help deserialize
    const buffer = Buffer.from(accountData);

    // Create empty instance
    const instance = new classType({});

    // Get property names from schema
    const structFields = schema.struct;
    let offset = 0;

    // Manually deserialize each field
    for (const [fieldName, fieldSchema] of Object.entries(structFields)) {
        // Simple types
        if (fieldSchema === 'u8') {
            instance[fieldName] = buffer.readUInt8(offset);
            offset += 1;
        } else if (fieldSchema === 'u32') {
            instance[fieldName] = buffer.readUInt32LE(offset);
            offset += 4;
        } else if (fieldSchema === 'u64') {
            // Read as BigInt
            instance[fieldName] = buffer.readBigUInt64LE(offset);
            offset += 8;
        } else if (typeof fieldSchema === 'object' && fieldSchema.array) {
            // Handle arrays (bytes arrays or public keys)
            if (fieldSchema.array.type === 'u8') {
                if (fieldSchema.array.len) {
                    // Fixed length array
                    instance[fieldName] = Array.from(buffer.slice(offset, offset + fieldSchema.array.len));
                    offset += fieldSchema.array.len;
                } else {
                    // Variable length array
                    const length = buffer.readUInt32LE(offset);
                    offset += 4;
                    instance[fieldName] = Array.from(buffer.slice(offset, offset + length));
                    offset += length;
                }
            }
        }
    }

    return instance;
}

/**
 * VRF Server class
 */
class VRFServer {
    constructor(programId, feePayerKeypairPath, vrfKeypairPath, rpcUrl, pollInterval = 5000, transactionLimit = 20) {
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

        this.feePayerKeypairPath = feePayerKeypairPath;
        this.vrfKeypairPath = vrfKeypairPath;
        this.rpcUrl = rpcUrl;
        this.pollInterval = pollInterval;
        this.transactionLimit = transactionLimit;
        this.connection = new Connection(rpcUrl, "confirmed");
        this.lastCheckedSignature = null;
        this.feePayerKeypair = null;
        this.vrfPublicKey = null;
        this.processedSignatures = new Set();
        this.isPolling = false;
        this.lastPollTime = 0;

        logger.info(`VRF server initialized with program ID: ${this.programId.toString()}`);
        logger.info(`feePayer keypair path: ${this.feePayerKeypairPath}`);
        logger.info(`VRF keypair path: ${this.vrfKeypairPath}`);
        logger.info(`RPC URL: ${this.rpcUrl}`);
        logger.info(`Poll interval: ${this.pollInterval}ms`);
        logger.info(`Transaction limit: ${this.transactionLimit}`);
    }

    /**
     * Initialize the VRF server
     */
    async initialize() {
        logger.info("Initializing VRF server...");

        try {
            // Look for keypair in the vrf-server directory
            const feePayerKeypairPath = path.resolve(__dirname, this.feePayerKeypairPath);
            logger.info(`Loading feePayer keypair from ${feePayerKeypairPath}...`);
            this.feePayerKeypair = await this.loadKeypair(feePayerKeypairPath);
            logger.info(`feePayer public key: ${this.feePayerKeypair.publicKey.toString()}`);

            // Try to load VRF keypair, or generate a new one for testing
            const vrfKeypairPath = path.resolve(__dirname, this.vrfKeypairPath);
            logger.info(`Loading VRF keypair from ${vrfKeypairPath}...`);

            try {
                // First try to load the VRF keypair
                this.vrfKeypair = await this.loadKeypair(vrfKeypairPath);
                logger.info(`Successfully loaded VRF keypair from file`);
            } catch (error) {
                // If loading fails, generate a new keypair for testing
                logger.warn(`Could not load VRF keypair: ${error.message}`);
                logger.warn(`Generating ephemeral VRF keypair for testing`);
                this.vrfKeypair = Keypair.generate();
            }

            this.vrfPublicKey = this.vrfKeypair.publicKey.toString();
            logger.info(`VRF public key: ${this.vrfPublicKey}`);

            // Check feePayer account SOL balance
            const feePayerBalance = await this.connection.getBalance(this.feePayerKeypair.publicKey);
            logger.info(`feePayer account balance: ${feePayerBalance / 10 ** 9} SOL`);

            if (feePayerBalance < 1000000) { // Less than 0.001 SOL
                logger.warn(`WARNING: feePayer account balance is very low (${feePayerBalance / 10 ** 9} SOL)`);
            }
        } catch (error) {
            logger.error(`Initialization error: ${error.message}`);
            throw error;
        }

        logger.info("VRF server initialized successfully");
    }

    /**
     * Load a Solana keypair from file
     */
    async loadKeypair(keypairPath) {
        try {
            logger.info(`Loading keypair from ${keypairPath}...`);
            const keypairJson = await fs.readFile(keypairPath, 'utf8');
            const keypairData = JSON.parse(keypairJson);

            if (Array.isArray(keypairData)) {
                // Handle array format (bytes)
                return Keypair.fromSecretKey(Uint8Array.from(keypairData));
            } else if (keypairData.secretKey) {
                // Handle { secretKey: "base58 encoded string" } format
                const secretKeyBase58 = keypairData.secretKey;
                return Keypair.fromSecretKey(bs58.decode(secretKeyBase58));
            } else if (keypairData.private_key) {
                // Handle { private_key: "base58 encoded string" } format (some wallets use this)
                const privateKeyBase58 = keypairData.private_key;
                return Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
            } else {
                throw new Error(`Unsupported keypair format in ${keypairPath}`);
            }
        } catch (error) {
            logger.error(`Failed to load keypair from ${keypairPath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Start the VRF server polling
     */
    async start() {
        await this.initialize();
        logger.info("Starting VRF server with polling...");
        this.startPollingLoop();
    }

    /**
     * Start the main polling loop
     */
    async startPollingLoop() {
        logger.info("Starting main polling loop");

        // Main polling loop
        while (true) {
            try {
                await this.pollForTransactions();
                await this.scanPendingRequests();
                await new Promise(resolve => setTimeout(resolve, this.pollInterval));
            } catch (error) {
                logger.error(`Error in polling loop: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, this.pollInterval * 2));
            }
        }
    }

    /**
     * Poll for recent transactions involving the program
     */
    async pollForTransactions() {
        logger.info("Polling for recent transactions...");

        try {
            // Get recent signatures related to our program
            const signatures = await this.connection.getSignaturesForAddress(
                this.programId,
                {
                    limit: this.transactionLimit,
                    before: this.lastCheckedSignature
                }
            );

            if (signatures.length === 0) {
                logger.info("No new transactions found");
                return;
            }

            logger.info(`Found ${signatures.length} recent transactions`);

            // Update the last processed signature for next poll
            if (signatures.length > 0) {
                this.lastCheckedSignature = signatures[0].signature;
            }

            // Process each transaction
            for (const { signature } of signatures) {
                try {
                    // Get transaction details
                    const tx = await this.connection.getTransaction(signature, {
                        commitment: "confirmed",
                        maxSupportedTransactionVersion: 0
                    });

                    if (!tx || !tx.meta || !tx.meta.logMessages) {
                        logger.debug(`Skipping transaction ${signature} - No logs available`);
                        continue;
                    }

                    // Process the transaction
                    await this.processTransaction(signature, tx);
                } catch (error) {
                    logger.error(`Error processing transaction ${signature}: ${error.message}`);
                }
            }
        } catch (error) {
            logger.error(`Error polling for transactions: ${error.message}`);
        }
    }

    /**
     * Process a transaction to check for VRF requests
     */
    async processTransaction(signature, transaction) {
        // Extract logs to check for requests
        const logs = transaction.meta.logMessages || [];

        logger.info(`Processing transaction: ${signature}`);

        // Log all log messages for debugging
        logs.forEach(log => {
            logger.debug(`Log: ${log}`);
        });

        // Look specifically for logs indicating a RequestRandomness instruction
        const isRequestRandomness = logs.some(log =>
            log.includes("VRF Coordinator: RequestRandomness") ||
            log.includes("Program log: Instruction: RequestRandomness")
        );

        if (isRequestRandomness) {
            logger.info(`Found RequestRandomness transaction ${signature}`);

            // Extract request information from logs if possible
            let requestInfo = this.extractRequestInfoFromLogs(logs);

            // Find the request account from the transaction accounts
            const accountKeys = transaction.transaction.message.accountKeys.map(ak => ak.pubkey);

            logger.info(`Transaction contains ${accountKeys.length} accounts`);

            // Identify the likely request account (typically the 2nd account in RequestRandomness instruction)
            // This pattern must be adapted based on your specific program implementation
            for (let i = 0; i < accountKeys.length; i++) {
                const accountKey = accountKeys[i];
                const pubkey = new PublicKey(accountKey);

                logger.info(`Checking account ${i}: ${pubkey.toString()}`);

                try {
                    // Get account info
                    const accountInfo = await this.connection.getAccountInfo(pubkey);

                    if (!accountInfo) {
                        logger.debug(`Account ${pubkey.toString()} not found`);
                        continue;
                    }

                    if (!accountInfo.owner.equals(this.programId)) {
                        logger.debug(`Account ${pubkey.toString()} not owned by our program`);
                        continue;
                    }

                    const discriminator = accountInfo.data.length >= 8 ?
                        Buffer.from(accountInfo.data.slice(0, 8)).toString() :
                        "unknown";

                    logger.info(`Account ${pubkey.toString()} - owner: ${accountInfo.owner.toString()}, data length: ${accountInfo.data.length}, discriminator: ${discriminator}`);

                    // Check if this is a request account by structure or discriminator
                    const isPotentialRequest =
                        (discriminator === REQUEST_DISCRIMINATOR) ||
                        (accountInfo.data.length >= 8 && accountInfo.data[0] === 82 && accountInfo.data[1] === 69 && accountInfo.data[2] === 81); // "REQ"

                    if (isPotentialRequest) {
                        logger.info(`Found potential request account: ${pubkey.toString()}`);

                        try {
                            // Try to deserialize as request
                            const request = deserializeAccount(
                                RandomnessRequest.schema,
                                RandomnessRequest,
                                accountInfo.data
                            );

                            // Verify this is a pending request
                            if (request.status === RequestStatus.Pending) {
                                logger.info(`Processing pending request: ${pubkey.toString()}`);
                                await this.fulfillRequest(pubkey, request);
                            } else {
                                logger.info(`Request ${pubkey.toString()} is not pending (status: ${request.status})`);
                            }
                        } catch (error) {
                            logger.error(`Error processing potential request account ${pubkey.toString()}: ${error.message}`);
                        }
                    }
                } catch (error) {
                    logger.error(`Error checking account ${accountKey}: ${error.message}`);
                }
            }

            // If we've identified a subscription from logs, try to check for derived request accounts
            if (requestInfo.subscriptionPubkey) {
                logger.info(`Checking for derived request account from subscription: ${requestInfo.subscriptionPubkey}`);
                await this.checkDerivedRequest(requestInfo.subscriptionPubkey, requestInfo.nonce);
            }
        }
    }

    /**
     * Extract request information from transaction logs
     */
    extractRequestInfoFromLogs(logs) {
        const info = {
            seed: null,
            subscriptionPubkey: null,
            requesterPubkey: null,
            nonce: null
        };

        // Extract information from logs
        for (const log of logs) {
            // Match subscription account
            const subscriptionMatch = log.match(/Subscription account: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
            if (subscriptionMatch && subscriptionMatch[1]) {
                info.subscriptionPubkey = subscriptionMatch[1];
            }

            // Match request details
            const requestDetailsMatch = log.match(/RequestRandomness - seed: ([^,]+), num_words: (\d+)/);
            if (requestDetailsMatch && requestDetailsMatch[1]) {
                info.seed = requestDetailsMatch[1];
            }

            // Match nonce information
            const nonceMatch = log.match(/nonce: (\d+)/);
            if (nonceMatch && nonceMatch[1]) {
                info.nonce = parseInt(nonceMatch[1], 10);
            }
        }

        return info;
    }

    /**
     * Check for a derived request account based on subscription and nonce
     */
    async checkDerivedRequest(subscriptionPubkey, nonce) {
        try {
            const subscriptionPubkeyObj = new PublicKey(subscriptionPubkey);

            // Try with current and previous nonce values
            const nonceToCheck = nonce !== null ? nonce : 0;

            for (let i = 0; i <= 3; i++) {
                if (nonceToCheck >= i) {
                    const checkNonce = nonceToCheck - i;

                    logger.info(`Checking for request with subscription: ${subscriptionPubkey}, nonce: ${checkNonce}`);

                    // Derive the expected request PDA
                    const nonceBuffer = Buffer.alloc(8);
                    nonceBuffer.writeBigUInt64LE(BigInt(checkNonce), 0);

                    const [requestPda] = PublicKey.findProgramAddressSync(
                        [
                            Buffer.from("request"),
                            subscriptionPubkeyObj.toBuffer(),
                            nonceBuffer
                        ],
                        this.programId
                    );

                    logger.info(`Checking derived request account: ${requestPda.toString()}`);

                    try {
                        // Check if the account exists
                        const accountInfo = await this.connection.getAccountInfo(requestPda);

                        if (!accountInfo) {
                            logger.info(`Derived request account does not exist: ${requestPda.toString()}`);
                            continue;
                        }

                        logger.info(`Found derived request account: ${requestPda.toString()}`);

                        // Verify discriminator
                        if (accountInfo.data.length >= 8) {
                            const discriminator = Buffer.from(accountInfo.data.slice(0, 8)).toString();
                            logger.info(`Discriminator: ${discriminator}`);

                            if (discriminator === REQUEST_DISCRIMINATOR) {
                                try {
                                    // Try to deserialize the request
                                    const request = deserializeAccount(
                                        RandomnessRequest.schema,
                                        RandomnessRequest,
                                        accountInfo.data
                                    );

                                    // Process if pending
                                    if (request.status === RequestStatus.Pending) {
                                        logger.info(`Processing derived pending request: ${requestPda.toString()}`);
                                        await this.fulfillRequest(requestPda, request);
                                    } else {
                                        logger.info(`Derived request not pending, status: ${request.status}`);
                                    }
                                } catch (error) {
                                    logger.error(`Error processing derived request: ${error.message}`);
                                }
                            }
                        }
                    } catch (error) {
                        logger.debug(`Error checking derived request account: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error checking derived request: ${error.message}`);
        }
    }

    /**
     * Scan for any pending request accounts using getProgramAccounts
     * This is a backup method to ensure we don't miss any requests
     */
    async scanPendingRequests() {
        logger.debug("Scanning for pending request accounts...");

        try {
            // Get all accounts owned by our program with REQUEST discriminator
            const requestAccounts = await this.connection.getProgramAccounts(
                this.programId,
                {
                    filters: [
                        {
                            memcmp: {
                                offset: 0,
                                bytes: bs58.encode(Buffer.from(REQUEST_DISCRIMINATOR))
                            }
                        }
                    ]
                }
            );

            if (requestAccounts.length > 0) {
                logger.info(`Found ${requestAccounts.length} request accounts`);

                for (const { pubkey, account } of requestAccounts) {
                    try {
                        // Deserialize the request
                        const request = deserializeAccount(
                            RandomnessRequest.schema,
                            RandomnessRequest,
                            account.data
                        );

                        // If the request is pending, fulfill it
                        if (request.status === RequestStatus.Pending) {
                            logger.info(`Processing pending request from scan: ${pubkey.toString()}`);
                            await this.fulfillRequest(pubkey, request);
                        }
                    } catch (error) {
                        logger.error(`Error processing request account ${pubkey.toString()}: ${error.message}`);
                    }
                }
            } else {
                logger.debug("No pending request accounts found");
            }
        } catch (error) {
            logger.error(`Error scanning for pending requests: ${error.message}`);
        }
    }

    /**
     * Fulfill a VRF request by generating a proof and submitting a transaction
     */
    async fulfillRequest(requestPubkey, request) {
        logger.info(`Fulfilling request ${requestPubkey.toString()}`);
        logger.info(`Request details: requester=${new PublicKey(request.requester).toString()}, subscription=${new PublicKey(request.subscription).toString()}`);

        try {
            // We'll use a simplified approach to generate randomness directly
            // In a production environment, you should use proper VRF implementation
            const seed = Buffer.from(request.seed);
            logger.info(`Request seed: ${Buffer.from(request.seed).toString('hex')}`);

            // Create a deterministic "proof" by signing the seed with the VRF keypair
            // This is simplified and not a true VRF implementation
            const message = Buffer.concat([
                Buffer.from('vrf-proof'),
                seed,
                Buffer.from(this.vrfKeypair.publicKey.toBytes())
            ]);

            // Sign the message
            const signature = nacl.sign.detached(message, this.vrfKeypair.secretKey);
            const proof = Buffer.from(signature);
            logger.info(`Generated proof: ${proof.toString('hex').substring(0, 32)}...`);

            // Use the signature as pseudorandom output
            // In a production environment, this should be processed through proper VRF output generation
            const proofBytes = proof;
            const publicKeyBytes = this.vrfKeypair.publicKey.toBuffer();

            // Create the fulfill randomness instruction data
            const fulfillIxData = serialize(
                FulfillRandomnessInstruction.schema,
                new FulfillRandomnessInstruction({
                    proof: Array.from(proofBytes),
                    public_key: Array.from(publicKeyBytes)
                })
            );

            // Derive VRF result PDA
            const requesterPubkey = new PublicKey(request.requester);
            const [vrfResultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("vrf_result"), requesterPubkey.toBuffer()],
                this.programId
            );
            logger.info(`VRF result PDA: ${vrfResultPda.toString()}`);

            // Create the instruction
            const fulfillIx = new TransactionInstruction({
                keys: [
                    { pubkey: this.feePayerKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: requestPubkey, isSigner: false, isWritable: true },
                    { pubkey: vrfResultPda, isSigner: false, isWritable: true },
                    { pubkey: requesterPubkey, isSigner: false, isWritable: false },
                    { pubkey: new PublicKey(request.subscription), isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
                ],
                programId: this.programId,
                data: Buffer.concat([Buffer.from([2]), fulfillIxData]) // Prepend instruction discriminator
            });

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

            // Create and sign transaction
            const transaction = new Transaction().add(fulfillIx);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.feePayerKeypair.publicKey;

            // Sign the transaction
            transaction.sign(this.feePayerKeypair);

            // Send the transaction
            logger.info(`Sending fulfill transaction...`);
            const txid = await this.connection.sendRawTransaction(
                transaction.serialize(),
                { skipPreflight: false, preflightCommitment: "confirmed" }
            );

            logger.info(`Fulfill transaction sent: ${txid}`);

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(txid, "confirmed");
            logger.info(`Transaction confirmed: ${confirmation.value.err ? 'Error: ' + JSON.stringify(confirmation.value.err) : 'Success'}`);

            return txid;
        } catch (error) {
            logger.error(`Error fulfilling request ${requestPubkey.toString()}: ${error.message}`);
            throw error;
        }
    }
}

/**
 * Main function
 */
async function main() {
    try {
        logger.info("Starting VRF server...");

        // Create and initialize VRF server
        const vrfServer = new VRFServer(
            argv.programId,
            argv["feepayer-keypair"],
            argv["vrf-keypair"],
            argv.rpcUrl,
            argv.pollInterval,
            argv.transactionLimit
        );

        // Start the server
        await vrfServer.start();
    } catch (error) {
        logger.error(`Error starting VRF server: ${error.message}`);
        process.exit(1);
    }
}

// Start the server
main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
}); 