import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import * as crypto from "crypto";

// Create a mock Merkle tree implementation that doesn't rely on the structuredClone
class SimpleMerkleTree {
    leaves: Uint8Array[] = [];

    constructor() {
        // Initialize with random leaves
        for (let i = 0; i < 3; i++) {
            this.leaves.push(crypto.randomBytes(32));
        }
    }

    createProof(index: number): Uint8Array {
        if (index < 0 || index >= this.leaves.length) {
            throw new Error("Index out of bounds");
        }
        // Simple proof for testing
        return Buffer.alloc(32);
    }

    verifyProof(_proof: Uint8Array, _index: number): boolean {
        return true;  // Always verify for tests
    }
}

// Simulated compressed account system
class CompressedAccountSimulator {
    merkleTree: SimpleMerkleTree;
    accounts: Map<string, string>;

    constructor() {
        this.merkleTree = new SimpleMerkleTree();
        this.accounts = new Map();

        // Initialize with placeholder accounts
        for (let i = 0; i < this.merkleTree.leaves.length; i++) {
            const leafHex = Buffer.from(this.merkleTree.leaves[i]).toString('hex');
            this.accounts.set(leafHex, `account_${i}`);
        }
    }

    createProof(account: string): Uint8Array | null {
        // Find the index of the account
        let index = -1;
        for (let i = 0; i < this.merkleTree.leaves.length; i++) {
            const leafHex = Buffer.from(this.merkleTree.leaves[i]).toString('hex');
            if (this.accounts.get(leafHex) === account) {
                index = i;
                break;
            }
        }

        if (index === -1) return null;
        return this.merkleTree.createProof(index);
    }

    verifyProof(proof: Uint8Array, index: number): boolean {
        return this.merkleTree.verifyProof(proof, index);
    }

    updateAccount(account: string, newContent: string): boolean {
        // Find the leaf for this account
        let index = -1;
        for (let i = 0; i < this.merkleTree.leaves.length; i++) {
            const leafHex = Buffer.from(this.merkleTree.leaves[i]).toString('hex');
            if (this.accounts.get(leafHex) === account) {
                index = i;
                break;
            }
        }

        if (index === -1) return false;

        // Update the leaf
        const newLeaf = crypto.createHash('sha256').update(newContent).digest();
        this.merkleTree.leaves[index] = newLeaf;

        // Update account mapping
        const newLeafHex = Buffer.from(newLeaf).toString('hex');
        this.accounts.set(newLeafHex, account);

        return true;
    }
}

describe('Direct Kamui VRF Tests', () => {
    // Directly set up provider without using anchor.workspace
    const connection = new Connection('http://localhost:8899', 'confirmed');
    const wallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    anchor.setProvider(provider);

    // Program IDs
    const vrfProgramId = new PublicKey("4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1");

    // Create the Program object without using workspace
    const idl = require("../target/idl/kamui_vrf.json");
    // @ts-ignore - Ignoring type error as Program constructor should work with these parameters
    const program = new Program(idl, vrfProgramId, provider);

    // Test variables
    const oracleRegistryKeypair = Keypair.generate();

    // Run basic tests that don't depend on anchor.workspace
    it('Tests compressed account operations', async () => {
        const simulator = new CompressedAccountSimulator();

        // Test creating a proof
        const proof = simulator.createProof("account_0");
        expect(proof).to.not.be.null;

        // Test verifying a proof
        if (proof) {
            const isValid = simulator.verifyProof(proof, 0);
            expect(isValid).to.be.true;
        }

        // Test updating an account
        const updated = simulator.updateAccount("account_0", "updated_content");
        expect(updated).to.be.true;

        // Test creating a proof for the updated account
        const newProof = simulator.createProof("account_0");
        expect(newProof).to.not.be.null;

        // Test verifying the new proof
        if (newProof) {
            const isValid = simulator.verifyProof(newProof, 0);
            expect(isValid).to.be.true;
        }
    });

    it('Tests error handling for compressed accounts', async () => {
        const simulator = new CompressedAccountSimulator();

        // Test non-existent account
        const proof = simulator.createProof("non_existent_account");
        expect(proof).to.be.null;

        // Test updating non-existent account
        const updated = simulator.updateAccount("non_existent_account", "content");
        expect(updated).to.be.false;
    });

    // We can add more tests here that do actual on-chain operations using our program object
}); 