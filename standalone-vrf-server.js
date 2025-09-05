#!/usr/bin/env node

/**
 * Standalone Kamui VRF Server with Mangekyou CLI Integration
 * 
 * This server runs as a standalone Node.js application and calls the 
 * Mangekyou CLI as an external process for VRF proof generation.
 * 
 * Production-ready architecture:
 * - No Rust dependency conflicts
 * - CLI downloaded/compiled separately  
 * - Clean separation of concerns
 * - Easy deployment and monitoring
 */

const { Connection, PublicKey, Keypair, SystemProgram, Transaction, clusterApiUrl } = require('@solana/web3.js');
const { exec, execSync, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    // Deployed program IDs on devnet (from the success report)
    VRF_PROGRAM_ID: "6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a",
    CONSUMER_PROGRAM_ID: "2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE", 
    VERIFIER_PROGRAM_ID: "4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y",
    
    // Network configuration
    RPC_URL: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    WS_URL: process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com",
    
    // CLI configuration
    CLI_PATH: process.env.MANGEKYOU_CLI_PATH || "../mangekyou-cli",
    CLI_BINARY: "target/debug/ecvrf-cli",
    
    // Server configuration
    POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 3000,
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    
    // Oracle configuration
    ORACLE_KEYPAIR_PATH: process.env.ORACLE_KEYPAIR_PATH || "/Users/kyler/repos/kamui/kamui-program/keypair-clean.json",
    VRF_KEYPAIR_PATH: process.env.VRF_KEYPAIR_PATH || "./vrf-keypair.json",
};

// Logger utility
const Logger = {
    info: (msg, ...args) => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`, ...args),
    warn: (msg, ...args) => console.log(`[${new Date().toISOString()}] ⚠️  ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, ...args),
    debug: (msg, ...args) => {
        if (CONFIG.LOG_LEVEL === 'debug') {
            console.log(`[${new Date().toISOString()}] 🐛 ${msg}`, ...args);
        }
    },
    success: (msg, ...args) => console.log(`[${new Date().toISOString()}] ✅ ${msg}`, ...args),
};

class MangekyouCLIInterface {
    constructor() {
        this.cliPath = path.join(CONFIG.CLI_PATH, CONFIG.CLI_BINARY);
        this.vrfKeypair = null;
    }

    async initialize() {
        Logger.info("Initializing Mangekyou CLI interface...");
        
        // Build CLI if needed
        await this.ensureCLIBuilt();
        
        // Load or generate VRF keypair
        await this.loadVRFKeypair();
        
        // Test CLI functionality
        await this.testCLI();
        
        Logger.success("Mangekyou CLI interface initialized successfully");
    }

    async ensureCLIBuilt() {
        try {
            // Check if CLI binary exists in the workspace target directory
            const workspaceCliPath = path.join(process.cwd(), 'target/debug/ecvrf-cli');
            await fs.access(workspaceCliPath);
            Logger.success("CLI binary found in workspace target directory");
            // Update CLI path to use the workspace binary
            this.cliPath = workspaceCliPath;
            return;
        } catch (error) {
            Logger.debug("CLI not found in workspace, checking CLI directory...");
        }

        try {
            // Check if CLI binary exists in the CLI directory
            const cliDirPath = path.join(CONFIG.CLI_PATH, CONFIG.CLI_BINARY);
            await fs.access(cliDirPath);
            Logger.success("CLI binary found in CLI directory");
            this.cliPath = cliDirPath;
            return;
        } catch (error) {
            Logger.error("CLI binary not found. Please build it manually with:");
            Logger.error("  cd mangekyou-cli && cargo build --bin ecvrf-cli");
            throw new Error("CLI binary not found. Please build the CLI first.");
        }
    }

    async loadVRFKeypair() {
        try {
            // Try to load existing keypair
            const keypairData = await fs.readFile(CONFIG.VRF_KEYPAIR_PATH, 'utf8');
            this.vrfKeypair = JSON.parse(keypairData);
            
            Logger.info("Loaded existing VRF keypair");
            Logger.debug("VRF Public Key:", this.vrfKeypair.publicKey);
        } catch (error) {
            Logger.info("No existing VRF keypair found, generating new one...");
            await this.generateVRFKeypair();
        }
    }

