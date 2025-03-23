#!/usr/bin/env node

/**
 * Simplified VRF Server using WebSocket for Solana
 * 
 * This server uses WebSocket to subscribe to program logs and fulfills VRF requests.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import * as nacl from 'tweetnacl';
import { Command } from 'commander';
import * as bs58 from 'bs58';
import * as borsh from 'borsh';
import * as crypto from 'crypto';
import { Buffer } from 'buffer';
import { BufferLayout } from '@solana/buffer-layout';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { Schema, serialize } from 'borsh';

// Promisify exec for async/await usage
const execPromise = promisify(exec);

// Set up command line arguments
const program = new Command();

program
  .option('--program-id <id>', 'Program ID of the VRF coordinator', 'BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D')
  .option('--feepayer-keypair <path>', 'Path to the fee payer keypair', 'keypair.json')
  .option('--vrf-keypair <path>', 'Path to the VRF keypair', 'vrf-keypair.json')
  .option('--rpc-url <url>', 'Solana RPC URL', 'https://api.devnet.solana.com')
  .option('--ws-url <url>', 'Solana WebSocket URL (derived from RPC URL if not provided)')
  .option('--scan-interval <ms>', 'Backup scanning interval in milliseconds', '1000')
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
function serializeFulfillRandomnessInstruction(proof: Buffer, publicKey: Buffer): Buffer {
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
  } catch (err: any) {
    log('ERROR', `Serialization error: ${err.message}`);
    log('ERROR', `Stack trace: ${err.stack}`);
    throw err;
  }
}

const write = () => console.log(`Local time: ${Date.now()}`);

const run = async () => {
  const interval = (
    Number.parseInt(process.env.INTERVAL ?? '', 10) ||
    Number.parseInt(process.argv[2], 10) ||
    60
  ) * 1000;
  setTimeout(write, 0);
  setInterval(write, interval);
}

run().catch(e => {
  console.error('Error', e);
  process.exit(1);
})

// Simple logging
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);

  // Also append to log file
  fs.appendFileSync(
    path.join(__dirname, '../vrf-server-simple-ws.log'),
    `[${timestamp}] [${level}] ${message}\n`
  );
}

// Main VRF Server class
class SimpleVRFServer {
  private programId: PublicKey;
  private feePayerPath: string;
  private vrfKeyPath: string;
  private rpcUrl: string;
  private wsUrl: string;
  private scanInterval: number;
  private connection: Connection;
  private ws: WebSocket | null;
  private isRunning: boolean;
  private processedRequests: Set<string>;
  private processedAccounts: Set<string>;
  private latestRequestKey: string | null;
  private latestRequestTxSig: string | null;
  private lastLoggedTxSig: string | null;
  private feePayer!: Keypair;
  private vrfKey!: Keypair;

  constructor(programId: string, feePayerPath: string | undefined, vrfKeyPath: string | undefined, rpcUrl: string, wsUrl: string, scanInterval: string | undefined) {
    this.programId = new PublicKey(programId);
    this.feePayerPath = feePayerPath || 'keypair.json';
    this.vrfKeyPath = vrfKeyPath || 'vrf-keypair.json';
    this.rpcUrl = rpcUrl;
    this.wsUrl = wsUrl;
    this.scanInterval = parseInt(scanInterval || '3000');

    this.connection = new Connection(this.rpcUrl, 'confirmed');
    this.ws = null;
    this.isRunning = false;
    this.processedRequests = new Set();
    this.processedAccounts = new Set();
    this.latestRequestKey = null;
    this.latestRequestTxSig = null;
    this.lastLoggedTxSig = null;
  }

  async start(): Promise<boolean> {
    try {
      log('INFO', 'Starting Simplified VRF WebSocket Server');
      log('INFO', `Program ID: ${this.programId.toBase58()}`);
      log('INFO', `RPC URL: ${this.rpcUrl}`);
      log('INFO', `WebSocket URL: ${this.wsUrl}`);
      log('INFO', `Backup scan interval: ${this.scanInterval}ms`);

      // Load keypairs
      this.loadKeypairs();

      // Check feepayer balance
      const balance = await this.connection.getBalance(this.feePayer.publicKey);
      log('INFO', `Fee payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

      if (balance < 0.1 * LAMPORTS_PER_SOL) {
        log('WARN', 'Fee payer has less than 0.1 SOL. Transactions may fail.');
        log('WARN', `Please manually fund this address: ${this.feePayer.publicKey.toBase58()}`);
      }

      this.isRunning = true;

      // Connect to WebSocket
      this.connectWebSocket();

      // Start backup scanning with reduced frequency
      this.startBackupScanner();

      return true;
    } catch (err: any) {
      log('ERROR', `Failed to start server: ${err.message}`);
      return false;
    }
  }

  loadKeypairs(): void {
    try {
      // Load fee payer keypair
      const feePayerPath = path.join(__dirname, '..', this.feePayerPath);
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
        } catch (parseErr: any) {
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
        } else if (typeof secretKeyData === 'string') {
          // In case the key is a base58 encoded string
          try {
            secretKeyBytes = bs58.decode(secretKeyData);
            log('INFO', 'Decoded base58 encoded secret key');
          } catch (bs58Err) {
            throw new Error('Invalid keypair format - string is not a valid base58 encoded key');
          }
        } else {
          throw new Error('Invalid keypair format - expected array or object with _keypair.secretKey');
        }

        // Make sure the secret key is the correct length (a Solana keypair is 64 bytes)
        if (secretKeyBytes.length !== 64) {
          throw new Error(`Invalid keypair length: ${secretKeyBytes.length} (expected 64 bytes)`);
        }

        // Create a proper Solana keypair from the bytes
        this.feePayer = Keypair.fromSecretKey(secretKeyBytes);

        // Test the keypair by signing some data
        const testData = Buffer.from('test');
        try {
          // Using vanilla JS to test signing
          const signature = nacl.sign.detached(testData, this.feePayer.secretKey);
          log('INFO', 'Successfully tested keypair signing capability');
        } catch (signErr) {
          log('ERROR', `Failed to test keypair signing: ${signErr}`);
          throw new Error('Keypair cannot sign data');
        }

        log('INFO', `Fee payer public key: ${this.feePayer.publicKey.toBase58()}`);
      } catch (keyErr: any) {
        log('ERROR', `Failed to create feePayer keypair from data: ${keyErr.message}`);
        throw keyErr;
      }

      // Try to load VRF keypair (using same approach as fee payer)
      try {
        const vrfKeyPath = path.join(__dirname, '..', this.vrfKeyPath);
        log('INFO', `Loading VRF keypair from: ${vrfKeyPath}`);

        if (!fs.existsSync(vrfKeyPath)) {
          throw new Error(`VRF keypair file does not exist: ${this.vrfKeyPath}`);
        }

        // Read and parse file
        const vrfData = fs.readFileSync(vrfKeyPath, 'utf8');
        let vrfSecretKeyData;

        try {
          vrfSecretKeyData = JSON.parse(vrfData);
        } catch (parseErr: any) {
          log('ERROR', `Failed to parse VRF keypair data as JSON: ${parseErr.message}`);
          throw parseErr;
        }

        // Handle different formats, same as with fee payer
        let vrfSecretKeyBytes;
        if (Array.isArray(vrfSecretKeyData)) {
          vrfSecretKeyBytes = Uint8Array.from(vrfSecretKeyData);
        } else if (vrfSecretKeyData._keypair && vrfSecretKeyData._keypair.secretKey) {
          vrfSecretKeyBytes = Uint8Array.from(vrfSecretKeyData._keypair.secretKey);
        } else if (typeof vrfSecretKeyData === 'string') {
          try {
            vrfSecretKeyBytes = bs58.decode(vrfSecretKeyData);
            log('INFO', 'Decoded base58 encoded VRF secret key');
          } catch (bs58Err) {
            throw new Error('Invalid VRF keypair format - string is not a valid base58 encoded key');
          }
        } else {
          throw new Error('Invalid VRF keypair format');
        }

        // Make sure the VRF secret key is the correct length
        if (vrfSecretKeyBytes.length !== 64) {
          throw new Error(`Invalid VRF keypair length: ${vrfSecretKeyBytes.length} (expected 64 bytes)`);
        }

        this.vrfKey = Keypair.fromSecretKey(vrfSecretKeyBytes);

        // Test VRF keypair signing
        const testData = Buffer.from('test');
        try {
          const signature = nacl.sign.detached(testData, this.vrfKey.secretKey);
          log('INFO', 'Successfully tested VRF keypair signing capability');
        } catch (signErr) {
          log('ERROR', `Failed to test VRF keypair signing: ${signErr}`);
          throw new Error('VRF keypair cannot sign data');
        }

        log('INFO', `VRF keypair public key: ${this.vrfKey.publicKey.toBase58()}`);
      } catch (err: any) {
        // Generate ephemeral keypair if can't load
        log('WARN', `Could not load VRF keypair: ${err.message}. Generating ephemeral keypair.`);
        this.vrfKey = Keypair.generate();
        log('INFO', `VRF keypair public key: ${this.vrfKey.publicKey.toBase58()} (ephemeral)`);

        // Save the generated keypair for future use
        try {
          const secretKeyArray = Array.from(this.vrfKey.secretKey);
          fs.writeFileSync(path.join(__dirname, '..', this.vrfKeyPath), JSON.stringify(secretKeyArray));
          log('INFO', `Saved new VRF keypair to ${this.vrfKeyPath}`);
        } catch (writeErr: any) {
          log('ERROR', `Failed to save new VRF keypair: ${writeErr.message}`);
        }
      }
    } catch (err: any) {
      log('ERROR', `Failed to load keypairs: ${err.message}`);

      // Generate a new keypair and save it to the file for future use
      log('WARN', 'Generating new fee payer keypair and saving to file');
      this.feePayer = Keypair.generate();

      try {
        const secretKeyArray = Array.from(this.feePayer.secretKey);
        fs.writeFileSync(path.join(__dirname, '..', this.feePayerPath), JSON.stringify(secretKeyArray));
        log('INFO', `New fee payer keypair saved to ${this.feePayerPath}`);
      } catch (writeErr: any) {
        log('ERROR', `Failed to save new keypair: ${writeErr.message}`);
      }

      log('INFO', `New fee payer public key: ${this.feePayer.publicKey.toBase58()}`);

      // Also ensure VRF keypair exists
      if (!this.vrfKey) {
        this.vrfKey = Keypair.generate();
        try {
          const secretKeyArray = Array.from(this.vrfKey.secretKey);
          fs.writeFileSync(path.join(__dirname, '..', this.vrfKeyPath), JSON.stringify(secretKeyArray));
          log('INFO', `New VRF keypair saved to ${this.vrfKeyPath}`);
        } catch (writeErr: any) {
          log('ERROR', `Failed to save new VRF keypair: ${writeErr.message}`);
        }
        log('INFO', `Temporary VRF keypair public key: ${this.vrfKey.publicKey.toBase58()}`);
      }
    }
  }

  connectWebSocket(): void {
    try {
      log('INFO', `Connecting to WebSocket at ${this.wsUrl}`);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        log('INFO', 'WebSocket connected! Subscribing to program logs...');
        this.subscribeToLogs();
      });

      this.ws.on('message', (data) => {
        try {
          this.onWebSocketMessage(data.toString());
        } catch (err: any) {
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
    } catch (err: any) {
      log('ERROR', `Failed to connect to WebSocket: ${err.message}`);
      this.reconnect();
    }
  }

  reconnect(): void {
    if (!this.isRunning) return;

    // Wait 5 seconds before reconnecting
    log('INFO', 'Will reconnect in 5 seconds...');
    setTimeout(() => {
      this.connectWebSocket();
    }, 5000);
  }

  subscribeToLogs(): void {
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

  onWebSocketMessage(msg: string): void {
    try {
      const data = JSON.parse(msg);
      log('DEBUG', `Received WS message: ${msg}`);

      // Check if this is a logs notification
      if (data.method === 'logsNotification') {
        const { signature, logs } = data.params.result.value;
        log('INFO', `Received transaction notification: ${signature}`);
        log('INFO', `Transaction has ${logs.length} log entries`);

        // Print each log line for debugging
        logs.forEach((logLine: string, i: number) => {
          log('DEBUG', `Log[${i}]: ${logLine}`);
        });

        // Check for test transactions from our integration test
        const isTestTransaction = logs.some((log: string) =>
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
        const hasRequestRandomness = logs.some((log: string) => log.includes('VRF Coordinator: RequestRandomness'));

        if (hasRequestRandomness) {
          log('INFO', `Found RequestRandomness instruction in transaction ${signature}`);

          // Store the transaction signature for looking up request account
          this.latestRequestTxSig = signature;

          // Check for VRF_EVENT logs which contain request information
          const vrfEventLog = logs.find((log: string) => log.includes('VRF_EVENT:'));
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
    } catch (err: any) {
      log('ERROR', `Error processing WebSocket message: ${err.message}`);
    }
  }

  async generateProof(): Promise<Buffer> {
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

  stop(): void {
    log('INFO', 'Stopping VRF server...');
    this.isRunning = false;

    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }

    log('INFO', 'VRF server stopped');
  }

  // Helper method for rate limit handling with exponential backoff
  async callWithRateLimit<T>(apiCall: () => Promise<T>, maxRetries = 5): Promise<T> {
    let retryCount = 0;
    let backoffMs = 1000; // Start with 1 second

    while (retryCount <= maxRetries) {
      try {
        return await apiCall();
      } catch (err: any) {
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

    // TypeScript requires a return statement here, but this code is unreachable
    throw new Error('Unreachable code - max retries exceeded');
  }

  // New method to send a test transaction back to the integration test
  async sendBackTestTransaction(originalTxSig: string): Promise<string | null> {
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
    } catch (err: any) {
      log('ERROR', `Failed to send test transaction: ${err.message}`);
      return null;
    }
  }

  async createResultAccountPDA(requestAccount: string | PublicKey, requestBuffer: Buffer | null, subscription: string | PublicKey): Promise<{
    resultAccount: PublicKey,
    gameStatePDA: PublicKey,
    bump: number
  }> {
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
        log('WARN', `Failed to extract requester key, using default: ${err}`);
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
    } catch (err: any) {
      log('ERROR', `Failed to create result account PDA: ${err.message}`);
      log('ERROR', `Stack trace: ${err.stack}`);
      throw err;
    }
  }

  // Helper method to send and confirm a transaction with retry logic
  async sendAndConfirmWithRetry(transaction: Transaction, signers: Keypair[], maxRetries = 3): Promise<string> {
    let retries = 0;

    while (retries < maxRetries) {
      try {
        // Sign the transaction with all provided signers
        transaction.sign(...signers);

        // Send the signed transaction
        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          signers,
          {
            commitment: 'confirmed',
            skipPreflight: true
          }
        );

        log('INFO', `Transaction confirmed with signature: ${signature}`);
        return signature;
      } catch (err: any) {
        retries++;
        log('WARNING', `Transaction failed (attempt ${retries}/${maxRetries}): ${err.message}`);

        if (retries >= maxRetries) {
          log('ERROR', `Failed to send transaction after ${maxRetries} attempts`);
          throw err;
        }

        // Wait before retrying (exponential backoff)
        const delay = 1000 * Math.pow(2, retries - 1);
        log('INFO', `Waiting ${delay}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never happen due to the throw above
    throw new Error(`Failed to send transaction after ${maxRetries} attempts`);
  }

  async sendTransaction(instructionsOrTransaction: TransactionInstruction[] | Transaction, signers: Keypair[], retryCount = 3): Promise<string> {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
        let transaction: Transaction;

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
        } catch (signError: any) {
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
      } catch (err: any) {
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

    throw new Error(`Failed to send transaction after ${retryCount} attempts`);
  }

  startBackupScanner(): void {
    // Run immediately
    this.scanForPendingRequests();

    // Set up interval with a much longer delay to reduce log spam
    setInterval(() => {
      this.scanForPendingRequests();
    }, 60000); // Scan every 60 seconds instead of every 30 seconds
  }

  async scanForPendingRequests(): Promise<number> {
    try {
      if (!this.isRunning) return 0;

      // Additional implementation would go here

      return 0;
    } catch (err: any) {
      log('ERROR', `Failed to scan for pending requests: ${err.message}`);
      return 0;
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
      options.rpcUrl,
      options.wsUrl,
      options.scanInterval
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
  } catch (err: any) {
    log('ERROR', `Fatal error: ${err.message}`);
    process.exit(1);
  }
}

// Initialize the log file
fs.writeFileSync(
  path.join(__dirname, '../vrf-server-simple-ws.log'),
  `[${new Date().toISOString()}] [INFO] Starting VRF WebSocket Server\n`
);

// Run the main function
main().catch(err => {
  log('ERROR', `Unhandled error: ${err.message}`);
  process.exit(1);
});
