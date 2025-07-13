/**
 * LayerZero VRF Client SDK
 * 
 * This SDK provides a simple interface for interacting with the LayerZero VRF system,
 * allowing developers to easily send VRF requests and handle fulfillments.
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

// Types and interfaces
export interface VRFRequest {
    type: 'VRF_REQ';
    dst: number;        // Destination endpoint ID
    seed: string;       // Random seed (hex)
    words: number;      // Number of random words
    fee: number;        // Fee in lamports
}

export interface VRFFulfillment {
    type: 'VRF_FULFILL';
    dst: number;        // Destination endpoint ID
    requestId: string;  // Original request ID
    randomness: string; // Generated randomness (hex)
    proof: string;      // VRF proof hash
}

export interface VRFRequestResult {
    success: boolean;
    transactionHash?: string;
    message: string;
    layerZeroScanUrl?: string;
}

export interface VRFFulfillmentResult {
    success: boolean;
    transactionHash?: string;
    message: string;
    layerZeroScanUrl?: string;
}

export interface VRFClientConfig {
    oappDirectory: string;
    solanaKeypairPath: string;
    network: 'devnet' | 'mainnet' | 'testnet';
    sourceEndpointId: number;
    destinationEndpointId: number;
    computeUnitPriceScaleFactor?: number;
    timeout?: number;
}

export interface VRFProofResult {
    output: Buffer;
    proof: Buffer;
    publicKey: Buffer;
    randomness: Buffer;
}

/**
 * VRF Server class for generating VRF proofs
 */
export class VRFServer {
    private vrfKeypair: Buffer;
    
    constructor(keypair?: Buffer) {
        this.vrfKeypair = keypair || crypto.randomBytes(32);
    }
    
    /**
     * Get the VRF server's public key
     */
    getPublicKey(): Buffer {
        return crypto.createHash('sha256').update(this.vrfKeypair).digest();
    }
    
    /**
     * Generate a VRF proof for the given seed
     */
    generateVRFProof(seed: Buffer): VRFProofResult {
        const seedHash = crypto.createHash('sha256').update(seed).digest();
        const keyHash = crypto.createHash('sha256').update(this.vrfKeypair).digest();
        const combined = Buffer.concat([seedHash, keyHash]);
        
        const randomness = crypto.createHash('sha256').update(combined).digest();
        const proof = crypto.createHash('sha256').update(Buffer.concat([randomness, seedHash])).digest();
        const publicKey = this.getPublicKey();
        
        return {
            output: randomness,
            proof: proof,
            publicKey: publicKey,
            randomness: randomness
        };
    }
}

/**
 * LayerZero VRF Client - Main SDK class
 */
export class LayerZeroVRFClient {
    private config: VRFClientConfig;
    private vrfServer: VRFServer;
    
    constructor(config: VRFClientConfig) {
        this.config = {
            computeUnitPriceScaleFactor: 1,
            timeout: 120000,
            ...config
        };
        this.vrfServer = new VRFServer();
    }
    
    /**
     * Generate a secure random seed
     */
    generateSeed(): string {
        return crypto.randomBytes(16).toString('hex');
    }
    
    /**
     * Send a VRF request through LayerZero
     */
    async sendVRFRequest(options: {
        seed?: string;
        words?: number;
        fee?: number;
        destinationEndpointId?: number;
    }): Promise<VRFRequestResult> {
        const seed = options.seed || this.generateSeed();
        const words = options.words || 1;
        const fee = options.fee || 1000000;
        const dst = options.destinationEndpointId || this.config.destinationEndpointId;
        
        const vrfRequest: VRFRequest = {
            type: 'VRF_REQ',
            dst: dst,
            seed: seed,
            words: words,
            fee: fee
        };
        
        // Validate message size
        const messageSize = JSON.stringify(vrfRequest).length;
        if (messageSize > 96) {
            return {
                success: false,
                message: `Message too large (${messageSize} bytes). Keep under 96 bytes for optimal performance.`
            };
        }
        
        return this.sendLayerZeroMessage(vrfRequest);
    }
    
    /**
     * Send a VRF fulfillment through LayerZero
     */
    async sendVRFFulfillment(options: {
        requestId: string;
        seed: string;
        destinationEndpointId?: number;
    }): Promise<VRFFulfillmentResult> {
        const seedBuffer = Buffer.from(options.seed, 'hex');
        const vrfResult = this.vrfServer.generateVRFProof(seedBuffer);
        
        const dst = options.destinationEndpointId || this.config.destinationEndpointId;
        
        const vrfFulfillment: VRFFulfillment = {
            type: 'VRF_FULFILL',
            dst: dst,
            requestId: options.requestId,
            randomness: vrfResult.randomness.toString('hex').substring(0, 16),
            proof: 'PROOF_' + vrfResult.proof.toString('hex').substring(0, 12)
        };
        
        // Validate message size
        const messageSize = JSON.stringify(vrfFulfillment).length;
        if (messageSize > 96) {
            return {
                success: false,
                message: `Message too large (${messageSize} bytes). Keep under 96 bytes for optimal performance.`
            };
        }
        
        return this.sendLayerZeroMessage(vrfFulfillment);
    }
    
