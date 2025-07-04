const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, setProvider } = require('@project-serum/anchor');

// Program configuration
const PROGRAM_ID = new PublicKey('F22ggNghzGGVzkoWqQau72RLPk8WChjWtMp6mwBGgfBd');
const DEVNET_RPC = 'https://api.devnet.solana.com';

async function verifyDeployedProgram() {
    console.log('🧪 Testing Deployed LayerZero Program...\n');
    
    // Set up connection
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    
    try {
        // 1. Verify program account exists and is executable
        console.log('📋 Step 1: Verifying program account...');
        const programAccount = await connection.getAccountInfo(PROGRAM_ID);
        
        if (!programAccount) {
            throw new Error('Program account not found!');
        }
        
        if (!programAccount.executable) {
            throw new Error('Program account exists but is not executable!');
        }
        
        console.log('✅ Program account exists and is executable');
        console.log(`   - Owner: ${programAccount.owner.toString()}`);
        console.log(`   - Data Length: ${programAccount.data.length} bytes`);
        console.log(`   - Lamports: ${programAccount.lamports / 1e9} SOL\n`);
        
        // 2. Test basic program interaction
        console.log('📋 Step 2: Testing basic program accessibility...');
        
        // Check if program has the expected BPF loader
        const expectedLoader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
        if (programAccount.owner.equals(expectedLoader)) {
            console.log('✅ Program uses correct BPF Upgradeable Loader');
        } else {
            console.log('⚠️  Program uses different loader:', programAccount.owner.toString());
        }
        
        // 3. Verify network connectivity and RPC
        console.log('\n📋 Step 3: Verifying network connectivity...');
        const slot = await connection.getSlot();
        console.log(`✅ Current devnet slot: ${slot}`);
        
        const blockhash = await connection.getLatestBlockhash();
        console.log(`✅ Latest blockhash: ${blockhash.blockhash.slice(0, 10)}...`);
        
        console.log('\n🎉 SUCCESS: LayerZero program deployment verification complete!');
        console.log('📝 Program is deployed, executable, and accessible on devnet.');
        return true;
        
    } catch (error) {
        console.error('❌ ERROR during verification:', error.message);
        return false;
    }
}

// Run the verification
verifyDeployedProgram()
    .then(success => {
        if (success) {
            console.log('\n✅ VERIFICATION PASSED: Task 3.7 deployment verification complete!');
            process.exit(0);
        } else {
            console.log('\n❌ VERIFICATION FAILED: Program deployment has issues');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n💥 FATAL ERROR:', error);
        process.exit(1);
    }); 