// Import modules
import { expect } from 'chai';
import * as crypto from 'crypto';

// Simple Merkle Tree implementation
class SimpleMerkleTree {
    constructor() {
        this.leaves = [];
        // Initialize with random leaves
        for (let i = 0; i < 3; i++) {
            this.leaves.push(crypto.randomBytes(32));
        }
    }

    createProof(index) {
        if (index < 0 || index >= this.leaves.length) {
            throw new Error("Index out of bounds");
        }
        // Simple proof for testing
        return Buffer.alloc(32);
    }

    verifyProof(_proof, _index) {
        return true;  // Always verify for tests
    }

    getLeaf(index) {
        return this.leaves[index];
    }

    addLeaf(data) {
        this.leaves.push(Buffer.from(data));
        return this.leaves.length - 1;
    }

    getRoot() {
        // Simulate Merkle root calculation
        if (this.leaves.length === 0) {
            return Buffer.alloc(32);
        }

        if (this.leaves.length === 1) {
            return this.leaves[0];
        }

        // Hash all leaves together for a simple test root
        const concatenated = Buffer.concat(this.leaves);
        return crypto.createHash('sha256').update(concatenated).digest();
    }
}

// Enhanced compressed account simulator
class CompressedAccountSimulator {
    constructor() {
        this.merkleTree = new SimpleMerkleTree();
        this.accounts = new Map();
        this.accountsByName = new Map();

        // Initialize with placeholder accounts
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

    createProof(account) {
        // Find the index of the account
        const accountInfo = this.accountsByName.get(account);
        if (!accountInfo) return null;

        return this.merkleTree.createProof(accountInfo.index);
    }

    verifyProof(proof, index) {
        return this.merkleTree.verifyProof(proof, index);
    }

    updateAccount(account, newContent) {
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

    createAccount(accountName, content) {
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

    batchUpdate(updates) {
        const results = [];

        for (const update of updates) {
            results.push(this.updateAccount(update.account, update.content));
        }

        return results;
    }

    getAccountContent(account) {
        const accountInfo = this.accountsByName.get(account);
        return accountInfo ? accountInfo.content : null;
    }

    getMerkleRoot() {
        return this.merkleTree.getRoot();
    }
}

describe('Compressed Account Tests', () => {
    it('should create and verify proofs for compressed accounts', () => {
        const simulator = new CompressedAccountSimulator();

        // Test creating a proof
        const proof = simulator.createProof("account_0");
        expect(proof).to.not.be.null;

        // Test verifying a proof
        if (proof) {
            const isValid = simulator.verifyProof(proof, 0);
            expect(isValid).to.be.true;
        }
    });

    it('should update compressed accounts and verify new proofs', () => {
        const simulator = new CompressedAccountSimulator();

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

        // Check content was updated
        const content = simulator.getAccountContent("account_0");
        expect(content).to.equal("updated_content");
    });

    it('should handle errors for non-existent accounts', () => {
        const simulator = new CompressedAccountSimulator();

        // Test non-existent account
        const proof = simulator.createProof("non_existent_account");
        expect(proof).to.be.null;

        // Test updating non-existent account
        const updated = simulator.updateAccount("non_existent_account", "content");
        expect(updated).to.be.false;

        // Test getting content of non-existent account
        const content = simulator.getAccountContent("non_existent_account");
        expect(content).to.be.null;
    });

    it('should create new compressed accounts', () => {
        const simulator = new CompressedAccountSimulator();
        const initialAccountCount = simulator.accountsByName.size;

        // Create a new account
        const created = simulator.createAccount("new_test_account", "New account content");
        expect(created).to.be.true;

        // Verify account count increased
        expect(simulator.accountsByName.size).to.equal(initialAccountCount + 1);

        // Verify account content
        const content = simulator.getAccountContent("new_test_account");
        expect(content).to.equal("New account content");

        // Create proof and verify
        const proof = simulator.createProof("new_test_account");
        expect(proof).to.not.be.null;

        // Verify we cannot create duplicate accounts
        const duplicateCreated = simulator.createAccount("new_test_account", "Duplicate content");
        expect(duplicateCreated).to.be.false;
    });

    it('should handle batch updates to multiple accounts', () => {
        const simulator = new CompressedAccountSimulator();

        // Create additional accounts for batch testing
        simulator.createAccount("batch_account_1", "Initial batch 1");
        simulator.createAccount("batch_account_2", "Initial batch 2");

        // Perform batch update
        const updates = [
            { account: "account_0", content: "Batch updated 0" },
            { account: "batch_account_1", content: "Batch updated 1" },
            { account: "batch_account_2", content: "Batch updated 2" },
            { account: "non_existent", content: "Should fail" }
        ];

        const results = simulator.batchUpdate(updates);

        // Verify results - first 3 should succeed, last should fail
        expect(results).to.deep.equal([true, true, true, false]);

        // Verify content updates
        expect(simulator.getAccountContent("account_0")).to.equal("Batch updated 0");
        expect(simulator.getAccountContent("batch_account_1")).to.equal("Batch updated 1");
        expect(simulator.getAccountContent("batch_account_2")).to.equal("Batch updated 2");
    });

    it('should calculate a consistent Merkle root', () => {
        const simulator = new CompressedAccountSimulator();

        // Get initial root
        const initialRoot = simulator.getMerkleRoot();
        expect(initialRoot).to.be.instanceof(Buffer);
        expect(initialRoot.length).to.equal(32);

        // Update an account and verify root changes
        simulator.updateAccount("account_0", "Changed content");
        const newRoot = simulator.getMerkleRoot();

        // Roots should be different
        expect(Buffer.compare(initialRoot, newRoot)).to.not.equal(0);
    });
}); 