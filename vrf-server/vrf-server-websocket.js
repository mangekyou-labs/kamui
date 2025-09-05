#!/usr/bin/env node

/**
 * VRF Server Node.js implementation using Solana WebSocket logsSubscribe
 * This server monitors VRF request accounts by subscribing to program logs via WebSocket
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    SystemProgram,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const { deserializeUnchecked, serialize } = require("borsh");
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');
const nacl = require('tweetnacl');
const BN = require('bn.js');
const { performance } = require('perf_hooks');
const commander = require('commander');

// Setup simple console logging
const logger = {
    info: (message) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] ${message}`);
    },
    warn: (message) => {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] [WARN] ${message}`);
    },
    error: (message) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [ERROR] ${message}`);
    },
    debug: (message) => {
        const timestamp = new Date().toISOString();
        console.debug(`[${timestamp}] [DEBUG] ${message}`);
    }
};

// Constants for account identification
const REQUEST_DISCRIMINATOR = Buffer.from('REQUEST\0\0', 'utf-8');
const REQUEST_PENDING_STATUS = 0;

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

// Command line parsing
const program = new commander.Command();
program
    .option('--program-id <pubkey>', 'VRF Coordinator program ID', 'BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D')
    .option('--feepayer-keypair <path>', 'Path to fee payer keypair file', 'keypair.json')
    .option('--vrf-keypair <path>', 'Path to VRF keypair file', 'vrf-keypair.json')
    .option('--rpc-url <url>', 'Solana RPC URL', 'https://api.devnet.solana.com')
    .option('--ws-url <url>', 'Solana WebSocket URL (optional, defaults to WS version of RPC URL)')
    .option('--scan-interval <ms>', 'Backup scanning interval in milliseconds', 30000)
    .parse(process.argv);

const options = program.opts();

// Derive WebSocket URL from RPC URL if not provided
if (!options.wsUrl) {
    options.wsUrl = options.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

// VRF Server Class
class VRFServer {
    constructor(programId, feePayerKeypair, vrfKeypair, connectionConfig, scanInterval) {
        this.programId = new PublicKey(programId);
        this.feePayerKeypair = feePayerKeypair;
        this.vrfKeypair = vrfKeypair;
        this.scanInterval = scanInterval;

        this.rpcUrl = connectionConfig.rpcUrl;
        this.wsUrl = connectionConfig.wsUrl;

        this.connection = new Connection(this.rpcUrl, 'confirmed');
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second delay

        this.processedRequests = new Set();
        this.isScanning = false;
        this.isRunning = false;
    }

    // Start the server
    async start() {
        logger.info('Starting VRF Server with WebSocket logsSubscribe...');
        logger.info(`Program ID: ${this.programId.toBase58()}`);
        logger.info(`Fee Payer: ${this.feePayerKeypair.publicKey.toBase58()}`);
        logger.info(`VRF Account: ${this.vrfKeypair.publicKey.toBase58()}`);
        logger.info(`RPC URL: ${this.rpcUrl}`);
        logger.info(`WebSocket URL: ${this.wsUrl}`);
        logger.info(`Backup Scan Interval: ${this.scanInterval}ms`);

        // Check fee payer balance
        const balance = await this.connection.getBalance(this.feePayerKeypair.publicKey);
        logger.info(`Fee payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

        if (balance < 0.1 * LAMPORTS_PER_SOL) {
            logger.warn('Warning: Fee payer has less than 0.1 SOL. Fulfillment transactions may fail.');
        }

        this.isRunning = true;

        // Connect to WebSocket
        await this.connectWebSocket();

        // Start backup scanning loop
        this.startBackupScanningLoop();
    }

    // Connect to WebSocket and subscribe to program logs
    async connectWebSocket() {
        try {
            logger.info(`Connecting to WebSocket at ${this.wsUrl}...`);

            // Clean up existing WebSocket if it exists
            if (this.ws) {
                this.ws.terminate();
            }

            // Create new WebSocket connection
            this.ws = new WebSocket(this.wsUrl);

            // Setup event handlers
            this.ws.on('open', () => {
                logger.info('WebSocket connection established');
                this.subscribeToLogs();
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    if (message.result !== undefined) {
                        this.handleSubscriptionMessage(message);
                    } else if (message.method === 'logsNotification') {
                        this.handleLogsNotification(message.params);
                    }
                } catch (err) {
                    logger.error(`Error processing WebSocket message: ${err.message}`);
                }
            });

            this.ws.on('error', (err) => {
                logger.error(`WebSocket error: ${err.message}`);
            });

            this.ws.on('close', () => {
                logger.warn('WebSocket connection closed');
                this.attemptReconnect();
            });
        } catch (err) {
            logger.error(`Error connecting to WebSocket: ${err.message}`);
            this.attemptReconnect();
        }
    }

    // Attempt to reconnect with exponential backoff
    attemptReconnect() {
        if (!this.isRunning) return;

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);

            logger.info(`Attempting to reconnect in ${delay / 1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(async () => {
                await this.connectWebSocket();
            }, delay);
        } else {
            logger.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts. Please check your connection and restart the server.`);
        }
    }

    // Subscribe to program logs
    subscribeToLogs() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logger.error('Cannot subscribe: WebSocket is not connected');
            return;
        }

        const subscribeMsg = {
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [
                { mentions: [this.programId.toBase58()] },
                { commitment: 'confirmed' }
            ]
        };

        logger.info(`Subscribing to logs for program ${this.programId.toBase58()}`);
        this.ws.send(JSON.stringify(subscribeMsg));
    }

    // Handle subscription confirmation
    handleSubscriptionMessage(message) {
        if (message.result !== undefined) {
            logger.info(`Successfully subscribed to program logs: subscription id ${message.result}`);
        }
    }

    // Handle incoming log notifications
    handleLogsNotification(params) {
        if (!params || !params.result || !params.result.value) {
            return;
        }

        const { value } = params.result;

        // Check if this is a transaction with our program
        if (value.err || !value.signature) {
            return;
        }

        logger.debug(`Received log notification for transaction: ${value.signature}`);

        // Process the logs
        if (value.logs && value.logs.length > 0) {
            this.processLogs(value.signature, value.logs);
        }
    }

    // Process logs from a transaction
    async processLogs(signature, logs) {
        try {
            // Check if we've already processed this transaction
            if (this.processedRequests.has(signature)) {
                return;
            }

            // Add to processed list to avoid duplicate processing
            this.processedRequests.add(signature);

            // Trim processed requests list if it gets too large
            if (this.processedRequests.size > 10000) {
                const oldestEntries = Array.from(this.processedRequests).slice(0, 5000);
                oldestEntries.forEach(entry => this.processedRequests.delete(entry));
            }

            // Log for debugging
            logger.debug(`Processing logs for transaction ${signature}`);
            logs.forEach(log => logger.debug(`Log: ${log}`));

            // Look for RequestRandomness instruction
            const requestRandomnessIndex = logs.findIndex(log =>
                log.includes('Program log: Instruction: RequestRandomness')
            );

            if (requestRandomnessIndex === -1) {
                return;
            }

            logger.info(`Found RequestRandomness instruction in transaction ${signature}`);

            // Extract subscription ID and nonce from subsequent logs if available
            let subscriptionAccount = null;
            let nonce = null;

            for (let i = requestRandomnessIndex; i < logs.length; i++) {
                const log = logs[i];

                // Look for subscription account in logs
                if (log.includes('Program log: subscription:')) {
                    const match = log.match(/Program log: subscription: ([a-zA-Z0-9]+)/);
                    if (match && match[1]) {
                        subscriptionAccount = new PublicKey(match[1]);
                        logger.info(`Found subscription account: ${subscriptionAccount.toBase58()}`);
                    }
                }

                // Look for nonce in logs
                if (log.includes('Program log: nonce:')) {
                    const match = log.match(/Program log: nonce: (\d+)/);
                    if (match && match[1]) {
                        nonce = new BN(match[1]);
                        logger.info(`Found nonce: ${nonce.toString()}`);
                    }
                }
            }

            // If we found both subscription and nonce, check for the request account
            if (subscriptionAccount && nonce) {
                // Try to derive the request account
                await this.checkForDerivedRequestAccount(subscriptionAccount, nonce);
            }

            // If we couldn't find subscription and nonce in logs, get the transaction details
            if (!subscriptionAccount || !nonce) {
                logger.info(`Couldn't extract all request info from logs. Fetching transaction details...`);

                try {
                    const tx = await this.connection.getTransaction(signature, {
                        commitment: 'confirmed',
                        maxSupportedTransactionVersion: 0
                    });

                    if (tx && tx.meta && !tx.meta.err) {
                        // Scan accounts for REQUEST discriminator
                        await this.scanTransactionAccounts(tx);
                    }
                } catch (err) {
                    logger.error(`Error fetching transaction details: ${err.message}`);
                }
            }
        } catch (err) {
            logger.error(`Error processing logs: ${err.message}`);
        }
    }

    // Check for derived request account based on subscription and nonce
    async checkForDerivedRequestAccount(subscriptionAccount, nonce) {
        try {
            // Derive the expected request account address
            const seeds = [
                Buffer.from('REQUEST'),
                subscriptionAccount.toBuffer(),
                Buffer.from(nonce.toArray('le', 8))
            ];

            const [requestAccount] = await PublicKey.findProgramAddress(
                seeds,
                this.programId
            );

            logger.info(`Checking derived request account: ${requestAccount.toBase58()}`);

            // Check if the account exists and is pending
            await this.checkAndFulfillRequest(requestAccount);
        } catch (err) {
            logger.error(`Error checking derived request account: ${err.message}`);
        }
    }

    // Scan transaction accounts for request accounts
    async scanTransactionAccounts(transaction) {
        try {
            if (!transaction || !transaction.transaction || !transaction.transaction.message) {
                return;
            }

            const message = transaction.transaction.message;
            const accountKeys = message.accountKeys.map(key => new PublicKey(key));

            // Check each account that might be a request account
            for (let i = 0; i < accountKeys.length; i++) {
                const accountKey = accountKeys[i];

                // Skip program accounts and system accounts
                if (accountKey.equals(this.programId) ||
                    accountKey.equals(SystemProgram.programId)) {
                    continue;
                }

                await this.checkAndFulfillRequest(accountKey);
            }
        } catch (err) {
            logger.error(`Error scanning transaction accounts: ${err.message}`);
        }
    }

    // Start the backup scanning loop
    startBackupScanningLoop() {
        if (!this.isRunning) return;

        logger.info(`Starting backup scanning loop (interval: ${this.scanInterval}ms)`);

        const scanLoop = async () => {
            if (!this.isRunning) return;

            try {
                await this.scanPendingRequests();
            } catch (err) {
                logger.error(`Error in backup scanning loop: ${err.message}`);
            }

            // Schedule next scan
            setTimeout(scanLoop, this.scanInterval);
        };

        // Start the loop
        setTimeout(scanLoop, this.scanInterval);
    }

    // Scan for pending request accounts
    async scanPendingRequests() {
        if (this.isScanning) {
            logger.debug('Already scanning for pending requests');
            return;
        }

        this.isScanning = true;

        try {
            logger.info('Scanning for pending request accounts...');

            const startTime = performance.now();

            // Get all accounts owned by our program
            const accounts = await this.connection.getProgramAccounts(this.programId, {
                filters: [
                    { dataSize: 273 }, // Size of request account data
                    { memcmp: { offset: 0, bytes: bs58.encode(REQUEST_DISCRIMINATOR) } },
                    { memcmp: { offset: 8, bytes: bs58.encode(Buffer.from([REQUEST_PENDING_STATUS])) } }
                ]
            });

            const endTime = performance.now();
            logger.info(`Found ${accounts.length} pending request accounts (scan took ${(endTime - startTime).toFixed(2)}ms)`);

            // Process each pending request
            for (const account of accounts) {
                await this.checkAndFulfillRequest(account.pubkey);
            }
        } catch (err) {
            logger.error(`Error scanning pending requests: ${err.message}`);
        } finally {
            this.isScanning = false;
        }
    }

    // Check if an account is a pending request and fulfill it
    async checkAndFulfillRequest(accountPubkey) {
        try {
            // Skip if we've already seen this request
            const requestKey = accountPubkey.toBase58();
            if (this.processedRequests.has(requestKey)) {
                return;
            }

            logger.debug(`Checking account ${requestKey}`);

            // Get account data
            const accountInfo = await this.connection.getAccountInfo(accountPubkey);

            if (!accountInfo) {
                logger.debug(`Account ${requestKey} does not exist`);
                return;
            }

            // Check if this is a request account
            if (accountInfo.owner.equals(this.programId) &&
                accountInfo.data.length >= REQUEST_DISCRIMINATOR.length) {

                // Check discriminator
                const discriminator = accountInfo.data.slice(0, REQUEST_DISCRIMINATOR.length);
                if (!discriminator.equals(REQUEST_DISCRIMINATOR)) {
                    return;
                }

                // Check status (offset 8, length 1)
                const status = accountInfo.data[8];
                if (status !== REQUEST_PENDING_STATUS) {
                    logger.debug(`Request ${requestKey} is not pending (status: ${status})`);
                    return;
                }

                // This is a pending request - fulfill it
                logger.info(`Found pending request: ${requestKey}`);

                this.processedRequests.add(requestKey);

                // Fulfill the request
                await this.fulfillRequest(accountPubkey, accountInfo.data);
            }
        } catch (err) {
            logger.error(`Error checking/fulfilling request ${accountPubkey.toBase58()}: ${err.message}`);
        }
    }

    // Fulfill a request
    async fulfillRequest(requestAccount, requestData) {
        try {
            logger.info(`Fulfilling randomness request: ${requestAccount.toBase58()}`);

            // Extract requester account from request data (offset 9, length 32)
            const requesterAccount = new PublicKey(requestData.slice(9, 9 + 32));
            logger.info(`Requester account: ${requesterAccount.toBase58()}`);

            // Create proof and signature
            const seed = Buffer.from('kamui-vrf-seed', 'utf8');
            const preSeed = requestAccount.toBuffer();

            // Combine seed and preSeed
            const combinedSeed = Buffer.concat([seed, preSeed]);

            // Generate proof (signature of the combined seed)
            const proof = nacl.sign.detached(combinedSeed, this.vrfKeypair.secretKey);

            // Create the instruction
            const instruction = new TransactionInstruction({
                keys: [
                    { pubkey: this.feePayerKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: this.vrfKeypair.publicKey, isSigner: true, isWritable: false },
                    { pubkey: requestAccount, isSigner: false, isWritable: true },
                    { pubkey: requesterAccount, isSigner: false, isWritable: true }
                ],
                programId: this.programId,
                data: Buffer.concat([
                    Buffer.from([2]), // Instruction index for FulfillRandomness (corrected from 3 to 2)
                    Buffer.from(proof)
                ])
            });

            // Create and send the transaction
            const transaction = new Transaction().add(instruction);

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.feePayerKeypair.publicKey;

            // Sign the transaction
            transaction.sign(this.feePayerKeypair, this.vrfKeypair);

            // Send the transaction
            const startTime = performance.now();
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.feePayerKeypair, this.vrfKeypair],
                { commitment: 'confirmed' }
            );
            const endTime = performance.now();

            logger.info(`Fulfillment transaction sent: ${signature}`);
            logger.info(`Transaction took ${(endTime - startTime).toFixed(2)}ms to confirm`);

            return signature;
        } catch (err) {
            logger.error(`Error fulfilling request: ${err.message}`);

            // If we failed to fulfill due to a program error, log more details
            if (err.logs) {
                logger.error('Program logs:');
                err.logs.forEach(log => logger.error(log));
            }

            throw err;
        }
    }

    // Stop the server
    async stop() {
        logger.info('Stopping VRF server...');

        this.isRunning = false;

        // Close WebSocket connection
        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }

        logger.info('VRF server stopped');
    }
}

// Main function
async function main() {
    try {
        // Load keypairs - use __dirname instead of process.cwd()
        const feePayerKeypairPath = path.join(__dirname, options.feePayerKeypair);
        const vrfKeypairPath = path.join(__dirname, options.vrfKeypair);

        logger.info(`Loading fee payer keypair from: ${feePayerKeypairPath}`);
        logger.info(`Loading VRF keypair from: ${vrfKeypairPath}`);

        // Safely load keypairs with proper error handling
        let feePayerKeypair;
        try {
            const feePayerData = await fs.readFile(feePayerKeypairPath, 'utf-8');
            feePayerKeypair = Keypair.fromSecretKey(
                Buffer.from(JSON.parse(feePayerData))
            );
            logger.info(`Loaded fee payer keypair: ${feePayerKeypair.publicKey.toBase58()}`);
        } catch (err) {
            throw new Error(`Failed to load fee payer keypair: ${err.message}`);
        }

        let vrfKeypair;
        try {
            const vrfData = await fs.readFile(vrfKeypairPath, 'utf-8');
            vrfKeypair = Keypair.fromSecretKey(
                Buffer.from(JSON.parse(vrfData))
            );
            logger.info(`Loaded VRF keypair: ${vrfKeypair.publicKey.toBase58()}`);
        } catch (err) {
            // If loading fails, generate an ephemeral keypair
            logger.warn(`Could not load VRF keypair: ${err.message}. Generating ephemeral keypair.`);
            vrfKeypair = Keypair.generate();
            logger.info(`Generated ephemeral VRF keypair: ${vrfKeypair.publicKey.toBase58()}`);
        }

        // Create connection config
        const connectionConfig = {
            rpcUrl: options.rpcUrl,
            wsUrl: options.wsUrl
        };

        // Create and start the server
        const server = new VRFServer(
            options.programId,
            feePayerKeypair,
            vrfKeypair,
            connectionConfig,
            parseInt(options.scanInterval)
        );

        await server.start();

        // Handle process signals
        process.on('SIGINT', async () => {
            logger.info('Received SIGINT signal');
            await server.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM signal');
            await server.stop();
            process.exit(0);
        });
    } catch (err) {
        logger.error(`Fatal error: ${err.message}`);
        process.exit(1);
    }
}

// Run the main function
main().catch(err => {
    logger.error(`Unhandled error: ${err.message}`);
    process.exit(1);
}); 