    /**
     * Send a message through LayerZero
     */
    private async sendLayerZeroMessage(message: VRFRequest | VRFFulfillment): Promise<VRFRequestResult> {
        try {
            const messageString = JSON.stringify(message);
            
            // Set environment variables
            const env = {
                ...process.env,
                SOLANA_KEYPAIR_PATH: this.config.solanaKeypairPath
            };
            
            // Build command
            const command = [
                'npx hardhat lz:oapp:send',
                `--from-eid ${this.config.sourceEndpointId}`,
                `--dst-eid ${message.dst}`,
                `--message '${messageString}'`,
                `--compute-unit-price-scale-factor ${this.config.computeUnitPriceScaleFactor}`
            ].join(' ');
            
            // Execute command
            const result = execSync(command, {
                cwd: this.config.oappDirectory,
                encoding: 'utf8',
                timeout: this.config.timeout,
                env: env
            });
            
            // Parse results
            const transactionHash = this.extractTransactionHash(result);
            
            if (transactionHash) {
                return {
                    success: true,
                    transactionHash: transactionHash,
                    message: `${message.type} sent successfully`,
                    layerZeroScanUrl: `https://testnet.layerzeroscan.com/tx/${transactionHash}`
                };
            } else if (result.includes('✉️') || result.includes('Cross-chain message')) {
                return {
                    success: true,
                    message: `${message.type} sent successfully (no transaction hash found)`
                };
            } else {
                return {
                    success: false,
                    message: 'No success indicators found in LayerZero response'
                };
            }
            
        } catch (error) {
            return {
                success: false,
                message: `Error sending ${message.type}: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Extract transaction hash from LayerZero response
     */
    private extractTransactionHash(response: string): string | null {
        const patterns = [
            /Transaction hash:\s*([A-Za-z0-9]{40,})/,
            /🧾[^:]*:\s*([A-Za-z0-9]{40,})/
        ];
        
        for (const pattern of patterns) {
            const match = response.match(pattern);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }
    
    /**
     * Generate a VRF proof directly (for testing)
     */
    generateVRFProof(seed: string): VRFProofResult {
        const seedBuffer = Buffer.from(seed, 'hex');
        return this.vrfServer.generateVRFProof(seedBuffer);
    }
    
    /**
     * Validate message format and size
     */
    validateMessage(message: VRFRequest | VRFFulfillment): { valid: boolean; size: number; message: string } {
        const messageString = JSON.stringify(message);
        const size = messageString.length;
        
        if (size > 96) {
            return {
                valid: false,
                size: size,
                message: `Message too large (${size} bytes). Keep under 96 bytes for optimal performance.`
            };
        }
        
        // Validate required fields
        if (message.type === 'VRF_REQ') {
            const req = message as VRFRequest;
            if (!req.dst || !req.seed || !req.words || req.fee === undefined) {
                return {
                    valid: false,
                    size: size,
                    message: 'Missing required fields for VRF request'
                };
            }
        } else if (message.type === 'VRF_FULFILL') {
            const fulfill = message as VRFFulfillment;
            if (!fulfill.dst || !fulfill.requestId || !fulfill.randomness || !fulfill.proof) {
                return {
                    valid: false,
                    size: size,
                    message: 'Missing required fields for VRF fulfillment'
                };
            }
        }
        
        return {
            valid: true,
            size: size,
            message: 'Message is valid'
        };
    }
}

/**
 * Factory function for creating LayerZero VRF clients
 */
export function createLayerZeroVRFClient(config: VRFClientConfig): LayerZeroVRFClient {
    return new LayerZeroVRFClient(config);
}

/**
 * Default configuration for Solana devnet
 */
export const DEVNET_CONFIG: Partial<VRFClientConfig> = {
    network: 'devnet',
    sourceEndpointId: 40168,      // Solana devnet
    destinationEndpointId: 40161, // Ethereum Sepolia
    computeUnitPriceScaleFactor: 1,
    timeout: 120000
};

/**
 * Utility functions
 */
export class VRFUtils {
    /**
     * Generate a secure random seed
     */
    static generateSeed(): string {
        return crypto.randomBytes(16).toString('hex');
    }
    
    /**
     * Validate if a string is a valid hex seed
     */
    static isValidHexSeed(seed: string): boolean {
        return /^[0-9a-fA-F]+$/.test(seed) && seed.length % 2 === 0;
    }
    
    /**
     * Create a compact VRF request message
     */
    static createCompactVRFRequest(options: {
        destinationEndpointId: number;
        seed?: string;
        words?: number;
        fee?: number;
    }): VRFRequest {
        return {
            type: 'VRF_REQ',
            dst: options.destinationEndpointId,
            seed: options.seed || VRFUtils.generateSeed(),
            words: options.words || 1,
            fee: options.fee || 1000000
        };
    }
    
    /**
     * Create a compact VRF fulfillment message
     */
    static createCompactVRFFulfillment(options: {
        destinationEndpointId: number;
        requestId: string;
        randomness: string;
        proof: string;
    }): VRFFulfillment {
        return {
            type: 'VRF_FULFILL',
            dst: options.destinationEndpointId,
            requestId: options.requestId,
            randomness: options.randomness.substring(0, 16),
            proof: options.proof.substring(0, 16)
        };
    }
}

// Export everything
export default LayerZeroVRFClient; 