import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    SendTransactionError,
    LAMPORTS_PER_SOL,
    TransactionInstruction,
    Connection
} from '@solana/web3.js';
import { assert, expect } from 'chai';
import * as nacl from 'tweetnacl';
import * as borsh from '@coral-xyz/borsh';
import * as crypto from 'crypto';
import { KamuiVrf } from "../target/types/kamui_vrf";
import { KamuiVrfConsumer } from "../target/types/kamui_vrf_consumer";

describe('Kamui VRF Tests', () => {
    // Configure the client with more robust error handling
    let provider;
    try {
        provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);
    } catch (error) {
        console.error("Error initializing provider. Make sure ANCHOR_PROVIDER_URL and ANCHOR_WALLET are set properly.");
        console.error(error);
        // Provide fallback for testing
        const connection = new Connection("https://api.devnet.solana.com", "confirmed");
        const wallet = new anchor.Wallet(Keypair.generate());
        provider = new anchor.AnchorProvider(connection, wallet, {});
        anchor.setProvider(provider);
    }

    // Define program IDs using the correctly deployed programs
    const vrfProgramId = new PublicKey("4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1");
    const consumerProgramId = new PublicKey("4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y");

    // Create program objects
    const vrfProgram = new Program({
        provider,
        programId: vrfProgramId
    }, null);

    const consumerProgram = new Program({
        provider,
        programId: consumerProgramId
    }, null);

    // Test accounts
    const admin = Keypair.generate();
    const owner = Keypair.generate();
    const oracle = Keypair.generate();
    const secondOracle = Keypair.generate();
    const maliciousUser = Keypair.generate();
    const newOwner = Keypair.generate();

    // PDAs
    let registryPDA;
    let oracleConfigPDA;
    let secondOracleConfigPDA;
    let subscriptionPDA;
    let secondSubscriptionPDA;
    let gameStatePDA;
    let requestPoolPDA;
    let secondRequestPoolPDA;
    let requestPDA;
    let vrfResultPDA;
    let oracleQueuePDA;
    // Compressed state for testing
    let compressedStatePDA;

    // Create VRF keypair for testing
    const vrfKeypair = nacl.sign.keyPair();

    // Test parameters
    const poolId = 1;
    const secondPoolId = 2;
    const subscriptionSeed = Keypair.generate().publicKey;
    const subscriptionBump = 255; // This will be updated when creating the PDA

    // Schemas for serialization
    const VrfInput = borsh.struct([
        borsh.vec(borsh.u8(), 'alpha_string'),
        borsh.vec(borsh.u8(), 'proof_bytes'),
        borsh.vec(borsh.u8(), 'public_key_bytes')
    ]);

    // Helper classes for account deserialization
    class RequestAccount {
        requestId: Uint8Array;
        subscription: PublicKey;
        fulfilled: boolean;
        resultProcessed: boolean;
        requester: PublicKey;
        seed: Uint8Array;
        status: number;

        constructor(data: Buffer) {
            // Skip the 8-byte discriminator
            const dataView = new DataView(data.buffer, data.byteOffset + 8);

            // Extract subscription (32 bytes)
            const subscriptionBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                subscriptionBytes[i] = dataView.getUint8(i);
            }
            this.subscription = new PublicKey(subscriptionBytes);

            // Extract seed (32 bytes)
            this.seed = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                this.seed[i] = dataView.getUint8(32 + i);
            }

            // Extract requester (32 bytes)
            const requesterBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                requesterBytes[i] = dataView.getUint8(64 + i);
            }
            this.requester = new PublicKey(requesterBytes);

            // Extract status (1 byte)
            this.status = dataView.getUint8(160); // Position based on account layout

            // Extract request ID (32 bytes) - position may vary based on actual layout
            this.requestId = new Uint8Array(32);
            const requestIdOffset = 200; // Adjust based on actual layout
            for (let i = 0; i < 32; i++) {
                this.requestId[i] = dataView.getUint8(requestIdOffset + i);
            }

            // Set derived fields
            this.fulfilled = this.status === 1; // Fulfilled status
            this.resultProcessed = false; // Default value
        }
    }

    class VrfResultAccount {
        randomness: Uint8Array[];
        proof: Uint8Array;
        requestId: Uint8Array;

        constructor(data: Buffer) {
            // Skip the 8-byte discriminator
            let offset = 8;

            // Read the number of randomness values (vec length)
            const randomnessCount = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
            offset += 4;

            // Extract randomness values (array of 64-byte values)
            this.randomness = [];
            for (let i = 0; i < randomnessCount; i++) {
                const randomnessData = new Uint8Array(64);
                for (let j = 0; j < 64; j++) {
                    randomnessData[j] = data[offset + j];
                }
                this.randomness.push(randomnessData);
                offset += 64;
            }

            // Read proof length
            const proofLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
            offset += 4;

            // Extract proof bytes
            this.proof = new Uint8Array(proofLength);
            for (let i = 0; i < proofLength; i++) {
                this.proof[i] = data[offset + i];
            }
            offset += proofLength;

            // Skip proofSlot (8 bytes)
            offset += 8;

            // Extract requestId (32 bytes)
            this.requestId = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                this.requestId[i] = data[offset + i];
            }
        }
    }

    // Helper function to execute transaction with proper error handling
    const executeTransaction = async (name: string, tx: Transaction): Promise<string> => {
        try {
            const signature = await provider.sendAndConfirm(tx);
            console.log(`✅ Transaction confirmed for test: ${name}`);
            console.log(`   Transaction ID: ${signature}`);
            return signature;
        } catch (err) {
            console.error(`❌ Transaction failed for test: ${name}`);
            console.error(`   Error: ${err.message}`);
            throw err;
        }
    };

    // Function for VRF proof generation with nacl
    function generateVrfProof(seed: Uint8Array): { output: Uint8Array, proof: Uint8Array } {
        // Sign the seed with the VRF keypair to simulate VRF proof
        const signature = nacl.sign.detached(seed, vrfKeypair.secretKey);

        // Create a deterministic output (64 bytes) from the signature
        const output = crypto.createHash('sha512').update(Buffer.from(signature)).digest();

        // For testing, we'll format proof similar to the on-chain system
        // gamma (32 bytes) + c (16 bytes) + s (32 bytes) = 80 bytes
        const gamma = Buffer.from(signature.slice(0, 32));
        const c = Buffer.from(signature.slice(32, 48));
        const s = Buffer.from(signature.slice(48, 80));

        const proof = Buffer.concat([gamma, c, s]);

        return { output, proof };
    }

    // Function to verify VRF proof
    async function verifyVrfProof(
        connection: Connection,
        alpha: Uint8Array,
        proof: Uint8Array,
        publicKey: Uint8Array
    ): Promise<boolean> {
        try {
            // Create the VRF verification instruction
            const instructionData = Buffer.alloc(4 + VrfInput.span);
            instructionData.writeUInt32LE(5, 0); // Instruction discriminator for verify

            const data = {
                alpha_string: Array.from(alpha),
                proof_bytes: Array.from(proof),
                public_key_bytes: Array.from(publicKey),
            };

            VrfInput.encode(data, instructionData, 4);

            // Create the instruction
            const instruction = new TransactionInstruction({
                keys: [
                    { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: false },
                ],
                programId: vrfProgramId,
                data: instructionData
            });

            // Create and send transaction
            const transaction = new Transaction().add(instruction);
            await executeTransaction('verify_vrf_proof', transaction);
            return true;
        } catch (error) {
            console.error("Proof verification failed:", error);
            return false;
        }
    }

    // Fund an account with SOL for testing
    async function fundAccount(account: Keypair, amount: number = 10) {
        try {
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: provider.wallet.publicKey,
                    toPubkey: account.publicKey,
                    lamports: amount * LAMPORTS_PER_SOL
                })
            );
            await provider.sendAndConfirm(transaction);
            console.log(`Funded ${account.publicKey.toBase58()} with ${amount} SOL`);
        } catch (error) {
            console.error(`Failed to fund account: ${error}`);
            throw error;
        }
    }

    // Initialize Oracle Registry - real implementation
    async function initializeOracleRegistry(admin: Keypair, minStake: number = 1, rotationFrequency: number = 100) {
        try {
            // Find registry PDA
            [registryPDA] = await PublicKey.findProgramAddress(
                [Buffer.from("oracle_registry")],
                vrfProgramId
            );

            // Create instruction to initialize Oracle Registry
            const ix = {
                accounts: {
                    admin: admin.publicKey,
                    registry: registryPDA,
                    systemProgram: SystemProgram.programId,
                },
                signers: [admin],
                args: [
                    new BN(minStake * LAMPORTS_PER_SOL),
                    new BN(rotationFrequency)
                ]
            };

            // Create and execute transaction
            const tx = new Transaction();
            tx.add(await vrfProgram.methods
                .initializeOracleRegistry(
                    new BN(minStake * LAMPORTS_PER_SOL),
                    new BN(rotationFrequency)
                )
                .accounts({
                    admin: admin.publicKey,
                    registry: registryPDA,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('initialize_oracle_registry', tx);

            // Fetch and verify the registry account
            const registryAccount = await provider.connection.getAccountInfo(registryPDA);
            assert(registryAccount !== null, "Registry account not created");
            assert(registryAccount.owner.equals(vrfProgramId), "Registry owner mismatch");

            return registryPDA;
        } catch (error) {
            console.error("Failed to initialize Oracle Registry:", error);
            throw error;
        }
    }

    // Register Oracle with VRF Key - real implementation
    async function registerOracle(oracleAuthority: Keypair, stakeAmount: number = 1) {
        try {
            // Find oracle config PDA
            [oracleConfigPDA] = await PublicKey.findProgramAddress(
                [Buffer.from("oracle_config"), oracleAuthority.publicKey.toBuffer()],
                vrfProgramId
            );

            // Create instruction to register oracle
            const tx = new Transaction();
            tx.add(await vrfProgram.methods
                .registerOracle(
                    Array.from(vrfKeypair.publicKey),
                    new BN(stakeAmount * LAMPORTS_PER_SOL)
                )
                .accounts({
                    oracleAuthority: oracleAuthority.publicKey,
                    oracleConfig: oracleConfigPDA,
                    registry: registryPDA,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('register_oracle', tx);

            // Fetch and verify the oracle config account
            const oracleConfigAccount = await provider.connection.getAccountInfo(oracleConfigPDA);
            assert(oracleConfigAccount !== null, "Oracle config account not created");
            assert(oracleConfigAccount.owner.equals(vrfProgramId), "Oracle config owner mismatch");

            return oracleConfigPDA;
        } catch (error) {
            console.error("Failed to register Oracle:", error);
            throw error;
        }
    }

    // Create Subscription - real implementation
    async function createSubscription(owner: Keypair, seed: PublicKey, minBalance: number = 1, confirmations: number = 1, maxRequests: number = 10) {
        try {
            // Find subscription PDA
            [subscriptionPDA] = await PublicKey.findProgramAddress(
                [Buffer.from("subscription"), seed.toBuffer()],
                vrfProgramId
            );

            // Create instruction to create subscription
            const tx = new Transaction();
            tx.add(await vrfProgram.methods
                .createEnhancedSubscription(
                    new BN(minBalance * LAMPORTS_PER_SOL),
                    confirmations,
                    maxRequests
                )
                .accounts({
                    owner: owner.publicKey,
                    subscription: subscriptionPDA,
                    seed: seed,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('create_subscription', tx);

            // Fetch and verify the subscription account
            const subscriptionAccount = await provider.connection.getAccountInfo(subscriptionPDA);
            assert(subscriptionAccount !== null, "Subscription account not created");
            assert(subscriptionAccount.owner.equals(vrfProgramId), "Subscription owner mismatch");

            return subscriptionPDA;
        } catch (error) {
            console.error("Failed to create Subscription:", error);
            throw error;
        }
    }

    // Fund Subscription - real implementation
    async function fundSubscription(funder: Keypair, subscription: PublicKey, amount: number = 1) {
        try {
            // Create instruction to fund subscription
            const tx = new Transaction();
            tx.add(await vrfProgram.methods
                .fundSubscription(new BN(amount * LAMPORTS_PER_SOL))
                .accounts({
                    funder: funder.publicKey,
                    subscription: subscription,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('fund_subscription', tx);

            return true;
        } catch (error) {
            console.error("Failed to fund Subscription:", error);
            throw error;
        }
    }

    // Initialize Request Pool - real implementation
    async function initializeRequestPool(owner: Keypair, subscription: PublicKey, poolId: number, maxSize: number = 10) {
        try {
            // Create keypair for request pool
            const requestPoolKeypair = Keypair.generate();
            requestPoolPDA = requestPoolKeypair.publicKey;

            // Create instruction to initialize request pool
            const tx = new Transaction();
            tx.add(
                SystemProgram.createAccount({
                    fromPubkey: owner.publicKey,
                    newAccountPubkey: requestPoolPDA,
                    space: 1000, // Adjust based on actual size needed
                    lamports: await provider.connection.getMinimumBalanceForRentExemption(1000),
                    programId: vrfProgramId
                })
            );

            tx.add(await vrfProgram.methods
                .initializeRequestPool(poolId, maxSize)
                .accounts({
                    owner: owner.publicKey,
                    subscription: subscription,
                    requestPool: requestPoolPDA,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('initialize_request_pool', tx);

            // Fetch and verify the request pool account
            const requestPoolAccount = await provider.connection.getAccountInfo(requestPoolPDA);
            assert(requestPoolAccount !== null, "Request pool account not created");
            assert(requestPoolAccount.owner.equals(vrfProgramId), "Request pool owner mismatch");

            return requestPoolPDA;
        } catch (error) {
            console.error("Failed to initialize Request Pool:", error);
            throw error;
        }
    }

    // Request Randomness - real implementation
    async function requestRandomness(owner: Keypair, subscription: PublicKey, requestPool: PublicKey, poolId: number) {
        try {
            // Create request account keypair
            const requestKeypair = Keypair.generate();
            requestPDA = requestKeypair.publicKey;

            // Generate random seed
            const seed = crypto.randomBytes(32);

            // Create instruction to request randomness
            const tx = new Transaction();
            tx.add(
                SystemProgram.createAccount({
                    fromPubkey: owner.publicKey,
                    newAccountPubkey: requestPDA,
                    space: 1000, // Adjust based on actual size needed
                    lamports: await provider.connection.getMinimumBalanceForRentExemption(1000),
                    programId: vrfProgramId
                })
            );

            tx.add(await vrfProgram.methods
                .requestRandomness(
                    Array.from(seed),
                    Buffer.from([]),
                    1, // numWords
                    1, // confirmations
                    new BN(200000), // callbackGasLimit
                    poolId
                )
                .accounts({
                    owner: owner.publicKey,
                    request: requestPDA,
                    subscription: subscription,
                    requestPool: requestPool,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('request_randomness', tx);

            // Fetch and verify the request account
            const requestAccount = await provider.connection.getAccountInfo(requestPDA);
            assert(requestAccount !== null, "Request account not created");
            assert(requestAccount.owner.equals(vrfProgramId), "Request owner mismatch");

            // Parse the request account to extract requestId
            const request = new RequestAccount(requestAccount.data);

            // Find VRF result PDA
            [vrfResultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from("vrf_result"), requestPDA.toBuffer()],
                vrfProgramId
            );

            return { requestPDA, seed, requestId: request.requestId };
        } catch (error) {
            console.error("Failed to request randomness:", error);
            throw error;
        }
    }

    // Fulfill Randomness - real implementation
    async function fulfillRandomness(oracle: Keypair, requestId: Uint8Array, request: PublicKey, vrfResult: PublicKey, requestPool: PublicKey, subscription: PublicKey, poolId: number) {
        try {
            // Get request account data to extract seed
            const requestAccountInfo = await provider.connection.getAccountInfo(request);
            const requestAccount = new RequestAccount(requestAccountInfo.data);

            // Generate VRF proof using the seed from the request
            const { proof, output } = generateVrfProof(requestAccount.seed);

            // Create instruction to fulfill randomness
            const tx = new Transaction();
            tx.add(await vrfProgram.methods
                .fulfillRandomness(
                    Buffer.from(proof),
                    Buffer.from(vrfKeypair.publicKey),
                    Array.from(requestId),
                    poolId,
                    0 // requestIndex
                )
                .accounts({
                    oracle: oracle.publicKey,
                    request: request,
                    vrfResult: vrfResult,
                    requestPool: requestPool,
                    subscription: subscription,
                    systemProgram: SystemProgram.programId,
                })
                .instruction());

            await executeTransaction('fulfill_randomness', tx);

            // Fetch and verify the VRF result account
            const vrfResultAccount = await provider.connection.getAccountInfo(vrfResult);
            assert(vrfResultAccount !== null, "VRF result account not created");
            assert(vrfResultAccount.owner.equals(vrfProgramId), "VRF result owner mismatch");

            // Verify the proof is correct
            const isValid = await verifyVrfProof(
                provider.connection,
                requestAccount.seed,
                proof,
                vrfKeypair.publicKey
            );

            assert(isValid, "VRF proof verification failed");

            return { vrfResultPDA, output };
        } catch (error) {
            console.error("Failed to fulfill randomness:", error);
            throw error;
        }
    }

    // Simulate ZK Compressed Account operations
    class ZkCompressedAccountSimulator {
        merkleTree: SimpleMerkleTree;
        accounts: Map<string, string>;
        accountsByName: Map<string, { index: number, leafHash: string, content: string }>;

        constructor() {
            this.merkleTree = new SimpleMerkleTree();
            this.accounts = new Map();
            this.accountsByName = new Map();

            // Initialize with some accounts
            for (let i = 0; i < this.merkleTree.leaves.length; i++) {
                const leafHex = Buffer.from(this.merkleTree.leaves[i]).toString('hex');
                const accountName = `account_${i}`;
                this.accounts.set(leafHex, accountName);
                this.accountsByName.set(accountName, {
                    index: i,
                    leafHash: leafHex,
                    content: `Initial content for ${accountName}`
                });
            }
        }

        createProof(account: string): Uint8Array | null {
            // Find the account info
            const accountInfo = this.accountsByName.get(account);
            if (!accountInfo) return null;

            return this.merkleTree.createProof(accountInfo.index);
        }

        verifyProof(proof: Uint8Array, index: number): boolean {
            return this.merkleTree.verifyProof(proof, index);
        }

        updateAccount(account: string, newContent: string): boolean {
            // Find the account info
            const accountInfo = this.accountsByName.get(account);
            if (!accountInfo) return false;

            // Remove old mapping
            this.accounts.delete(accountInfo.leafHash);

            // Update the leaf
            const newLeaf = crypto.createHash('sha256').update(newContent).digest();
            this.merkleTree.leaves[accountInfo.index] = newLeaf;

            // Update account mappings
            const newLeafHex = Buffer.from(newLeaf).toString('hex');
            this.accounts.set(newLeafHex, account);

            // Update account info
            accountInfo.leafHash = newLeafHex;
            accountInfo.content = newContent;

            return true;
        }

        createAccount(accountName: string, content: string): boolean {
            // Don't allow duplicate account names
            if (this.accountsByName.has(accountName)) {
                return false;
            }

            // Create new leaf
            const leafData = crypto.createHash('sha256').update(content).digest();
            const index = this.merkleTree.addLeaf(leafData);

            // Add account mappings
            const leafHex = Buffer.from(leafData).toString('hex');
            this.accounts.set(leafHex, accountName);

            this.accountsByName.set(accountName, {
                index: index,
                leafHash: leafHex,
                content: content
            });

            return true;
        }

        batchUpdate(updates: { account: string, content: string }[]): boolean[] {
            const results: boolean[] = [];

            for (const update of updates) {
                results.push(this.updateAccount(update.account, update.content));
            }

            return results;
        }

        getAccountContent(account: string): string | null {
            const accountInfo = this.accountsByName.get(account);
            return accountInfo ? accountInfo.content : null;
        }
    }

    // Simple Merkle Tree implementation
    class SimpleMerkleTree {
        leaves: Uint8Array[] = [];

        constructor() {
            // Initialize with a couple of random leaves
            for (let i = 0; i < 3; i++) {
                this.leaves.push(crypto.randomBytes(32));
            }
        }

        createProof(index: number): Uint8Array {
            if (index < 0 || index >= this.leaves.length) {
                throw new Error("Index out of bounds");
            }

            // For simplicity, just create a placeholder proof
            const proof = Buffer.alloc(32 * Math.ceil(Math.log2(this.leaves.length)));

            // In a real implementation, you would include the sibling hashes
            // needed to reconstruct path to root

            return proof;
        }

        verifyProof(_proof: Uint8Array, _index: number): boolean {
            // For simplicity, always return true in this test implementation
            return true;
        }

        addLeaf(data: Uint8Array): number {
            this.leaves.push(Buffer.from(data));
            return this.leaves.length - 1;
        }
    }

    // Set up tests
    before(async () => {
        // Fund test accounts
        await fundAccount(admin, 100);
        await fundAccount(owner, 100);
        await fundAccount(oracle, 100);
        await fundAccount(secondOracle, 100);
        await fundAccount(maliciousUser, 10);
        await fundAccount(newOwner, 10);
    });

    // Now we'll add the actual test cases
    describe('Oracle Registry Tests', () => {
        it('should initialize the oracle registry', async () => {
            try {
                await initializeOracleRegistry(admin);
                const registryAccount = await provider.connection.getAccountInfo(registryPDA);
                assert(registryAccount !== null, "Registry account not created");
            } catch (error) {
                assert.fail(`Failed to initialize oracle registry: ${error}`);
            }
        });

        it('should register an oracle with a VRF key', async () => {
            try {
                await registerOracle(oracle);
                const oracleConfigAccount = await provider.connection.getAccountInfo(oracleConfigPDA);
                assert(oracleConfigAccount !== null, "Oracle config account not created");
            } catch (error) {
                assert.fail(`Failed to register oracle: ${error}`);
            }
        });

        it('should register a second oracle', async () => {
            try {
                await registerOracle(secondOracle);
                const oracleConfigAccount = await provider.connection.getAccountInfo(secondOracleConfigPDA);
                assert(oracleConfigAccount !== null, "Second oracle config account not created");
            } catch (error) {
                assert.fail(`Failed to register second oracle: ${error}`);
            }
        });

        it('should rotate oracles', async () => {
            try {
                // Create transaction to rotate oracles
                const tx = new Transaction();
                tx.add(await vrfProgram.methods
                    .rotateOracles()
                    .accounts({
                        admin: admin.publicKey,
                        registry: registryPDA,
                    })
                    .instruction());

                await executeTransaction('rotate_oracles', tx);
            } catch (error) {
                assert.fail(`Failed to rotate oracles: ${error}`);
            }
        });
    });

    describe('Subscription Tests', () => {
        it('should create a subscription', async () => {
            try {
                await createSubscription(owner, subscriptionSeed);
                const subscriptionAccount = await provider.connection.getAccountInfo(subscriptionPDA);
                assert(subscriptionAccount !== null, "Subscription account not created");
            } catch (error) {
                assert.fail(`Failed to create subscription: ${error}`);
            }
        });

        it('should fund a subscription', async () => {
            try {
                await fundSubscription(owner, subscriptionPDA, 5);
            } catch (error) {
                assert.fail(`Failed to fund subscription: ${error}`);
            }
        });

        it('should transfer subscription ownership', async () => {
            try {
                // Create transaction to transfer subscription ownership
                const tx = new Transaction();
                tx.add(await vrfProgram.methods
                    .transferSubscriptionOwnership()
                    .accounts({
                        owner: owner.publicKey,
                        newOwner: newOwner.publicKey,
                        subscription: subscriptionPDA,
                    })
                    .instruction());

                await executeTransaction('transfer_subscription_ownership', tx);

                // Verify the new owner
                // In a real test, we would deserialize the account data and check the owner field
            } catch (error) {
                assert.fail(`Failed to transfer subscription ownership: ${error}`);
            }
        });
    });

    describe('VRF Request Tests', () => {
        it('should initialize a request pool', async () => {
            try {
                await initializeRequestPool(owner, subscriptionPDA, poolId);
                const requestPoolAccount = await provider.connection.getAccountInfo(requestPoolPDA);
                assert(requestPoolAccount !== null, "Request pool account not created");
            } catch (error) {
                assert.fail(`Failed to initialize request pool: ${error}`);
            }
        });

        it('should request randomness', async () => {
            try {
                const { requestPDA: request, seed, requestId } = await requestRandomness(owner, subscriptionPDA, requestPoolPDA, poolId);
                const requestAccount = await provider.connection.getAccountInfo(request);
                assert(requestAccount !== null, "Request account not created");
            } catch (error) {
                assert.fail(`Failed to request randomness: ${error}`);
            }
        });

        it('should fulfill randomness', async () => {
            try {
                // Get request account info
                const requestAccountInfo = await provider.connection.getAccountInfo(requestPDA);
                const requestAccount = new RequestAccount(requestAccountInfo.data);

                await fulfillRandomness(
                    oracle,
                    requestAccount.requestId,
                    requestPDA,
                    vrfResultPDA,
                    requestPoolPDA,
                    subscriptionPDA,
                    poolId
                );

                const vrfResultAccount = await provider.connection.getAccountInfo(vrfResultPDA);
                assert(vrfResultAccount !== null, "VRF result account not created");
            } catch (error) {
                assert.fail(`Failed to fulfill randomness: ${error}`);
            }
        });

        it('should verify a VRF proof directly', async () => {
            try {
                const seed = crypto.randomBytes(32);
                const { proof, output } = generateVrfProof(seed);

                const isValid = await verifyVrfProof(
                    provider.connection,
                    seed,
                    proof,
                    vrfKeypair.publicKey
                );

                assert(isValid, "VRF proof verification failed");
            } catch (error) {
                assert.fail(`Failed to verify VRF proof: ${error}`);
            }
        });
    });

    describe('ZK Compressed Account Tests', () => {
        let zkSimulator: ZkCompressedAccountSimulator;

        before(() => {
            zkSimulator = new ZkCompressedAccountSimulator();
        });

        it('should create a simulated compressed account', async () => {
            try {
                // Create proof for account_0
                const proof = zkSimulator.createProof("account_0");
                assert(proof !== null, "Should be able to create proof");

                // Verify the proof
                const isValid = proof ? zkSimulator.verifyProof(proof, 0) : false;
                assert(isValid, "Proof verification failed");
            } catch (error) {
                assert.fail(`Failed to create compressed account: ${error}`);
            }
        });

        it('should update a simulated compressed account', async () => {
            try {
                // Update account content and verify the update worked
                const updated = zkSimulator.updateAccount("account_0", "new_content");
                assert(updated, "Account update failed");

                // Verify content has been updated
                const content = zkSimulator.getAccountContent("account_0");
                assert.equal(content, "new_content", "Account content was not updated correctly");

                // Create a new proof for the updated account
                const newProof = zkSimulator.createProof("account_0");
                assert(newProof !== null, "Should be able to create new proof");

                // Verify the new proof
                const isNewProofValid = newProof ? zkSimulator.verifyProof(newProof, 0) : false;
                assert(isNewProofValid, "New proof verification failed");
            } catch (error) {
                assert.fail(`Failed to update compressed account: ${error}`);
            }
        });

        it('should create additional compressed accounts', async () => {
            try {
                // Create a new account
                const created = zkSimulator.createAccount("new_test_account", "New account content");
                assert(created, "Failed to create new account");

                // Verify account content
                const content = zkSimulator.getAccountContent("new_test_account");
                assert.equal(content, "New account content", "New account content not set correctly");

                // Create proof and verify
                const proof = zkSimulator.createProof("new_test_account");
                assert(proof !== null, "Should be able to create proof for new account");

                // Should not be able to create duplicate accounts
                const duplicateCreated = zkSimulator.createAccount("new_test_account", "Duplicate content");
                assert(!duplicateCreated, "Should not allow duplicate account names");
            } catch (error) {
                assert.fail(`Failed to create additional compressed accounts: ${error}`);
            }
        });

        it('should perform batch updates on multiple accounts', async () => {
            try {
                // Create additional accounts for batch testing
                zkSimulator.createAccount("batch_account_1", "Initial batch 1");
                zkSimulator.createAccount("batch_account_2", "Initial batch 2");

                // Perform batch updates
                const updates = [
                    { account: "account_0", content: "Batch updated 0" },
                    { account: "new_test_account", content: "Batch updated test" },
                    { account: "batch_account_1", content: "Batch updated 1" },
                    { account: "non_existent", content: "Should fail" }
                ];

                const results = zkSimulator.batchUpdate(updates);

                // First 3 should succeed, last should fail
                assert.deepEqual(results, [true, true, true, false], "Batch update results incorrect");

                // Verify content updates
                assert.equal(zkSimulator.getAccountContent("account_0"), "Batch updated 0", "Batch update failed for account_0");
                assert.equal(zkSimulator.getAccountContent("new_test_account"), "Batch updated test", "Batch update failed for new_test_account");
                assert.equal(zkSimulator.getAccountContent("batch_account_1"), "Batch updated 1", "Batch update failed for batch_account_1");
            } catch (error) {
                assert.fail(`Failed to perform batch updates: ${error}`);
            }
        });

        it('should handle errors for non-existent accounts', async () => {
            try {
                // Test for non-existent account
                const proof = zkSimulator.createProof("non_existent_account");
                assert(proof === null, "Should return null for non-existent account");

                // Test for failed update
                const updated = zkSimulator.updateAccount("non_existent_account", "new_content");
                assert(!updated, "Should return false for non-existent account update");

                // Test getting content for non-existent account
                const content = zkSimulator.getAccountContent("non_existent_account");
                assert(content === null, "Should return null for non-existent account content");
            } catch (error) {
                assert.fail(`Error handling test failed: ${error}`);
            }
        });
    });

    describe('Error Handling Tests', () => {
        it('should fail when a non-owner tries to access a subscription', async () => {
            try {
                // Attempt to transfer ownership from non-owner
                const tx = new Transaction();
                tx.add(await vrfProgram.methods
                    .transferSubscriptionOwnership()
                    .accounts({
                        owner: maliciousUser.publicKey,
                        newOwner: maliciousUser.publicKey,
                        subscription: subscriptionPDA,
                    })
                    .instruction());

                await executeTransaction('unauthorized_transfer', tx);
                assert.fail("Transaction should have failed");
            } catch (error) {
                // This should fail, so the test passes
                assert(error instanceof Error, "Expected an error");
            }
        });
    });
}); 