    async generateVRFKeypair() {
        Logger.info("Generating new VRF keypair using CLI...");
        
        try {
            const { stdout } = await execAsync(`${this.cliPath} keygen`, {
                timeout: 30000
            });
            
            // Parse CLI output
            const lines = stdout.trim().split('\n');
            const secretKeyLine = lines.find(line => line.includes('Secret key:'));
            const publicKeyLine = lines.find(line => line.includes('Public key:'));
            
            if (!secretKeyLine || !publicKeyLine) {
                throw new Error("Failed to parse CLI keygen output");
            }
            
            const secretKey = secretKeyLine.split('Secret key: ')[1].trim();
            const publicKey = publicKeyLine.split('Public key: ')[1].trim();
            
            this.vrfKeypair = { secretKey, publicKey };
            
            // Save keypair
            await fs.writeFile(CONFIG.VRF_KEYPAIR_PATH, JSON.stringify(this.vrfKeypair, null, 2));
            
            Logger.success("VRF keypair generated and saved");
            Logger.info("VRF Public Key:", publicKey);
            
        } catch (error) {
            Logger.error("Failed to generate VRF keypair:", error.message);
            throw error;
        }
    }

    async testCLI() {
        Logger.info("Testing CLI functionality...");
        
        const testInput = "test_input_" + Date.now();
        
        try {
            // Test proof generation
            const proof = await this.generateProof(testInput);
            
            // Test verification
            const isValid = await this.verifyProof(proof.proof, proof.output, this.vrfKeypair.publicKey, testInput);
            
            if (!isValid) {
                throw new Error("CLI test failed - proof verification failed");
            }
            
            Logger.success("CLI functionality test passed");
            
        } catch (error) {
            Logger.error("CLI test failed:", error.message);
            throw error;
        }
    }

    async generateProof(input) {
        const inputHex = Buffer.from(input).toString('hex');
        Logger.debug(`Generating VRF proof for input: ${inputHex}`);
        
        try {
            const { stdout, stderr } = await execAsync(`${this.cliPath} prove --input ${inputHex} --secret-key ${this.vrfKeypair.secretKey}`, {
                timeout: 30000
            });
            
            if (stderr && !stderr.includes('warning')) {
                Logger.warn("CLI stderr output:", stderr);
            }
            
            // Parse output
            const lines = stdout.trim().split('\n');
            const proofLine = lines.find(line => line.includes('Proof:'));
            const outputLine = lines.find(line => line.includes('Output:'));
            
            if (!proofLine || !outputLine) {
                throw new Error(`Failed to parse CLI prove output: ${stdout}`);
            }
            
            const proof = proofLine.split('Proof:')[1].trim();
            const output = outputLine.split('Output:')[1].trim();
            
            Logger.debug("VRF proof generated successfully");
            Logger.debug(`Proof length: ${proof.length} chars`);
            Logger.debug(`Output length: ${output.length} chars`);
            
            return { proof, output };
            
        } catch (error) {
            Logger.error("Failed to generate VRF proof:", error.message);
            throw error;
        }
    }

    async verifyProof(proof, output, publicKey, input) {
        const inputHex = Buffer.from(input).toString('hex');
        Logger.debug("Verifying VRF proof...");
        
        try {
            const { stdout, stderr } = await execAsync(`${this.cliPath} verify --proof ${proof} --output ${output} --public-key ${publicKey} --input ${inputHex}`, {
                timeout: 30000
            });
            
            // CLI exits with code 0 for successful verification
            Logger.debug("VRF proof verification successful");
            return true;
            
        } catch (error) {
            // CLI exits with non-zero code for failed verification
            Logger.debug("VRF proof verification failed:", error.message);
            return false;
        }
    }

    getPublicKey() {
        return this.vrfKeypair?.publicKey;
    }

    getSecretKey() {
        return this.vrfKeypair?.secretKey;
    }
}

class StandaloneVRFServer {
    constructor() {
        this.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        this.vrfProgramId = new PublicKey(CONFIG.VRF_PROGRAM_ID);
        this.cli = new MangekyouCLIInterface();
        this.oracleKeypair = null;
        this.processedRequests = new Map();
        this.isRunning = false;
        this.stats = {
            startTime: Date.now(),
            requestsProcessed: 0,
            requestsFulfilled: 0,
            errors: 0
        };
    }

