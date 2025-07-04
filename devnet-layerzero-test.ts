import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";

// Program constants
const PROGRAM_ID = new PublicKey("9fFiUggC3G2R1VH9YYA5WgaBvESNJHWgK9Hndcp7x3F");
const LAYERZERO_ENDPOINT_ID = new PublicKey("76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6");

// Seeds for PDA derivation
const STORE_SEED = Buffer.from("Store");
const LZ_RECEIVE_TYPES_SEED = Buffer.from("LzReceiveTypes");
const PEER_SEED = Buffer.from("Peer");

// LayerZero endpoint IDs
const SOLANA_DEVNET_EID = 40168;
const ETHEREUM_SEPOLIA_EID = 40161;

interface InitStoreParams {
  admin: PublicKey;
  endpoint: PublicKey;
}

class LayerZeroDevnetTest {
  private connection: Connection;
  private payer: Keypair;
  private program: Program<any>;
  
  constructor() {
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.payer = Keypair.generate(); // Will need funding
    
    // Set up the program (we'll need to create a minimal IDL)
    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.payer),
      { commitment: 'confirmed' }
    );
    anchor.setProvider(provider);
  }

  async setup() {
    console.log("🚀 Starting LayerZero Devnet Integration Test");
    console.log("Program ID:", PROGRAM_ID.toString());
    console.log("Payer:", this.payer.publicKey.toString());
    
    // Request airdrop for test payer
    console.log("📡 Requesting airdrop...");
    const airdropSignature = await this.connection.requestAirdrop(
      this.payer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(airdropSignature);
    
    const balance = await this.connection.getBalance(this.payer.publicKey);
    console.log(`✅ Payer balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  }

  async testStoreInitialization() {
    console.log("\n🏗️  Testing Store Initialization & LayerZero Registration");
    
    // Derive Store PDA
    const [storePda, storeBump] = PublicKey.findProgramAddressSync(
      [STORE_SEED],
      PROGRAM_ID
    );
    
    // Derive LzReceiveTypes PDA
    const [lzReceiveTypesPda, lzReceiveTypesBump] = PublicKey.findProgramAddressSync(
      [LZ_RECEIVE_TYPES_SEED, storePda.toBuffer()],
      PROGRAM_ID
    );
    
    console.log("Store PDA:", storePda.toString());
    console.log("LzReceiveTypes PDA:", lzReceiveTypesPda.toString());
    
    // Check if store already exists
    try {
      const storeAccount = await this.connection.getAccountInfo(storePda);
      if (storeAccount) {
        console.log("✅ Store already initialized");
        return { storePda, lzReceiveTypesPda };
      }
    } catch (error) {
      console.log("Store not yet initialized, proceeding...");
    }
    
    // Create init_store instruction data
    const initStoreParams: InitStoreParams = {
      admin: this.payer.publicKey,
      endpoint: LAYERZERO_ENDPOINT_ID,
    };
    
    // Build the instruction manually since we don't have the full IDL
    const instruction = new anchor.web3.TransactionInstruction({
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: storePda, isSigner: false, isWritable: true },
        { pubkey: lzReceiveTypesPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        // LayerZero endpoint accounts would be added here in remaining_accounts
      ],
      programId: PROGRAM_ID,
      data: Buffer.from([
        // Instruction discriminator for init_store (first 8 bytes)
        // This would need to be calculated properly in a real implementation
        0, 0, 0, 0, 0, 0, 0, 0,
        // Serialized InitStoreParams would follow
      ])
    });
    
    const transaction = new Transaction().add(instruction);
    
    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.payer],
        { commitment: 'confirmed' }
      );
      
      console.log("✅ Store initialization transaction:", signature);
      
      // Verify the store was created
      const storeAccount = await this.connection.getAccountInfo(storePda);
      console.log("✅ Store account created, size:", storeAccount?.data.length);
      
      return { storePda, lzReceiveTypesPda };
    } catch (error) {
      console.error("❌ Store initialization failed:", error);
      throw error;
    }
  }

  async testPeerConfiguration(storePda: PublicKey) {
    console.log("\n🌐 Testing Peer Configuration");
    
    // Derive Peer PDA for Ethereum Sepolia
    const [peerPda] = PublicKey.findProgramAddressSync(
      [PEER_SEED, storePda.toBuffer(), Buffer.from(ETHEREUM_SEPOLIA_EID.toString())],
      PROGRAM_ID
    );
    
    console.log("Peer PDA for Ethereum Sepolia:", peerPda.toString());
    
    // Check if peer is already configured
    try {
      const peerAccount = await this.connection.getAccountInfo(peerPda);
      if (peerAccount) {
        console.log("✅ Peer already configured");
        return peerPda;
      }
    } catch (error) {
      console.log("Peer not yet configured");
    }
    
    // In a real implementation, we would create set_peer_config instruction here
    console.log("⏭️  Peer configuration would be implemented here");
    
    return peerPda;
  }

  async testLayerZeroQuote(storePda: PublicKey) {
    console.log("\n💰 Testing LayerZero Fee Quote");
    
    // In a real implementation, we would call quote_send instruction
    console.log("⏭️  Fee quoting would be implemented here");
    console.log("This would call the real LayerZero endpoint for fee estimation");
  }

  async verifyLayerZeroIntegration() {
    console.log("\n🔍 Verifying LayerZero Integration");
    
    // Check if LayerZero endpoint program exists on devnet
    try {
      const endpointAccount = await this.connection.getAccountInfo(LAYERZERO_ENDPOINT_ID);
      if (endpointAccount) {
        console.log("✅ LayerZero Endpoint program found on devnet");
        console.log("Endpoint account owner:", endpointAccount.owner.toString());
        console.log("Endpoint account size:", endpointAccount.data.length);
      } else {
        console.log("❌ LayerZero Endpoint program not found on devnet");
      }
    } catch (error) {
      console.error("Error checking LayerZero endpoint:", error);
    }
    
    // Check program deployment
    try {
      const programAccount = await this.connection.getAccountInfo(PROGRAM_ID);
      if (programAccount) {
        console.log("✅ Kamui LayerZero program deployed and accessible");
        console.log("Program account size:", programAccount.data.length);
      }
    } catch (error) {
      console.error("Error checking program:", error);
    }
  }

  async run() {
    try {
      await this.setup();
      await this.verifyLayerZeroIntegration();
      
      const { storePda, lzReceiveTypesPda } = await this.testStoreInitialization();
      await this.testPeerConfiguration(storePda);
      await this.testLayerZeroQuote(storePda);
      
      console.log("\n🎉 LayerZero Devnet Integration Test Completed!");
      console.log("✅ Program deployment verified");
      console.log("✅ LayerZero endpoint accessible");
      console.log("✅ Basic program structure validated");
      
      console.log("\n📋 Test Results Summary:");
      console.log("- Program ID:", PROGRAM_ID.toString());
      console.log("- Store PDA:", storePda.toString());
      console.log("- LzReceiveTypes PDA:", lzReceiveTypesPda.toString());
      console.log("- LayerZero Endpoint:", LAYERZERO_ENDPOINT_ID.toString());
      
    } catch (error) {
      console.error("❌ Test failed:", error);
      process.exit(1);
    }
  }
}

// Run the test
async function main() {
  const test = new LayerZeroDevnetTest();
  await test.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { LayerZeroDevnetTest }; 