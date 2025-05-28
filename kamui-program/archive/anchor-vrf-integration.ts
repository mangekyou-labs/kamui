const anchor = require('@coral-xyz/anchor');
const { PublicKey, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const { assert } = require('chai');
const nacl = require('tweetnacl');

describe('Kamui VRF Integration Tests', () => {
    // Configure the client
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load programs from workspace using deployed program IDs
    const vrfProgram = anchor.workspace.KamuiVrf;
    const consumerProgram = anchor.workspace.KamuiVrfConsumer;

    // Generate test keys
    const admin = Keypair.generate();
    const owner = Keypair.generate();
    const oracle = Keypair.generate();
    const vrfKeypair = Keypair.generate();

    // PDAs
    let registryPDA;
    let oracleConfigPDA;
    let subscriptionPDA;
    let gameStatePDA;
    let requestPoolPDA;

    // Test variables
    let requestPDA;
    let vrfResultPDA;
    let seed;
    let gameBump;
    let requestId;

    const poolId = 1;

    before(async () => {
        // Fund test accounts
        const fundTx = new Transaction();
        fundTx.add(
            SystemProgram.transfer({
                fromPubkey: provider.wallet.publicKey,
                toPubkey: admin.publicKey,
                lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
            }),
            SystemProgram.transfer({
                fromPubkey: provider.wallet.publicKey,
                toPubkey: owner.publicKey,
                lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
            }),
            SystemProgram.transfer({
                fromPubkey: provider.wallet.publicKey,
                toPubkey: oracle.publicKey,
                lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
            })
        );
        await provider.sendAndConfirm(fundTx);

        // Derive PDAs
        [registryPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('oracle_registry')],
            vrfProgram.programId
        );

        [oracleConfigPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('oracle_config'), oracle.publicKey.toBuffer()],
            vrfProgram.programId
        );

        // Create a random seed for subscription
        const subscriptionSeed = Keypair.generate();
        [subscriptionPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('subscription'), subscriptionSeed.publicKey.toBuffer()],
            vrfProgram.programId
        );

        [gameStatePDA, gameBump] = await PublicKey.findProgramAddress(
            [Buffer.from('game'), owner.publicKey.toBuffer()],
            consumerProgram.programId
        );

        [requestPoolPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('request_pool'), subscriptionPDA.toBuffer(), Buffer.from([poolId])],
            vrfProgram.programId
        );

        // Generate random seed for VRF request
        seed = nacl.randomBytes(32);
    });

    it('Initializes Oracle Registry', async () => {
        await vrfProgram.methods
            .initializeOracleRegistry(
                new anchor.BN(10_000_000), // min stake
                new anchor.BN(500)         // rotation frequency
            )
            .accounts({
                admin: admin.publicKey,
                registry: registryPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

        const registry = await vrfProgram.account.oracleRegistry.fetch(registryPDA);
        assert.equal(registry.admin.toString(), admin.publicKey.toString());
        assert.equal(registry.oracleCount, 0);
        assert.equal(registry.minStake.toString(), '10000000');
    });

    it('Registers an Oracle', async () => {
        // Convert pubkey to bytes for VRF key
        const vrfKey = Array.from(vrfKeypair.publicKey.toBytes().slice(0, 32));

        await vrfProgram.methods
            .registerOracle(
                Buffer.from(vrfKey),
                new anchor.BN(10_000_000) // stake amount
            )
            .accounts({
                oracleAuthority: oracle.publicKey,
                oracleConfig: oracleConfigPDA,
                registry: registryPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([oracle])
            .rpc();

        const oracleConfig = await vrfProgram.account.enhancedOracle.fetch(oracleConfigPDA);
        assert.equal(oracleConfig.authority.toString(), oracle.publicKey.toString());
        assert.isTrue(oracleConfig.isActive);
    });

    it('Creates a Subscription with random seed', async () => {
        // Random seed account for subscription creation
        const seedAccount = Keypair.generate();

        await vrfProgram.methods
            .createEnhancedSubscription(
                new anchor.BN(1_000_000), // min balance
                1,                        // confirmations
                10                       // max requests
            )
            .accounts({
                owner: owner.publicKey,
                subscription: subscriptionPDA,
                seed: seedAccount.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([owner, seedAccount])
            .rpc();

        const subscription = await vrfProgram.account.enhancedSubscription.fetch(subscriptionPDA);
        assert.equal(subscription.owner.toString(), owner.publicKey.toString());
        assert.equal(subscription.balance.toString(), '0');
        assert.equal(subscription.activeRequests, 0);
    });

    it('Funds the Subscription', async () => {
        await vrfProgram.methods
            .fundSubscription(
                new anchor.BN(50_000_000) // amount
            )
            .accounts({
                funder: owner.publicKey,
                subscription: subscriptionPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([owner])
            .rpc();

        const subscription = await vrfProgram.account.enhancedSubscription.fetch(subscriptionPDA);
        assert.equal(subscription.balance.toString(), '50000000');
    });

    it('Initializes a Request Pool', async () => {
        await vrfProgram.methods
            .initializeRequestPool(
                poolId,
                100 // max size
            )
            .accounts({
                owner: owner.publicKey,
                subscription: subscriptionPDA,
                requestPool: requestPoolPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([owner])
            .rpc();

        const pool = await vrfProgram.account.requestPool.fetch(requestPoolPDA);
        assert.equal(pool.subscription.toString(), subscriptionPDA.toString());
        assert.equal(pool.poolId, poolId);
        assert.equal(pool.requestCount, 0);
    });

    it('Initializes Game State on Consumer', async () => {
        await consumerProgram.methods
            .initialize(gameBump)
            .accounts({
                owner: owner.publicKey,
                gameState: gameStatePDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([owner])
            .rpc();

        const gameState = await consumerProgram.account.gameState.fetch(gameStatePDA);
        assert.equal(gameState.owner.toString(), owner.publicKey.toString());
        assert.equal(gameState.result.toString(), '0');
    });

    it('Requests randomness from VRF service', async () => {
        // Generate request ID and PDA
        // In a real implementation this would be more deterministic based on input params
        requestId = nacl.randomBytes(32);

        [requestPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('vrf_request'), requestId],
            vrfProgram.programId
        );

        // For test simplicity, we'll request randomness directly on the VRF program
        // In a real implementation, the consumer would use CPI
        await vrfProgram.methods
            .requestRandomness(
                Array.from(seed),
                Array.from(gameStatePDA.toBuffer()), // Callback data points to game state
                1,                                   // Number of words
                1,                                   // Confirmations
                100_000,                             // Callback gas limit
                poolId
            )
            .accounts({
                owner: owner.publicKey,
                request: requestPDA,
                subscription: subscriptionPDA,
                requestPool: requestPoolPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([owner])
            .rpc();

        const request = await vrfProgram.account.randomnessRequest.fetch(requestPDA);
        assert.equal(request.subscription.toString(), subscriptionPDA.toString());
        assert.equal(request.status.pending !== undefined, true);

        // Update the game state with request info
        await consumerProgram.account.gameState.fetch(gameStatePDA);
    });

    it('Fulfills randomness with direct proof generation', async () => {
        // Get the request ID from the request account  
        const request = await vrfProgram.account.randomnessRequest.fetch(requestPDA);

        // Find the VRF result PDA
        [vrfResultPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('vrf_result'), requestPDA.toBuffer()],
            vrfProgram.programId
        );

        // In a real implementation, we would generate a proper VRF proof
        // For testing, we'll create a simple deterministic "proof"
        const mockProof = Buffer.alloc(80); // 32 (gamma) + 16 (c) + 32 (s)

        // Copy seed data to mockProof buffer
        Buffer.from(seed).copy(mockProof, 0, 0, 32);     // gamma = seed
        Buffer.from(seed).copy(mockProof, 32, 0, 16);    // c = first 16 bytes of seed
        Buffer.from(nacl.randomBytes(32)).copy(mockProof, 48); // s = random

        await vrfProgram.methods
            .fulfillRandomness(
                Array.from(mockProof),
                Array.from(vrfKeypair.publicKey.toBytes()),
                Array.from(request.requestId),
                poolId,
                request.requestIndex
            )
            .accounts({
                oracle: oracle.publicKey,
                request: requestPDA,
                vrfResult: vrfResultPDA,
                requestPool: requestPoolPDA,
                subscription: subscriptionPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([oracle])
            .rpc();

        const result = await vrfProgram.account.vrfResult.fetch(vrfResultPDA);
        assert.isTrue(result.randomness.length > 0);
    });

    it('Consumes randomness in the consumer program', async () => {
        // Get the generated randomness
        const result = await vrfProgram.account.vrfResult.fetch(vrfResultPDA);
        const randomnessBytes = result.randomness[0]; // First word of randomness

        await consumerProgram.methods
            .consumeRandomness(randomnessBytes)
            .accounts({
                caller: owner.publicKey,
                gameState: gameStatePDA,
            })
            .signers([owner])
            .rpc();

        const gameState = await consumerProgram.account.gameState.fetch(gameStatePDA);
        console.log(`Game result from randomness: ${gameState.result}`);
        assert.isTrue(gameState.result.gt(new anchor.BN(0)));
        assert.isTrue(gameState.result.lte(new anchor.BN(100)));
    });
}); 