    async initialize() {
        Logger.info("🚀 Initializing Standalone Kamui VRF Server");
        Logger.info("=".repeat(80));
        
        // Initialize CLI
        await this.cli.initialize();
        
        // Load oracle keypair
        await this.loadOracleKeypair();
        
        // Test connection
        await this.testConnection();
        
        Logger.success("VRF Server initialized successfully");
        this.logConfiguration();
    }

    async loadOracleKeypair() {
        try {
            const keypairData = await fs.readFile(CONFIG.ORACLE_KEYPAIR_PATH, 'utf8');
            const keypairArray = JSON.parse(keypairData);
            this.oracleKeypair = Keypair.fromSecretKey(new Uint8Array(keypairArray));
            
            Logger.info("Oracle keypair loaded:", this.oracleKeypair.publicKey.toString());
        } catch (error) {
            Logger.error("Failed to load oracle keypair:", error.message);
            Logger.info("Please ensure oracle keypair exists at:", CONFIG.ORACLE_KEYPAIR_PATH);
            throw error;
        }
    }

    async testConnection() {
        try {
            const version = await this.connection.getVersion();
            const slot = await this.connection.getSlot();
            
            Logger.success("Connected to Solana cluster");
            Logger.debug("Cluster version:", version['solana-core']);
            Logger.debug("Current slot:", slot);
        } catch (error) {
            Logger.error("Failed to connect to Solana cluster:", error.message);
            throw error;
        }
    }

    logConfiguration() {
        Logger.info("📊 Server Configuration:");
        Logger.info("   VRF Program ID:", CONFIG.VRF_PROGRAM_ID);
        Logger.info("   Consumer Program ID:", CONFIG.CONSUMER_PROGRAM_ID);
        Logger.info("   Verifier Program ID:", CONFIG.VERIFIER_PROGRAM_ID);
        Logger.info("   RPC URL:", CONFIG.RPC_URL);
        Logger.info("   Oracle Pubkey:", this.oracleKeypair.publicKey.toString());
        Logger.info("   VRF Public Key:", this.cli.getPublicKey());
        Logger.info("   Polling Interval:", `${CONFIG.POLLING_INTERVAL}ms`);
    }

    async start() {
        this.isRunning = true;
        this.stats.startTime = Date.now();
        
        Logger.info("🎯 Starting VRF request monitoring...");
        Logger.info("🔍 Monitoring for pending VRF requests...");
        Logger.info("📡 Ready to fulfill randomness requests!");
        Logger.info("⚠️  Press Ctrl+C to stop the server\n");
        
        // Setup graceful shutdown
        this.setupGracefulShutdown();
        
        // Main monitoring loop
        while (this.isRunning) {
            try {
                await this.monitorAndProcess();
                await this.sleep(CONFIG.POLLING_INTERVAL);
            } catch (error) {
                Logger.error("Error in monitoring loop:", error.message);
                this.stats.errors++;
                await this.sleep(5000); // Wait longer on error
            }
        }
    }

    async monitorAndProcess() {
        const startTime = Date.now();
        Logger.debug("🔍 Scanning for pending VRF requests...");
        
        try {
            // Get all pending request accounts
            const accounts = await this.getPendingRequestAccounts();
            
            Logger.debug(`Found ${accounts.length} pending request accounts`);
            
            if (accounts.length === 0) {
                Logger.debug("No pending requests found");
                return;
            }
            
            let processedCount = 0;
            for (const account of accounts) {
                try {
                    if (await this.processRequestAccount(account)) {
                        processedCount++;
                        // Add small delay between processing requests to avoid overwhelming the network
                        await this.sleep(1000);
                    }
                } catch (error) {
                    Logger.error(`Error processing account ${account.pubkey}:`, error.message);
                    this.stats.errors++;
                }
            }
            
            const duration = Date.now() - startTime;
            if (processedCount > 0) {
                Logger.success(`✅ Processed ${processedCount} VRF requests in ${duration}ms`);
                this.logProcessingStats();
            } else {
                Logger.debug(`No new requests processed (${duration}ms)`);
            }
            
        } catch (error) {
            Logger.error("Error scanning for requests:", error.message);
            throw error;
        }
    }

