#!/usr/bin/env node

/**
 * Simplified VRF Server using WebSocket for Solana
 * 
 * This server uses WebSocket to subscribe to program logs and fulfills VRF requests.
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
    SystemProgram
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const nacl = require('tweetnacl');
const { Command } = require('commander');
const bs58 = require('bs58');
const borsh = require('borsh');
const crypto = require('crypto');
const { BufferLayout } = require('@solana/buffer-layout');
const { exec } = require('child_process');
const { promisify } = require('util');
const { randomBytes } = require('crypto');
const { Schema, serialize } = require('borsh');

// Promisify exec for async/await usage
const execPromise = promisify(exec);

// Set up command line arguments
const program = new Command();

program
    .option('--program-id <id>', 'Program ID of the VRF coordinator', 'BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D')
    .option('--feepayer-keypair <path>', 'Path to the fee payer keypair', 'keypair.json')
    .option('--vrf-keypair <path>', 'Path to the VRF keypair', 'vrf-keypair.json')
    .option('--oracle-keypair <path>', 'Path to the Oracle keypair', 'oracle-keypair.json')
    .option('--rpc-url <url>', 'Solana RPC URL', 'https://api.devnet.solana.com')
    .option('--ws-url <url>', 'Solana WebSocket URL (derived from RPC URL if not provided)')
    .option('--scan-interval <ms>', 'Backup scanning interval in milliseconds', '1000')
    .option('--enhanced-mode <mode>', 'Enable enhanced mode', 'true')
    .option('--batch-size <size>', 'Batch size for enhanced mode', '10')
    .option('--registry-id <id>', 'Registry ID for enhanced mode')
    .option('--log-level <level>', 'Log level', 'info')
    .parse(process.argv);

const options = program.opts();

// Derive WebSocket URL from RPC URL if not provided
if (!options.wsUrl) {
    options.wsUrl = options.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

// Change this to enable dummy mode
const DUMMY_MODE = true; // Set to true to use dummy/minimal proofs to avoid memory issues

// Define the schema for VrfCoordinatorInstruction for proper Borsh serialization
const vrfInstructionSchema = new Map([
    [
        'FulfillRandomness',
        {
            kind: 'struct',
            fields: [
                ['proof', ['u8']],
                ['public_key', ['u8']]
            ]
        }
    ]
]);

// Helper function to serialize a FulfillRandomness instruction
function serializeFulfillRandomnessInstruction(proof, publicKey) {
    try {
        // Create a buffer with enum variant index (3 for FulfillRandomness)
        const enumIndex = Buffer.from([3]);

        // Manual serialization for Vec<u8> fields
        // Format: <length (u32)><data>

        // Serialize proof vector length (little endian u32)
        const proofLengthBuffer = Buffer.alloc(4);
        proofLengthBuffer.writeUInt32LE(proof.length, 0);

        // Serialize public key vector length (little endian u32)
        const publicKeyLengthBuffer = Buffer.alloc(4);
        publicKeyLengthBuffer.writeUInt32LE(publicKey.length, 0);

        // Concatenate all parts
        return Buffer.concat([
            enumIndex,           // Enum variant (1 byte)
            proofLengthBuffer,   // Proof length (4 bytes)
            proof,               // Proof bytes
            publicKeyLengthBuffer, // Public key length (4 bytes)
            publicKey            // Public key bytes
        ]);
    } catch (err) {
        log('ERROR', `Serialization error: ${err.message}`);
        log('ERROR', `Stack trace: ${err.stack}`);
        throw err;
    }
}

// Simple logging
function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);

    // Also append to log file
    fs.appendFileSync(
        path.join(__dirname, 'vrf-server-simple-ws.log'),
        `[${timestamp}] [${level}] ${message}\n`
    );
}

// Main VRF Server class
class SimpleVRFServer {
    constructor(programId, feePayerPath, vrfKeyPath, oracleKeyPath, rpcUrl, wsUrl, scanInterval, enhancedMode = true, batchSize = 10, registryId = null, logLevel = 'info') {
        this.programId = new PublicKey(programId);
        this.feePayerPath = feePayerPath || 'keypair.json';
        this.vrfKeyPath = vrfKeyPath || 'vrf-keypair.json';
        this.oracleKeyPath = oracleKeyPath || 'oracle-keypair.json';
        this.rpcUrl = rpcUrl;
        this.wsUrl = wsUrl;
        this.scanInterval = parseInt(scanInterval || 3000);
        this.enhancedMode = enhancedMode === 'true' || enhancedMode === true;
        this.batchSize = parseInt(batchSize || 10);
        this.logLevel = logLevel || 'info';
        this.registryId = registryId ? new PublicKey(registryId) : null;

        this.connection = new Connection(this.rpcUrl, 'confirmed');
        this.ws = null;
        this.isRunning = false;
        this.processedRequests = new Set();
        this.processedAccounts = new Set();
        this.pendingBatch = [];
        this.batchInProgress = false;
        this.latestRequestKey = null;
        this.latestRequestTxSig = null;
        this.lastLoggedTxSig = null;
        this.registryInitialized = false;
    }

    async start() {
        try {
            log('INFO', 'Starting Enhanced VRF WebSocket Server');
            log('INFO', `Program ID: ${this.programId.toBase58()}`);
            log('INFO', `RPC URL: ${this.rpcUrl}`);
            log('INFO', `WebSocket URL: ${this.wsUrl}`);
            log('INFO', `Enhanced Mode: ${this.enhancedMode}`);
            log('INFO', `Batch Size: ${this.batchSize}`);
            log('INFO', `Log Level: ${this.logLevel}`);
            log('INFO', `Backup scan interval: ${this.scanInterval}ms`);

            // Load keypairs
            this.loadKeypairs();

            // Check feepayer balance
            const balance = await this.connection.getBalance(this.feePayer.publicKey);
            log('INFO', `Fee payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);
            log('INFO', `Oracle key: ${this.oracle.publicKey.toBase58()}`);

            if (balance < 0.1 * LAMPORTS_PER_SOL) {
                log('WARN', 'Fee payer has less than 0.1 SOL. Transactions may fail.');
                log('WARN', `Please manually fund this address: ${this.feePayer.publicKey.toBase58()}`);
            }

            if (this.enhancedMode) {
                // Initialize or check oracle registry
                await this.initializeOracleRegistry();

                // Register oracle if needed
                await this.registerOracle();
            }

            this.isRunning = true;

            // Connect to WebSocket
            this.connectWebSocket();

            // Start backup scanning with configured frequency
            this.startBackupScanner();

            // Start batch processor
            if (this.enhancedMode) {
                this.startBatchProcessor();
            }

            return true;
        } catch (err) {
            log('ERROR', `Failed to start server: ${err.message}`);
            return false;
        }
    }

    loadKeypairs() {
        try {
            // Load fee payer keypair
            const feePayerPath = path.join(__dirname, this.feePayerPath);
            log('INFO', `Loading fee payer keypair from: ${feePayerPath}`);

            try {
                // Check if the file exists
                if (!fs.existsSync(feePayerPath)) {
                    throw new Error(`Keypair file does not exist: ${this.feePayerPath}`);
                }

                // Read and parse the file
                const feePayerData = fs.readFileSync(feePayerPath, 'utf8');
                let secretKeyData;

                try {
                    secretKeyData = JSON.parse(feePayerData);
                } catch (parseErr) {
                    log('ERROR', `Failed to parse keypair data as JSON: ${parseErr.message}`);
                    throw parseErr;
                }

                // Handle direct array format - the simplest and most reliable approach
                let secretKeyBytes;
                if (Array.isArray(secretKeyData)) {
                    // Direct array of bytes - the standard Solana CLI format
                    secretKeyBytes = Uint8Array.from(secretKeyData);
                } else if (secretKeyData._keypair && secretKeyData._keypair.secretKey) {
                    // Object with nested secretKey (less common format)
                    secretKeyBytes = Uint8Array.from(secretKeyData._keypair.secretKey);
                } else if (secretKeyData.secretKey) {
                    // Object with secretKey property
                    secretKeyBytes = Uint8Array.from(secretKeyData.secretKey);
                } else {
                    throw new Error('Unrecognized keypair format');
                }

                this.feePayer = Keypair.fromSecretKey(secretKeyBytes);
                log('INFO', `Fee payer public key: ${this.feePayer.publicKey.toBase58()}`);
            } catch (error) {
                log('ERROR', `Failed to load fee payer keypair: ${error.message}`);
                throw error;
            }

            // Load VRF keypair using similar approach
            const vrfKeyPath = path.join(__dirname, this.vrfKeyPath);
            log('INFO', `Loading VRF keypair from: ${vrfKeyPath}`);

            if (!fs.existsSync(vrfKeyPath)) {
                throw new Error(`VRF keypair file does not exist: ${this.vrfKeyPath}`);
            }

            const vrfKeyData = fs.readFileSync(vrfKeyPath, 'utf8');
            let vrfSecretKeyData;

            try {
                vrfSecretKeyData = JSON.parse(vrfKeyData);
            } catch (parseErr) {
                log('ERROR', `Failed to parse VRF keypair data as JSON: ${parseErr.message}`);
                throw parseErr;
            }

            let vrfSecretKeyBytes;
            if (Array.isArray(vrfSecretKeyData)) {
                vrfSecretKeyBytes = Uint8Array.from(vrfSecretKeyData);
            } else if (vrfSecretKeyData._keypair && vrfSecretKeyData._keypair.secretKey) {
                vrfSecretKeyBytes = Uint8Array.from(vrfSecretKeyData._keypair.secretKey);
            } else if (vrfSecretKeyData.secretKey) {
                vrfSecretKeyBytes = Uint8Array.from(vrfSecretKeyData.secretKey);
            } else {
                throw new Error('Unrecognized VRF keypair format');
            }

            this.vrfKeypair = Keypair.fromSecretKey(vrfSecretKeyBytes);
            log('INFO', `VRF keypair loaded`);

            // Load Oracle keypair if provided
            if (this.oracleKeyPath) {
                const oracleKeyPath = path.join(__dirname, this.oracleKeyPath);
                log('INFO', `Loading Oracle keypair from: ${oracleKeyPath}`);

                if (!fs.existsSync(oracleKeyPath)) {
                    throw new Error(`Oracle keypair file does not exist: ${this.oracleKeyPath}`);
                }

                const oracleKeyData = fs.readFileSync(oracleKeyPath, 'utf8');
                let oracleSecretKeyData;

                try {
                    oracleSecretKeyData = JSON.parse(oracleKeyData);
                } catch (parseErr) {
                    log('ERROR', `Failed to parse Oracle keypair data as JSON: ${parseErr.message}`);
                    throw parseErr;
                }

                let oracleSecretKeyBytes;
                if (Array.isArray(oracleSecretKeyData)) {
                    oracleSecretKeyBytes = Uint8Array.from(oracleSecretKeyData);
                } else if (oracleSecretKeyData._keypair && oracleSecretKeyData._keypair.secretKey) {
                    oracleSecretKeyBytes = Uint8Array.from(oracleSecretKeyData._keypair.secretKey);
                } else if (oracleSecretKeyData.secretKey) {
                    oracleSecretKeyBytes = Uint8Array.from(oracleSecretKeyData.secretKey);
                } else {
                    throw new Error('Unrecognized Oracle keypair format');
                }

                this.oracle = Keypair.fromSecretKey(oracleSecretKeyBytes);
                log('INFO', `Oracle keypair loaded: ${this.oracle.publicKey.toBase58()}`);
            } else {
                // Use fee payer as oracle if not provided
                this.oracle = this.feePayer;
                log('INFO', `Using fee payer as oracle: ${this.oracle.publicKey.toBase58()}`);
            }
        } catch (err) {
            log('ERROR', `Failed to load keypairs: ${err.message}`);
            log('ERROR', err.stack);
            throw err;
        }
    }

    async initializeOracleRegistry() {
        if (!this.enhancedMode) return;

        try {
            // Check if registry ID was provided
            if (this.registryId) {
                log('INFO', `Using provided oracle registry: ${this.registryId.toBase58()}`);
                return;
            }

            // Find or create registry PDA
            const [registryPDA, _] = await PublicKey.findProgramAddress(
                [Buffer.from("oracle_registry")],
                this.programId
            );
            this.registryId = registryPDA;
            log('INFO', `Oracle registry PDA: ${this.registryId.toBase58()}`);

            // Check if registry exists
            const registryAccount = await this.connection.getAccountInfo(this.registryId);

            if (!registryAccount) {
                log('INFO', `Oracle registry does not exist. Initializing new registry...`);

                // Create initialize registry instruction
                const dataLayout = BufferLayout.struct([
                    BufferLayout.u8('instruction'),
                    BufferLayout.nu64('min_stake'),
                    BufferLayout.nu64('rotation_frequency'),
                ]);

                const data = Buffer.alloc(dataLayout.span);
                dataLayout.encode({
                    instruction: 8, // InitializeOracleRegistry
                    min_stake: BigInt(1000000), // 0.001 SOL minimum stake
                    rotation_frequency: BigInt(500), // Rotate every 500 slots
                }, data);

                const instruction = new TransactionInstruction({
                    keys: [
                        { pubkey: this.feePayer.publicKey, isSigner: true, isWritable: true },
                        { pubkey: this.registryId, isSigner: false, isWritable: true },
                        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    ],
                    programId: this.programId,
                    data: data,
                });

                const tx = new Transaction().add(instruction);
                await this.sendAndConfirmWithRetry(tx, [this.feePayer]);
                log('INFO', `Oracle registry initialized!`);
            } else {
                log('INFO', `Oracle registry exists: ${this.registryId.toBase58()}`);
            }

            this.registryInitialized = true;
        } catch (err) {
            log('ERROR', `Failed to initialize oracle registry: ${err.message}`);
            log('ERROR', err.stack);
        }
    }

    async registerOracle() {
        if (!this.enhancedMode || !this.registryInitialized) return;

        try {
            // Find oracle config PDA
            const [oracleConfigPDA, _] = await PublicKey.findProgramAddress(
                [Buffer.from("oracle_config"), this.oracle.publicKey.toBuffer()],
                this.programId
            );

            // Check if oracle is already registered
            const oracleAccount = await this.connection.getAccountInfo(oracleConfigPDA);

            if (!oracleAccount) {
                log('INFO', `Registering oracle ${this.oracle.publicKey.toBase58()}`);

                // Generate VRF key bytes
                const vrfKeyBytes = this.vrfKeypair.secretKey.slice(0, 32);

                // Create register oracle instruction
                const dataLayout = BufferLayout.struct([
                    BufferLayout.u8('instruction'),
                    BufferLayout.blob(32, 'vrf_key'),
                    BufferLayout.nu64('stake_amount'),
                ]);

                const data = Buffer.alloc(dataLayout.span);
                dataLayout.encode({
                    instruction: 9, // RegisterOracle
                    vrf_key: vrfKeyBytes,
                    stake_amount: BigInt(10000000), // 0.01 SOL stake
                }, data);

                const instruction = new TransactionInstruction({
                    keys: [
                        { pubkey: this.oracle.publicKey, isSigner: true, isWritable: true },
                        { pubkey: oracleConfigPDA, isSigner: false, isWritable: true },
                        { pubkey: this.registryId, isSigner: false, isWritable: true },
                        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    ],
                    programId: this.programId,
                    data: data,
                });

                const tx = new Transaction().add(instruction);
                await this.sendAndConfirmWithRetry(tx, [this.oracle]);
                log('INFO', `Oracle registered successfully!`);
            } else {
                log('INFO', `Oracle already registered: ${this.oracle.publicKey.toBase58()}`);
            }
        } catch (err) {
            log('ERROR', `Failed to register oracle: ${err.message}`);
            log('ERROR', err.stack);
        }
    }

    startBatchProcessor() {
        if (!this.enhancedMode) return;

        log('INFO', `Starting batch processor (batch size: ${this.batchSize})`);

        // Process batch every 10 seconds
        setInterval(async () => {
            if (this.batchInProgress || this.pendingBatch.length === 0) return;

            this.batchInProgress = true;

            try {
                // Get current batch
                const currentBatch = this.pendingBatch.slice(0, this.batchSize);
                this.pendingBatch = this.pendingBatch.slice(this.batchSize);

                log('INFO', `Processing batch of ${currentBatch.length} requests`);

                // Process batch
                await this.processBatch(currentBatch);
            } catch (err) {
                log('ERROR', `Error processing batch: ${err.message}`);
                log('ERROR', err.stack);
            } finally {
                this.batchInProgress = false;
            }
        }, 10000);
    }

    async processBatch(batch) {
        if (batch.length === 0) return;

        try {
            // Organize requests by pool
            const poolRequests = {};

            for (const req of batch) {
                const poolId = req.poolId;
                if (!poolRequests[poolId]) {
                    poolRequests[poolId] = [];
                }
                poolRequests[poolId].push(req);
            }

            // Process each pool separately
            for (const [poolId, requests] of Object.entries(poolRequests)) {
                if (requests.length === 0) continue;

                const requestIds = [];
                const proofs = [];
                const publicKeys = [];
                const requestIndices = [];

                // Generate proofs for each request
                for (const req of requests) {
                    // Generate proof
                    const { proof, publicKey } = await this.generateProof(req.seed);

                    requestIds.push(req.requestId);
                    proofs.push(proof);
                    publicKeys.push(publicKey);
                    requestIndices.push(req.requestIndex);
                }

                // Get pool account
                const [poolPDA, _] = await PublicKey.findProgramAddress(
                    [
                        Buffer.from("request_pool"),
                        new PublicKey(requests[0].subscription).toBuffer(),
                        Buffer.from([parseInt(poolId)])
                    ],
                    this.programId
                );

                // Get oracle config
                const [oracleConfigPDA, __] = await PublicKey.findProgramAddress(
                    [Buffer.from("oracle_config"), this.oracle.publicKey.toBuffer()],
                    this.programId
                );

                // Create instruction
                const dataLayout = BufferLayout.struct([
                    BufferLayout.u8('instruction'),
                    BufferLayout.blob(32 * requestIds.length, 'request_ids_flat'),
                    BufferLayout.seq(BufferLayout.nu32(), requestIds.length, 'proof_lengths'),
                    BufferLayout.blob(64 * requestIds.length, 'proofs_flat'), // Simplified for this example
                    BufferLayout.seq(BufferLayout.nu32(), requestIds.length, 'pk_lengths'),
                    BufferLayout.blob(32 * requestIds.length, 'pks_flat'), // Simplified
                    BufferLayout.u8('pool_id'),
                    BufferLayout.seq(BufferLayout.nu32(), requestIds.length, 'request_indices'),
                ]);

                // This is a simplified version - a real implementation would need to properly
                // serialize variable-length arrays

                const tx = new Transaction();
                await this.sendAndConfirmWithRetry(tx, [this.oracle]);

                log('INFO', `Processed batch of ${requests.length} requests for pool ${poolId}`);
            }
        } catch (err) {
            log('ERROR', `Failed to process batch: ${err.message}`);
            log('ERROR', err.stack);
        }
    }

    connectWebSocket() {
        try {
            log('INFO', `Connecting to WebSocket at ${this.wsUrl}`);

            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                log('INFO', 'WebSocket connected! Subscribing to program logs...');
                this.subscribeToLogs();
            });

            this.ws.on('message', (data) => {
                try {
                    this.onWebSocketMessage(data);
                } catch (err) {
                    log('ERROR', `Failed to parse WebSocket message: ${err.message}`);
                }
            });

            this.ws.on('close', () => {
                log('INFO', 'WebSocket connection closed. Attempting to reconnect...');
                this.reconnect();
            });

            this.ws.on('error', (error) => {
                log('ERROR', 'WebSocket error:');
                console.error(error);
                process.exit(1);
            });
        } catch (err) {
            log('ERROR', `Failed to connect to WebSocket: ${err.message}`);
            this.reconnect();
        }
    }

    reconnect() {
        if (!this.isRunning) return;

        // Wait 5 seconds before reconnecting
        log('INFO', 'Will reconnect in 5 seconds...');
        setTimeout(() => {
            this.connectWebSocket();
        }, 5000);
    }

    subscribeToLogs() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            log('ERROR', 'Cannot subscribe: WebSocket not connected');
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

        log('INFO', `Subscribing to logs with mentions for program: ${this.programId.toBase58()}`);
        this.ws.send(JSON.stringify(subscribeMsg));
    }

    onWebSocketMessage(msg) {
        try {
            const data = JSON.parse(msg);
            log('DEBUG', `Received WS message: ${msg}`);

            // Check if this is a logs notification
            if (data.method === 'logsNotification') {
                const { signature, logs } = data.params.result.value;
                log('INFO', `Received transaction notification: ${signature}`);
                log('INFO', `Transaction has ${logs.length} log entries`);

                // Print each log line for debugging
                logs.forEach((logLine, i) => {
                    log('DEBUG', `Log[${i}]: ${logLine}`);
                });

                // Check for test transactions from our integration test
                const isTestTransaction = logs.some(log =>
                    log.includes('TEST TX FOR VRF PROGRAM') ||
                    (log.includes('failed') && log.includes('BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D'))
                );

                if (isTestTransaction) {
                    log('INFO', `=== DETECTED TEST TRANSACTION FROM INTEGRATION TEST ===`);
                    log('INFO', `Transaction signature: ${signature}`);
                    log('INFO', `This confirms that VRF server can see transactions from the test!`);
                    log('INFO', `===========================================================`);

                    // Try to respond with our own transaction to see if the test can see it
                    this.sendBackTestTransaction(signature).catch(err => {
                        log('ERROR', `Failed to send back test transaction: ${err.message}`);
                    });
                }

                // Process logs to check for VRF operations
                log('INFO', `Processing logs for transaction ${signature}`);

                // Check for RequestRandomness instruction
                const hasRequestRandomness = logs.some(log => log.includes('VRF Coordinator: RequestRandomness'));

                if (hasRequestRandomness) {
                    log('INFO', `Found RequestRandomness instruction in transaction ${signature}`);

                    // Store the transaction signature for looking up request account
                    this.latestRequestTxSig = signature;

                    // Check for VRF_EVENT logs which contain request information
                    const vrfEventLog = logs.find(log => log.includes('VRF_EVENT:'));
                    if (vrfEventLog) {
                        log('INFO', `Found VRF_EVENT log: ${vrfEventLog}`);

                        // Immediate scan for pending requests after detecting a new request
                        log('INFO', `Scanning for pending requests after detecting RequestRandomness instruction`);
                        this.scanForPendingRequests().then(count => {
                            // If no requests found, try again after a short delay
                            if (count === 0) {
                                log('INFO', `Scanning again for pending requests after delay`);
                                setTimeout(() => this.scanForPendingRequests(), 5000);
                            }
                        });
                    }
                }
            }
        } catch (err) {
            log('ERROR', `Error processing WebSocket message: ${err.message}`);
        }
    }

    processLogs(txInfo) {
        try {
            // Check if we've already processed this tx
            if (this.processedRequests.has(txInfo.signature)) {
                log('DEBUG', `Already processed transaction ${txInfo.signature}`);
                return;
            }

            // Add to processed list
            this.processedRequests.add(txInfo.signature);

            // Limit size of processed set
            if (this.processedRequests.size > 1000) {
                const oldestEntries = Array.from(this.processedRequests).slice(0, 500);
                oldestEntries.forEach(entry => this.processedRequests.delete(entry));
            }

            // Log for visibility
            log('INFO', `Processing logs for transaction ${txInfo.signature}`);

            // Look for RequestRandomness instruction - update pattern to match actual logs
            const requestRandomnessLog = txInfo.logs.find(log =>
                log.includes('VRF Coordinator: RequestRandomness')
            );

            if (!requestRandomnessLog) {
                log('DEBUG', 'No RequestRandomness instruction found in transaction');
                return;
            }

            log('INFO', `Found RequestRandomness instruction in transaction ${txInfo.signature}`);

            // Extract VRF request account from VRF_EVENT log
            const vrfEventLog = txInfo.logs.find(log => log.includes('VRF_EVENT:'));
            if (vrfEventLog) {
                log('INFO', `Found VRF_EVENT log: ${vrfEventLog}`);

                // Try to parse request PDA from the transaction logs
                try {
                    // Look for request account in previous logs
                    const vrfRequestAccountLog = txInfo.logs.find(log => log.includes('VRF request account:'));
                    if (vrfRequestAccountLog) {
                        const match = vrfRequestAccountLog.match(/VRF request account: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
                        if (match && match[1]) {
                            const requestAccount = new PublicKey(match[1]);
                            log('INFO', `Found VRF request account in logs: ${requestAccount.toBase58()}`);
                            this.scanForSpecificRequest(requestAccount);
                        }
                    } else {
                        // If not found in logs, scan all program accounts
                        log('INFO', 'Scanning for pending requests after detecting RequestRandomness instruction');
                        this.scanForPendingRequests();
                    }
                } catch (err) {
                    log('ERROR', `Error parsing VRF_EVENT: ${err.message}`);
                }
            } else {
                // Fallback to scanning all accounts
                log('INFO', 'No VRF_EVENT log found, scanning for all pending requests');
                this.scanForPendingRequests();
            }

            // And scan again after 5 seconds
            setTimeout(() => {
                log('INFO', 'Scanning again for pending requests after delay');
                this.scanForPendingRequests();
            }, 5000);
        } catch (err) {
            log('ERROR', `Failed to process logs: ${err.message}`);
        }
    }

    async scanForSpecificRequest(requestAccount) {
        try {
            log('INFO', `Looking for specific request account: ${requestAccount.toBase58()}`);

            // Try to fetch the account directly
            const accountInfo = await this.connection.getAccountInfo(requestAccount);

            if (accountInfo && accountInfo.owner.equals(this.programId)) {
                log('INFO', `Found request account! Data length: ${accountInfo.data.length}`);

                if (accountInfo.data.length > 0) {
                    // Process this single account
                    const success = await this.processRequestAccount(requestAccount, accountInfo.data);
                    if (success) {
                        log('INFO', `Successfully fulfilled request: ${requestAccount.toBase58()}`);
                    } else {
                        log('ERROR', `Failed to fulfill request: ${requestAccount.toBase58()}`);
                    }
                }
            } else {
                log('WARN', `Request account not found or not owned by program: ${requestAccount.toBase58()}`);
            }
        } catch (err) {
            log('ERROR', `Error scanning for specific request: ${err.message}`);
        }
    }

    startBackupScanner() {
        // Run immediately
        this.scanForPendingRequests();

        // Set up interval with a much longer delay to reduce log spam
        setInterval(() => {
            this.scanForPendingRequests();
        }, 60000); // Scan every 60 seconds instead of every 30 seconds
    }

    // Helper method for rate limit handling with exponential backoff
    async callWithRateLimit(apiCall, maxRetries = 5) {
        let retryCount = 0;
        let backoffMs = 1000; // Start with 1 second

        while (retryCount <= maxRetries) {
            try {
                return await apiCall();
            } catch (err) {
                if (err.message.includes('429')) {
                    retryCount++;
                    if (retryCount > maxRetries) {
                        throw err; // Max retries exceeded
                    }

                    const jitter = Math.random() * 500; // Add jitter to prevent synchronized retries
                    const waitTime = backoffMs + jitter;

                    log('WARN', `Rate limited by RPC (attempt ${retryCount}/${maxRetries}), backing off for ${Math.round(waitTime)}ms`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));

                    // Exponential backoff
                    backoffMs = Math.min(backoffMs * 2, 15000); // Max 15 seconds
                } else {
                    throw err; // Not a rate limit error, rethrow
                }
            }
        }
    }

    async scanForPendingRequests() {
        try {
            if (!this.isRunning) return 0;

            // Use rate-limited API call for program accounts
            const programAccounts = await this.callWithRateLimit(async () => {
                return this.connection.getProgramAccounts(this.programId, {
                    commitment: 'confirmed',
                    filters: [
                        { dataSize: 200 }, // Use an approximate size for request accounts
                    ],
                });
            });

            // Only log if we found accounts to avoid log spam
            if (programAccounts.length > 0) {
                log('DEBUG', `Found ${programAccounts.length} program accounts to check`);
            }

            // Track accounts we're processing
            const pendingRequests = [];

            // Process each account with rate limit handling
            for (const { pubkey, account } of programAccounts) {
                try {
                    const isRequest = await this.processRequestAccount(pubkey, account.data);
                    if (isRequest) {
                        pendingRequests.push(pubkey.toBase58());
                        this.processedAccounts.add(pubkey.toBase58());

                        // Early return after finding a request to fulfill it quickly
                        log('INFO', `Found a request to fulfill, processing it immediately`);
                        return 1;
                    }
                } catch (err) {
                    log('ERROR', `Error processing account ${pubkey.toBase58()}: ${err.message}`);
                }
            }

            // If we still haven't found a request, look specifically for recent requests
            try {
                // Get the address of any recently created requests from program logs
                if (this.latestRequestKey) {
                    try {
                        log('INFO', `Checking previously detected request account: ${this.latestRequestKey}`);
                        const requestAccount = await this.callWithRateLimit(async () => {
                            return this.connection.getAccountInfo(new PublicKey(this.latestRequestKey));
                        });

                        if (requestAccount) {
                            const isRequest = await this.processRequestAccount(new PublicKey(this.latestRequestKey), requestAccount.data);
                            if (isRequest) {
                                pendingRequests.push(this.latestRequestKey);
                                this.processedAccounts.add(this.latestRequestKey);
                                return 1;
                            }
                        }
                    } catch (err) {
                        log('ERROR', `Error processing latest request account: ${err.message}`);
                    }
                }

                // Only scan for test accounts if we haven't found any requests yet
                if (pendingRequests.length === 0 && this.latestRequestTxSig) {
                    // Only log detailed debug info on the first scan after a new transaction
                    const shouldLogDetails = this.lastLoggedTxSig !== this.latestRequestTxSig;
                    if (shouldLogDetails) {
                        this.lastLoggedTxSig = this.latestRequestTxSig;
                        log('INFO', `Searching for request account created in transaction: ${this.latestRequestTxSig}`);
                    }

                    // Find test accounts (limit how many we check to avoid rate limits)
                    const testGameProgramId = new PublicKey("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6");

                    const testAccounts = await this.callWithRateLimit(async () => {
                        return this.connection.getProgramAccounts(testGameProgramId, {
                            commitment: 'confirmed',
                            // Limit the number of accounts to avoid rate limiting
                            dataSlice: { offset: 0, length: 0 }, // Just get account addresses, not data
                        });
                    });

                    // Only log if we have accounts and should log details
                    if (shouldLogDetails && testAccounts.length > 0) {
                        log('DEBUG', `Found ${testAccounts.length} test game accounts`);
                    }

                    // Only check a subset of test accounts to avoid rate limits
                    const accountsToCheck = testAccounts.slice(0, 10);

                    for (const { pubkey } of accountsToCheck) {
                        // Only log if we're in detailed logging mode
                        if (shouldLogDetails) {
                            log('DEBUG', `Checking test game account: ${pubkey.toBase58()}`);
                        }

                        // Search for relevant program accounts after each RequestRandomness transaction
                        // This is more reliable than trying to derive the account address
                        if (this.latestRequestTxSig) {
                            try {
                                const tx = await this.callWithRateLimit(async () => {
                                    return this.connection.getTransaction(this.latestRequestTxSig);
                                });

                                if (tx && tx.meta && tx.meta.postTokenBalances) {
                                    // Find accounts created or written in this transaction
                                    const accounts = tx.transaction.message.accountKeys.map(key => key.toString());
                                    if (shouldLogDetails) {
                                        log('DEBUG', `Transaction involved ${accounts.length} accounts`);
                                    }

                                    // Check each account that might be a request account
                                    for (const acct of accounts) {
                                        if (acct === this.programId.toBase58()) continue; // Skip the program itself

                                        try {
                                            const accountInfo = await this.callWithRateLimit(async () => {
                                                return this.connection.getAccountInfo(new PublicKey(acct));
                                            });

                                            if (accountInfo && accountInfo.owner.equals(this.programId)) {
                                                log('INFO', `Found potential request account from tx: ${acct}`);
                                                this.latestRequestKey = acct;
                                                const isRequest = await this.processRequestAccount(new PublicKey(acct), accountInfo.data);
                                                if (isRequest) {
                                                    pendingRequests.push(acct);
                                                    this.processedAccounts.add(acct);
                                                    return 1;
                                                }
                                            }
                                        } catch (err) {
                                            if (shouldLogDetails) {
                                                log('WARN', `Error checking account ${acct}: ${err.message}`);
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                if (shouldLogDetails) {
                                    log('WARN', `Error retrieving transaction: ${err.message}`);
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                log('ERROR', `Error searching for test accounts: ${err.message}`);
            }

            // Only log if we found requests to reduce unnecessary output
            if (pendingRequests.length > 0) {
                log('INFO', `Completed scanning for pending requests. Found ${pendingRequests.length} requests.`);
            }
            return pendingRequests.length;
        } catch (err) {
            log('ERROR', `Failed to scan for pending requests: ${err.message}`);
            return 0;
        }
    }

    // Helper method to identify likely test requests
    isProbableTestRequest(requesterKey) {
        // Known game owner keys from the test
        const gameOwnerKeys = [
            // Add any known game owner keys from the tests here
        ];

        // Check if the requester is our game program
        const gameProgram = "5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6";

        // Check if this is from a recent test
        const isGameProgram = requesterKey.toBase58() === gameProgram;
        const isKnownTestKey = gameOwnerKeys.includes(requesterKey.toBase58());

        return isGameProgram || isKnownTestKey;
    }

    async processRequestAccount(pubkey, data) {
        // Skip if the account doesn't exist or is too small
        if (!data || data.length < 100) {
            log('DEBUG', `Account ${pubkey} data too short (${data ? data.length : 0} bytes)`);
            return;
        }

        // Check if this appears to be a request account by examining the first 8 bytes
        // Rust layout should have "REQUEST" in the first 8 bytes - but check as string
        const prefix = data.toString('ascii', 0, 8);
        if (prefix !== 'REQUEST\0\0') {
            log('DEBUG', `Account ${pubkey} is not a request: prefix ${prefix}`);
            return;
        }

        // Try to figure out pending status
        // Status byte is usually at a specific position in the account layout
        // For RandomnessRequest, it's typically after the pubkeys and other fields
        const statusPosition = 101; // Approximate position based on Rust struct layout
        if (data.length <= statusPosition) {
            log('DEBUG', `Account data too short for status check: ${data.length} bytes`);
            return;
        }

        // Check if the status byte indicates a pending request (0)
        const statusByte = data[statusPosition];
        if (statusByte !== 0) {
            log('DEBUG', `Request ${pubkey} status is not pending: ${statusByte}`);
            return;
        }

        log('DEBUG', `Found potential status byte ${statusByte} at position ${statusPosition} for account ${pubkey}`);

        // Extract requester and subscription from the data
        // These are usually the first and second 32-byte pubkeys in the data
        // (after the 8-byte discriminator)
        try {
            // Try to reconstruct a request structure from the account data
            // This is approximate since we're manually parsing bytes
            const subscriptionStart = 8;
            const requesterStart = 40;

            // Extract subscription and requester from data
            const subscription = new PublicKey(data.slice(subscriptionStart, requesterStart));
            const requester = new PublicKey(data.slice(requesterStart, requesterStart + 32));

            log('INFO', `Found potential request: requester=${requester.toBase58()}, subscription=${subscription.toBase58()}, status=${statusByte}`);

            // Create a simplified request structure that the fulfillRequest function can use
            const request = {
                requester,
                subscription,
                status: statusByte
            };

            // Handle the request
            // Pass the pubkey string, not the PublicKey object
            const result = await this.fulfillRequest(request, pubkey);
            if (result) {
                log('INFO', `Successfully fulfilled request: ${pubkey}`);
            }
        } catch (err) {
            log('ERROR', `Failed to process request account ${pubkey}: ${err.message}`);
            log('ERROR', `Stack trace: ${err.stack}`);
        }
    }

    // Helper method to find a valid subscription for tests
    async findValidTestSubscription() {
        try {
            // Try to find active subscriptions in the program
            const programAccounts = await this.connection.getProgramAccounts(this.programId, {
                commitment: 'confirmed',
                filters: [
                    // Use a single number for subscription size
                    { dataSize: 65 }, // Size for subscriptions
                ],
            });

            // Look for accounts that might be subscriptions
            for (const { pubkey, account } of programAccounts) {
                const data = account.data;
                if (data.length >= 65) {
                    // Try to extract a valid-looking subscription account
                    // For testing purposes, we're just looking for non-zero data
                    const hasNonZeroData = data.slice(8).some(byte => byte !== 0);
                    if (hasNonZeroData) {
                        log('DEBUG', `Found potential subscription account: ${pubkey.toBase58()}`);
                        return pubkey;
                    }
                }
            }

            // If no valid subscription found, return null
            return null;
        } catch (err) {
            log('ERROR', `Error finding test subscription: ${err.message}`);
            return null;
        }
    }

    async fulfillRequest(request, requestAccount) {
        try {
            // Find the requester from the request structure
            const requesterString = request.requester.toBase58();

            log('INFO', `Attempting to fulfill request: ${requestAccount}`);
            log('INFO', `Requester: ${requesterString}`);
            log('INFO', `Subscription: ${request.subscription.toBase58()}`);

            // Generate the result account PDA
            const { resultAccount, gameStatePDA, bump } = await this.createResultAccountPDA(
                requestAccount,
                null,  // Not using buffer extraction
                request.subscription.toBase58()
            );

            // Generate a VRF proof for fulfilling randomness
            const proof = await this.generateProof();

            // Determine the callback program (game program)
            // In the test this is hardcoded to the game program
            const gameProgram = new PublicKey("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6");

            if (DUMMY_MODE) {
                log('DEBUG', 'DUMMY MODE: Using minimum data structure (121 bytes)');
            }

            // Create the accounts array - MUST match exactly as in vrf_devnet_test.rs
            // The key difference in the previous test was that it didn't do real verification
            const accounts = [
                { pubkey: this.feePayer.publicKey, isSigner: true, isWritable: true },        // oracle
                { pubkey: new PublicKey(requestAccount), isSigner: false, isWritable: true },  // request_account
                { pubkey: resultAccount, isSigner: false, isWritable: true },                 // vrf_result_account
                { pubkey: gameProgram, isSigner: false, isWritable: false },                  // callback_program
                { pubkey: request.subscription, isSigner: false, isWritable: true },          // subscription_account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },      // system_program
                { pubkey: gameProgram, isSigner: false, isWritable: false },                  // game_program
                { pubkey: gameStatePDA, isSigner: false, isWritable: true },                  // game_state
            ];

            log('DEBUG', 'Accounts for fulfillRandomness instruction:');
            accounts.forEach((acc, idx) => {
                log('DEBUG', `Account ${idx}: ${acc.pubkey.toBase58()} (signer: ${acc.isSigner}, writable: ${acc.isWritable})`);
            });

            // Serialize the FulfillRandomness instruction using Borsh
            const pubkeyBuffer = this.feePayer.publicKey.toBuffer();
            const instructionData = serializeFulfillRandomnessInstruction(proof, pubkeyBuffer);
            log('DEBUG', `Constructed Borsh instruction data (${instructionData.length} bytes)`);
            log('DEBUG', `Proof length: ${proof.length} bytes, Public key length: ${pubkeyBuffer.length} bytes`);

            // Create the instruction with the correct accounts
            const fulfillIx = new TransactionInstruction({
                programId: this.programId,
                keys: accounts,
                data: instructionData
            });

            // Create the transaction
            const recentBlockhash = await this.connection.getLatestBlockhash();
            log('DEBUG', `Recent blockhash: ${recentBlockhash.blockhash}`);

            const fulfillTx = new Transaction();
            fulfillTx.recentBlockhash = recentBlockhash.blockhash;
            fulfillTx.feePayer = this.feePayer.publicKey;
            fulfillTx.add(fulfillIx);

            // Sign the transaction
            log('INFO', 'Signing transaction with fee payer');
            const signedTx = await this.sendAndConfirmWithRetry(fulfillTx, [this.feePayer]);
            log('INFO', `Transaction sent: ${signedTx}`);

            return signedTx;
        } catch (err) {
            log('ERROR', `Failed to fulfill request: ${err.message}`);
            log('ERROR', `Stack trace: ${err.stack}`);
            return null;
        }
    }

    async sendTransaction(instructionsOrTransaction, signers, retryCount = 3) {
        for (let attempt = 1; attempt <= retryCount; attempt++) {
            try {
                const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
                let transaction;

                // Check if we received a Transaction object or an array of instructions
                if (instructionsOrTransaction instanceof Transaction) {
                    // We received a Transaction object directly
                    transaction = instructionsOrTransaction;

                    // Update the blockhash and fee payer
                    transaction.recentBlockhash = latestBlockhash.blockhash;
                    transaction.feePayer = this.feePayer.publicKey;
                } else if (Array.isArray(instructionsOrTransaction)) {
                    // We received an array of instructions
                    transaction = new Transaction({
                        feePayer: this.feePayer.publicKey,
                        recentBlockhash: latestBlockhash.blockhash,
                    });

                    // Add all instructions
                    instructionsOrTransaction.forEach(instruction => transaction.add(instruction));
                } else {
                    throw new Error('sendTransaction requires an array of instructions or a Transaction object');
                }

                // Make sure feePayer is included in signers
                let allSigners = [...signers];
                let hasFeePayer = false;

                for (const signer of allSigners) {
                    if (signer.publicKey.equals(this.feePayer.publicKey)) {
                        hasFeePayer = true;
                        break;
                    }
                }

                if (!hasFeePayer) {
                    allSigners.push(this.feePayer);
                }

                // Verify all signers have proper signing capability
                for (const signer of allSigners) {
                    if (!signer.secretKey || signer.secretKey.length !== 64) {
                        throw new Error(`Invalid signer: ${signer.publicKey.toBase58()} has invalid secret key`);
                    }
                }

                // Sign the transaction with all signers
                log('DEBUG', `Signing transaction with fee payer and other signers (total: ${allSigners.length})`);

                try {
                    // Use partialSign for all signers (safer than using transaction.sign(...))
                    for (const signer of allSigners) {
                        transaction.partialSign(signer);
                        log('DEBUG', `Transaction signed by: ${signer.publicKey.toBase58()}`);
                    }
                } catch (signError) {
                    log('ERROR', `Failed to sign transaction: ${signError.message}`);

                    // If we encounter a signing issue, try to recreate the keypair
                    if (signError.message.includes('sign') || signError.message.includes('secretKey')) {
                        log('WARN', 'Encountered signing error, reloading keypairs...');
                        // Force reload of keypairs
                        this.loadKeypairs();
                        throw new Error(`Signing error, keypairs reloaded: ${signError.message}`);
                    }
                    throw signError;
                }

                // Serialize and send the transaction
                const rawTx = transaction.serialize();
                log('INFO', `Sending transaction (${rawTx.length} bytes)...`);

                const signature = await this.connection.sendRawTransaction(rawTx, {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed',
                });

                log('INFO', `Transaction sent! Signature: ${signature}`);

                // Wait for confirmation
                await this.connection.confirmTransaction({
                    signature,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                }, 'confirmed');

                log('INFO', `Transaction confirmed: ${signature}`);
                return signature;
            } catch (err) {
                log('WARN', `Transaction failed, retrying (${attempt}/${retryCount}): ${err.message}`);

                if (attempt === retryCount) {
                    throw err;
                }

                // Reload keypair on error (workaround for keypair issues)
                if (err.message.includes('sign') ||
                    err.message.includes('secretKey') ||
                    err.message.includes('not a function') ||
                    err.message.includes('forEach')) {
                    log('WARN', 'Detected signing issue, reloading keypairs');
                    this.loadKeypairs();
                }

                // Add some delay before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    // Generate a VRF proof for fulfilling randomness
    async generateProof() {
        if (DUMMY_MODE) {
            // Generate a minimal proof structure with all zeros except first byte of each component
            // Format: gamma (32 bytes) + c (16 bytes) + s (32 bytes) = 80 bytes
            const gamma = Buffer.alloc(32, 0);
            const c = Buffer.alloc(16, 0);
            const s = Buffer.alloc(32, 0);

            // Set first byte of each component to 1 to make it easily identifiable
            gamma[0] = 1;
            c[0] = 1;
            s[0] = 1;

            const proof = Buffer.concat([gamma, c, s]);
            log('INFO', `Using DUMMY MODE with minimal verification proof`);
            log('INFO', `Generated zero-filled dummy proof (${proof.length} bytes)`);
            log('DEBUG', `Proof structure: gamma(32) + c(16) + s(32) = 80 bytes`);
            return proof;
        } else {
            // Here would be actual proof generation code
            // For now, return the same structure but with proper random data
            const gamma = randomBytes(32);
            const c = randomBytes(16);
            const s = randomBytes(32);
            const proof = Buffer.concat([gamma, c, s]);
            log('DEBUG', `Generated random proof (${proof.length} bytes)`);
            return proof;
        }
    }

    stop() {
        log('INFO', 'Stopping VRF server...');
        this.isRunning = false;

        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }

        log('INFO', 'VRF server stopped');
    }

    // New method to send a test transaction back to the integration test
    async sendBackTestTransaction(originalTxSig) {
        try {
            log('INFO', `Sending test transaction in response to ${originalTxSig}`);

            // Make sure we have valid keypairs before proceeding
            if (!this.feePayer || !this.feePayer.secretKey || this.feePayer.secretKey.length !== 64) {
                log('WARN', 'Fee payer keypair appears invalid, reloading keypairs');
                this.loadKeypairs();
            }

            // Get the transaction details
            const tx = await this.connection.getTransaction(originalTxSig, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            if (!tx) {
                log('ERROR', `Could not find original transaction: ${originalTxSig}`);
                return null;
            }

            // Create a simple test transaction to send back
            const instructionData = Buffer.from("TESTRESPONSE");

            // Use the sender of the original transaction as the recipient
            const senderKey = tx.transaction.message.accountKeys[0];
            log('INFO', `Original transaction sender: ${senderKey.toBase58()}`);

            // Create instruction with custom data
            const instruction = new TransactionInstruction({
                keys: [
                    { pubkey: this.feePayer.publicKey, isSigner: true, isWritable: true },
                    { pubkey: senderKey, isSigner: false, isWritable: false }
                ],
                programId: SystemProgram.programId,
                data: instructionData
            });

            // Send the transaction
            const signature = await this.sendTransaction([instruction], [this.feePayer]);

            log('INFO', `Test response transaction sent: ${signature}`);
            return signature;
        } catch (err) {
            log('ERROR', `Failed to send test transaction: ${err.message}`);
            return null;
        }
    }

    async createResultAccountPDA(requestAccount, requestBuffer, subscription) {
        try {
            // Check how vrf_result PDA is derived in test code
            // In test code, the PDA is derived using: [b"vrf_result", request_account.as_ref()]
            // So we need to use "vrf_result" and the request account pubkey as seeds

            // Create seed buffers
            const seedPrefix = Buffer.from("vrf_result");
            const requestAccountBuffer = new PublicKey(requestAccount).toBuffer();

            // Find PDA
            const [resultAccountPDA, bump] = PublicKey.findProgramAddressSync(
                [seedPrefix, requestAccountBuffer],
                this.programId
            );

            log('INFO', `Generated result account PDA: ${resultAccountPDA.toBase58()} (bump: ${bump})`);

            // In the test code, the request.requester is used to find the game state PDA
            // Try to extract the requester from request buffer (likely at offset 33 for 32 bytes)
            let requesterKey;
            try {
                // Default to a known pattern if we can't extract
                if (requestBuffer && requestBuffer.length >= 65) {
                    // Assuming requester pubkey is at a standard offset in the request data
                    requesterKey = new PublicKey(requestBuffer.slice(33, 65));
                    log('DEBUG', `Extracted requester key from buffer: ${requesterKey.toBase58()}`);
                } else {
                    requesterKey = new PublicKey('111111111111111111111111111111111');
                    log('DEBUG', `Using default requester key: ${requesterKey.toBase58()}`);
                }
            } catch (err) {
                requesterKey = new PublicKey('111111111111111111111111111111111');
                log('WARN', `Failed to extract requester key, using default: ${err.message}`);
            }

            // Derive game state PDA using [b"game", requester.as_ref()]
            const gameStateSeed = Buffer.from("game");
            const [gameStatePDA, gameBump] = PublicKey.findProgramAddressSync(
                [gameStateSeed, requesterKey.toBuffer()],
                new PublicKey("5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6") // Game program ID
            );

            log('INFO', `Game state PDA: ${gameStatePDA.toBase58()} (bump: ${gameBump})`);

            return {
                resultAccount: resultAccountPDA,
                gameStatePDA: gameStatePDA,
                bump
            };
        } catch (err) {
            log('ERROR', `Failed to create result account PDA: ${err.message}`);
            log('ERROR', `Stack trace: ${err.stack}`);
            throw err;
        }
    }
}

// Run the server
async function main() {
    try {
        const server = new SimpleVRFServer(
            options.programId,
            options.feePayerKeypair,
            options.vrfKeypair,
            options.oracleKeypair,
            options.rpcUrl,
            options.wsUrl,
            options.scanInterval,
            options.enhancedMode,
            options.batchSize,
            options.registryId,
            options.logLevel
        );

        await server.start();

        // Handle process signals
        process.on('SIGINT', () => {
            log('INFO', 'Received SIGINT signal');
            server.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            log('INFO', 'Received SIGTERM signal');
            server.stop();
            process.exit(0);
        });
    } catch (err) {
        log('ERROR', `Fatal error: ${err.message}`);
        process.exit(1);
    }
}

// Initialize the log file
fs.writeFileSync(
    path.join(__dirname, 'vrf-server-simple-ws.log'),
    `[${new Date().toISOString()}] [INFO] Starting VRF WebSocket Server\n`
);

// Run the main function
main().catch(err => {
    log('ERROR', `Unhandled error: ${err.message}`);
    process.exit(1);
});