    async getPendingRequestAccounts() {
        // Get all accounts for the VRF program
        const accounts = await this.connection.getProgramAccounts(this.vrfProgramId, {
            commitment: 'confirmed',
            encoding: 'base64'
        });
        
        Logger.debug(`Found ${accounts.length} VRF program accounts`);
        
        // Filter for request accounts that haven't been fulfilled yet
        const pendingRequests = [];
        
        for (const account of accounts) {
            try {
                const data = account.account.data;
                
                // Skip accounts with insufficient data
                if (data.length < 32) {
                    Logger.debug(`Account ${account.pubkey} has insufficient data: ${data.length} bytes`);
                    continue;
                }
                
                // Check discriminator first to identify VRF request accounts
                const discriminator = data.slice(0, 8);
                const discriminatorHex = discriminator.toString('hex');
                
                // VRF request account discriminator (from integration test)
                if (discriminatorHex === 'f4e7e4a0941c11b8') {
                    Logger.debug(`⭐ Found VRF request account with correct discriminator: ${account.pubkey}`);
                    
                    // Check if this request is still pending
                    if (await this.isRequestPending(account)) {
                        Logger.info(`🎯 Adding VRF request to processing queue: ${account.pubkey}`);
                        pendingRequests.push(account);
                    } else {
                        Logger.debug(`Request ${account.pubkey} already processed or not pending`);
                    }
                } else {
                    Logger.debug(`Account ${account.pubkey} has discriminator ${discriminatorHex}, not a VRF request`);
                }
                
            } catch (error) {
                Logger.debug(`Error checking account ${account.pubkey}: ${error.message}`);
            }
        }
        
        Logger.debug(`Filtered to ${pendingRequests.length} pending VRF requests`);
        return pendingRequests;
    }

    async isRequestPending(account) {
        const pubkeyStr = account.pubkey.toString();
        
        // Skip if already processed recently (within last 10 minutes)
        if (this.processedRequests.has(pubkeyStr)) {
            const processedInfo = this.processedRequests.get(pubkeyStr);
            // Re-check if it was processed more than 10 minutes ago
            if (Date.now() - processedInfo.timestamp < 10 * 60 * 1000) {
                Logger.debug(`Request ${pubkeyStr} was processed recently, skipping`);
                return false;
            } else {
                Logger.debug(`Request ${pubkeyStr} processed over 10 minutes ago, checking again`);
                // Remove old entry to allow re-processing
                this.processedRequests.delete(pubkeyStr);
            }
        }
        
        try {
            const data = account.account.data;
            
            // Check discriminator to ensure it's a VRF request
            const discriminator = data.slice(0, 8);
            const discriminatorHex = discriminator.toString('hex');
            
            if (discriminatorHex !== 'f4e7e4a0941c11b8') {
                Logger.debug(`Account ${pubkeyStr} is not a VRF request (discriminator: ${discriminatorHex})`);
                return false;
            }
            
            // Parse request status from account data
            // RandomnessRequest layout after discriminator:
            // subscription (32) + seed (32) + requester (32) + callback_data (4 + len) + request_slot (8) + status (1)
            let offset = 8; // Skip discriminator
            offset += 32; // Skip subscription
            offset += 32; // Skip seed  
            offset += 32; // Skip requester
            
            // Skip callback_data (4 bytes length + data)
            if (data.length <= offset + 4) {
                Logger.debug(`Account ${pubkeyStr} has insufficient data for callback_data length`);
                return false;
            }
            const callbackDataLength = data.readUInt32LE(offset);
            offset += 4 + callbackDataLength;
            
            // Skip request_slot (8 bytes)
            offset += 8;
            
            // Read status (1 byte)
            if (data.length <= offset) {
                Logger.debug(`Account ${pubkeyStr} has insufficient data for status`);
                return false;
            }
            const status = data.readUInt8(offset);
            
            // RequestStatus enum: Pending = 0, Fulfilled = 1, Cancelled = 2, Expired = 3
            if (status !== 0) {
                Logger.debug(`Request ${pubkeyStr} is not pending (status: ${status})`);
                return false;
            }
            
            Logger.debug(`VRF request ${pubkeyStr} is pending`);
            return true;
            
        } catch (error) {
            Logger.debug(`Error parsing request account ${pubkeyStr}: ${error.message}`);
            return false;
        }
    }

    logProcessingStats() {
        const uptime = Date.now() - this.stats.startTime;
        const uptimeMinutes = Math.floor(uptime / (1000 * 60));
        
        Logger.info(`📊 Processing Stats: ${this.stats.requestsProcessed} processed, ${this.stats.requestsFulfilled} fulfilled, ${this.stats.errors} errors, uptime: ${uptimeMinutes}m`);
    }

    async processRequestAccount(account) {
        const pubkeyStr = account.pubkey.toString();
        
        // Skip if already processed
        if (this.processedRequests.has(pubkeyStr)) {
            return false;
        }
        
        try {
            // Parse request data
            const data = account.account.data;
            
            if (data.length < 8) {
                Logger.debug(`Account ${pubkeyStr} has insufficient data`);
                return false;
            }
            
            // Check discriminator for VRF request accounts
            const discriminator = data.slice(0, 8);
            const discriminatorHex = discriminator.toString('hex');
            
            // VRF request account discriminator from integration test
            if (discriminatorHex !== 'f4e7e4a0941c11b8') {
                Logger.debug(`Account ${pubkeyStr} has discriminator ${discriminatorHex}, not a VRF request`);
                return false;
            }
            
            Logger.debug(`Found VRF request account with correct discriminator: ${pubkeyStr}`);
            Logger.info(`🎲 Processing VRF request: ${pubkeyStr}`);
            
            // Parse request account data properly according to RandomnessRequest struct
            let offset = 8; // Skip discriminator
            
            // subscription: 32 bytes
            const subscription = data.slice(offset, offset + 32);
            offset += 32;
            
            // seed: 32 bytes
            const seed = data.slice(offset, offset + 32);
            offset += 32;
            
            // requester: 32 bytes 
            const requester = data.slice(offset, offset + 32);
            offset += 32;
            
            // callback_data: Vec<u8> = 4 bytes length + data
            const callbackDataLength = data.readUInt32LE(offset);
            offset += 4 + callbackDataLength;
            
            // request_slot: 8 bytes
            offset += 8;
            
            // status: 1 byte
            offset += 1;
            
            // num_words: 4 bytes
            offset += 4;
            
            // callback_gas_limit: 8 bytes
            offset += 8;
            
            // pool_id: 1 byte
            const poolId = data.readUInt8(offset);
            offset += 1;
            
            // request_index: 4 bytes
            const requestIndex = data.readUInt32LE(offset);
            offset += 4;
            
            // request_id: 32 bytes
            const requestId = data.slice(offset, offset + 32);
            
            Logger.info(`Parsed request data:`);
            Logger.info(`  Request ID: ${requestId.toString('hex')}`);
            Logger.info(`  Subscriber: ${new PublicKey(requester).toString()}`);
            Logger.info(`  Pool ID: ${poolId}`);
            Logger.info(`  Request Index: ${requestIndex}`);
            Logger.info(`  Seed: ${seed.toString('hex')}`);
            
            // Generate real VRF proof using CLI
            const proofResult = await this.cli.generateProof(seed);
            
            // Verify proof before submitting
            const isValid = await this.cli.verifyProof(
                proofResult.proof,
                proofResult.output, 
                this.cli.getPublicKey(),
                seed
            );
            
            if (!isValid) {
                Logger.error(`Proof verification failed for request ${pubkeyStr}`);
                return false;
            }
            
            Logger.success(`Generated and verified VRF proof for ${pubkeyStr}`);
            Logger.debug(`VRF output: ${proofResult.output.substring(0, 32)}...`);
            
            // Mark as processed
            this.processedRequests.set(pubkeyStr, {
                timestamp: Date.now(),
                proof: proofResult.proof,
                output: proofResult.output,
                seed: seed.toString('hex'),
                requestId: requestId.toString('hex'),
                poolId: poolId,
                requestIndex: requestIndex
            });
            
            this.stats.requestsProcessed++;
            
            // Submit real fulfillment transaction using the correct format
            Logger.info(`🚀 Submitting VRF fulfillment for request: ${pubkeyStr}`);
            const fulfillmentResult = await this.submitFulfillment(
                pubkeyStr, 
                proofResult, 
                seed, 
                requestId, 
                poolId, 
                requestIndex,
                new PublicKey(subscription).toString()  // Pass the subscription PDA from the request
            );
            
            if (fulfillmentResult.success) {
                Logger.success(`📡 Fulfillment submitted: ${fulfillmentResult.signature}`);
                Logger.info(`🔗 Explorer: https://explorer.solana.com/tx/${fulfillmentResult.signature}?cluster=devnet`);
                this.stats.requestsFulfilled++;
            } else {
                Logger.error(`Failed to submit fulfillment: ${fulfillmentResult.error}`);
                return false;
            }
            
            return true;
            
        } catch (error) {
            Logger.error(`Error processing request ${pubkeyStr}:`, error.message);
            throw error;
        }
    }

    async submitFulfillment(requestAccountPubkey, proofResult, seed, requestId, poolId, requestIndex, subscriptionPDAStr) {
        try {
            Logger.info(`🚀 Submitting VRF fulfillment for request: ${requestAccountPubkey}`);
            
            // Create fulfillment instruction using the same format as the integration test
            const instruction = await this.createFulfillmentInstruction(
                requestAccountPubkey, 
                proofResult,
                seed,
                requestId,
                poolId,
                requestIndex,
                subscriptionPDAStr  // Pass subscription PDA directly
            );
            
            // Create and send transaction
            const transaction = new Transaction().add(instruction);
            
            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.oracleKeypair.publicKey;
            
            // Sign transaction
            transaction.sign(this.oracleKeypair);
            
            // Send transaction
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(), 
                {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed',
                    maxRetries: 3
                }
            );
            
            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight: (await this.connection.getLatestBlockhash()).lastValidBlockHeight
            }, 'confirmed');
            
            if (confirmation.value.err) {
                Logger.error("Transaction failed:", confirmation.value.err);
                return { success: false, error: confirmation.value.err };
            }
            
            return { success: true, signature };
            
        } catch (error) {
            Logger.error("Failed to submit fulfillment:", error.message);
            return { success: false, error: error.message };
        }
    }

    async createFulfillmentInstruction(requestAccountPubkey, proofResult, seed, requestId, poolId, requestIndex, subscriptionPDAStr) {
        // Use the same instruction format as the integration test
        const requestAccount = new PublicKey(requestAccountPubkey);
        
        // Convert proof data to buffers
        const proofBuffer = Buffer.from(proofResult.proof, 'hex');
        const publicKeyBuffer = Buffer.from(this.cli.getPublicKey(), 'hex');
        
        // Use the subscription PDA directly from the request data
        // The request data contains the actual subscription PDA that was used during request creation
        const subscriptionPDA = new PublicKey(subscriptionPDAStr);
        
        Logger.debug(`Using subscription PDA from request data: ${subscriptionPDA.toString()}`);
        
        // Derive request pool PDA (exactly like integration test)
        const [requestPoolPDA] = await PublicKey.findProgramAddress(
            [
                Buffer.from("request_pool"),
                subscriptionPDA.toBuffer(),
                Buffer.from([poolId])
            ],
            this.vrfProgramId
        );
        
        // Derive VRF result PDA using request account public key (not request ID)
        const [vrfResultPDA] = await PublicKey.findProgramAddress(
            [Buffer.from("vrf_result"), requestAccount.toBuffer()],
            this.vrfProgramId
        );
        
        Logger.info("Creating fulfillment instruction with integration test format");
        Logger.info(`Request account: ${requestAccount.toString()}`);
        Logger.info(`Subscription PDA: ${subscriptionPDA.toString()}`);
        Logger.info(`Request Pool PDA: ${requestPoolPDA.toString()}`);
        Logger.info(`VRF Result PDA: ${vrfResultPDA.toString()}`);
        Logger.info(`Request ID: ${requestId.toString('hex')}`);
        Logger.debug(`Pool ID: ${poolId}`);
        Logger.debug(`Request Index: ${requestIndex}`);
        
        // Create instruction data exactly like the integration test
        const fulfillTotalSize = 8 + 4 + proofBuffer.length + 4 + publicKeyBuffer.length + 32 + 1 + 4;
        const fulfillData = Buffer.alloc(fulfillTotalSize);
        let fulfillOffset = 0;

        // Discriminator for fulfill_randomness (same as integration test)
        Buffer.from([235, 105, 140, 46, 40, 88, 117, 2]).copy(fulfillData, fulfillOffset);
        fulfillOffset += 8;

        // proof Vec<u8>
        fulfillData.writeUInt32LE(proofBuffer.length, fulfillOffset);
        fulfillOffset += 4;
        proofBuffer.copy(fulfillData, fulfillOffset);
        fulfillOffset += proofBuffer.length;

        // public_key Vec<u8>
        fulfillData.writeUInt32LE(publicKeyBuffer.length, fulfillOffset);
        fulfillOffset += 4;
        publicKeyBuffer.copy(fulfillData, fulfillOffset);
        fulfillOffset += publicKeyBuffer.length;

        // request_id [u8; 32]
        requestId.copy(fulfillData, fulfillOffset);
        fulfillOffset += 32;

        // pool_id u8
        fulfillData.writeUInt8(poolId, fulfillOffset);
        fulfillOffset += 1;

        // request_index u32
        fulfillData.writeUInt32LE(requestIndex, fulfillOffset);
        
        // Create instruction with the correct 6 accounts as defined in FulfillRandomness struct
        const instruction = {
            keys: [
                { pubkey: this.oracleKeypair.publicKey, isSigner: true, isWritable: true },  // oracle
                { pubkey: requestAccount, isSigner: false, isWritable: true },              // request_account
                { pubkey: vrfResultPDA, isSigner: false, isWritable: true },               // vrf_result_account
                { pubkey: requestPoolPDA, isSigner: false, isWritable: true },             // request_pool_account
                { pubkey: subscriptionPDA, isSigner: false, isWritable: true },            // subscription_account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // system_program
            ],
            programId: this.vrfProgramId,
            data: fulfillData,
        };
        
        Logger.debug("Fulfillment instruction created with integration test format");
        return instruction;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setupGracefulShutdown() {
        const shutdown = () => {
            Logger.info("\n🛑 Received shutdown signal");
            this.isRunning = false;
            this.printStats();
            Logger.success("VRF Server shutdown completed");
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    printStats() {
        const uptime = Date.now() - this.stats.startTime;
        const uptimeSeconds = Math.floor(uptime / 1000);
        
        Logger.info("📊 Final Statistics:");
        Logger.info(`   Uptime: ${uptimeSeconds}s`);
        Logger.info(`   Requests processed: ${this.stats.requestsProcessed}`);
        Logger.info(`   Requests fulfilled: ${this.stats.requestsFulfilled}`);
        Logger.info(`   Errors: ${this.stats.errors}`);
        Logger.info(`   Success rate: ${this.stats.requestsProcessed > 0 ? ((this.stats.requestsFulfilled / this.stats.requestsProcessed) * 100).toFixed(1) : 0}%`);
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Standalone Kamui VRF Server

USAGE:
    node standalone-vrf-server.js [OPTIONS]

OPTIONS:
    --test-cli          Test CLI integration only
    --test-connection   Test Solana connection only  
    --help, -h          Show this help message

ENVIRONMENT VARIABLES:
    SOLANA_RPC_URL      Solana RPC endpoint (default: devnet)
    SOLANA_WS_URL       Solana WebSocket endpoint
    MANGEKYOU_CLI_PATH  Path to Mangekyou CLI directory
    ORACLE_KEYPAIR_PATH Path to oracle keypair file
    VRF_KEYPAIR_PATH    Path to VRF keypair file
    POLLING_INTERVAL    Polling interval in ms (default: 3000)
    LOG_LEVEL          Log level: debug, info, warn, error (default: info)

EXAMPLE:
    SOLANA_RPC_URL=https://api.mainnet-beta.solana.com LOG_LEVEL=debug node standalone-vrf-server.js
        `);
        return;
    }
    
    try {
        const server = new StandaloneVRFServer();
        await server.initialize();
        
        if (args.includes('--test-cli')) {
            Logger.success("✅ CLI integration test completed successfully");
            return;
        }
        
        if (args.includes('--test-connection')) {
            Logger.success("✅ Solana connection test completed successfully");
            return;
        }
        
        // Start the server
        await server.start();
        
    } catch (error) {
        Logger.error("Failed to start VRF server:", error.message);
        if (CONFIG.LOG_LEVEL === 'debug') {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { StandaloneVRFServer, MangekyouCLIInterface };
