/**
 * LayerZero VRF Client SDK Example
 * 
 * This example demonstrates how to use the LayerZero VRF Client SDK
 * to send VRF requests and fulfillments through LayerZero messaging.
 */

import { 
    LayerZeroVRFClient, 
    createLayerZeroVRFClient, 
    VRFUtils, 
    DEVNET_CONFIG 
} from '../src/client/layerzero-vrf-client';

/**
 * Example 1: Basic VRF Request
 */
async function basicVRFRequestExample() {
    console.log('🎯 Example 1: Basic VRF Request');
    console.log('================================');
    
    // Create client with devnet configuration
    const client = createLayerZeroVRFClient({
        oappDirectory: '/Users/kyler/repos/kamui/my-lz-oapp',
        solanaKeypairPath: process.env.HOME + '/.config/solana/id.json',
        ...DEVNET_CONFIG
    } as any);
    
    try {
        // Send a VRF request
        const result = await client.sendVRFRequest({
            seed: VRFUtils.generateSeed(),
            words: 1,
            fee: 1000000
        });
        
        console.log('📄 VRF Request Result:');
        console.log(`  Success: ${result.success}`);
        console.log(`  Message: ${result.message}`);
        
        if (result.transactionHash) {
            console.log(`  Transaction: ${result.transactionHash}`);
            console.log(`  LayerZero Scan: ${result.layerZeroScanUrl}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
    
    console.log('');
}

/**
 * Example 2: VRF Fulfillment
 */
async function vrfFulfillmentExample() {
    console.log('🎯 Example 2: VRF Fulfillment');
    console.log('=============================');
    
    // Create client
    const client = createLayerZeroVRFClient({
        oappDirectory: '/Users/kyler/repos/kamui/my-lz-oapp',
        solanaKeypairPath: process.env.HOME + '/.config/solana/id.json',
        ...DEVNET_CONFIG
    } as any);
    
    try {
        const requestId = 'req_' + Date.now().toString(36);
        const seed = VRFUtils.generateSeed();
        
        // Send VRF fulfillment
        const result = await client.sendVRFFulfillment({
            requestId: requestId,
            seed: seed
        });
        
        console.log('📄 VRF Fulfillment Result:');
        console.log(`  Success: ${result.success}`);
        console.log(`  Message: ${result.message}`);
        
        if (result.transactionHash) {
            console.log(`  Transaction: ${result.transactionHash}`);
            console.log(`  LayerZero Scan: ${result.layerZeroScanUrl}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
    
    console.log('');
}

/**
 * Example 3: VRF Proof Generation
 */
function vrfProofExample() {
    console.log('🎯 Example 3: VRF Proof Generation');
    console.log('==================================');
    
    // Create client
    const client = createLayerZeroVRFClient({
        oappDirectory: '/Users/kyler/repos/kamui/my-lz-oapp',
        solanaKeypairPath: process.env.HOME + '/.config/solana/id.json',
        ...DEVNET_CONFIG
    } as any);
    
    const seed = VRFUtils.generateSeed();
    console.log(`📋 Seed: ${seed}`);
    
    // Generate VRF proof
    const proof = client.generateVRFProof(seed);
    
    console.log('🔑 VRF Proof:');
    console.log(`  Randomness: ${proof.randomness.toString('hex')}`);
    console.log(`  Proof: ${proof.proof.toString('hex')}`);
    console.log(`  Public Key: ${proof.publicKey.toString('hex')}`);
    console.log(`  Output: ${proof.output.toString('hex')}`);
    
    console.log('');
}

/**
 * Example 4: Message Validation
 */
function messageValidationExample() {
    console.log('🎯 Example 4: Message Validation');
    console.log('=================================');
    
    // Create client
    const client = createLayerZeroVRFClient({
        oappDirectory: '/Users/kyler/repos/kamui/my-lz-oapp',
        solanaKeypairPath: process.env.HOME + '/.config/solana/id.json',
        ...DEVNET_CONFIG
    } as any);
    
    // Test VRF request validation
    const vrfRequest = VRFUtils.createCompactVRFRequest({
        destinationEndpointId: 40161,
        seed: VRFUtils.generateSeed(),
        words: 1,
        fee: 1000000
    });
    
    const validation = client.validateMessage(vrfRequest);
    console.log('📋 VRF Request Validation:');
    console.log(`  Valid: ${validation.valid}`);
    console.log(`  Size: ${validation.size} bytes`);
    console.log(`  Message: ${validation.message}`);
    
    // Test VRF fulfillment validation
    const vrfFulfillment = VRFUtils.createCompactVRFFulfillment({
        destinationEndpointId: 40161,
        requestId: 'req_12345',
        randomness: 'abcdef1234567890',
        proof: 'proof_abcdef123456'
    });
    
    const fulfillmentValidation = client.validateMessage(vrfFulfillment);
    console.log('📋 VRF Fulfillment Validation:');
    console.log(`  Valid: ${fulfillmentValidation.valid}`);
    console.log(`  Size: ${fulfillmentValidation.size} bytes`);
    console.log(`  Message: ${fulfillmentValidation.message}`);
    
    console.log('');
}

/**
 * Example 5: Complete VRF Flow
 */
async function completeVRFFlowExample() {
    console.log('🎯 Example 5: Complete VRF Flow');
    console.log('===============================');
    
    // Create client
    const client = createLayerZeroVRFClient({
        oappDirectory: '/Users/kyler/repos/kamui/my-lz-oapp',
        solanaKeypairPath: process.env.HOME + '/.config/solana/id.json',
        ...DEVNET_CONFIG
    } as any);
    
    try {
        // Step 1: Generate seed and request ID
        const seed = VRFUtils.generateSeed();
        const requestId = 'req_' + Date.now().toString(36);
        
        console.log('📋 Flow Parameters:');
        console.log(`  Request ID: ${requestId}`);
        console.log(`  Seed: ${seed}`);
        console.log('');
        
        // Step 2: Send VRF request
        console.log('📤 Step 1: Sending VRF Request...');
        const requestResult = await client.sendVRFRequest({
            seed: seed,
            words: 1,
            fee: 1000000
        });
        
        console.log(`  Success: ${requestResult.success}`);
        console.log(`  Message: ${requestResult.message}`);
        if (requestResult.transactionHash) {
            console.log(`  Transaction: ${requestResult.transactionHash}`);
        }
        console.log('');
        
        // Step 3: Wait and send VRF fulfillment
        console.log('📤 Step 2: Sending VRF Fulfillment...');
        const fulfillmentResult = await client.sendVRFFulfillment({
            requestId: requestId,
            seed: seed
        });
        
        console.log(`  Success: ${fulfillmentResult.success}`);
        console.log(`  Message: ${fulfillmentResult.message}`);
        if (fulfillmentResult.transactionHash) {
            console.log(`  Transaction: ${fulfillmentResult.transactionHash}`);
        }
        console.log('');
        
        // Step 4: Summary
        console.log('📊 Flow Summary:');
        console.log(`  Request Status: ${requestResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        console.log(`  Fulfillment Status: ${fulfillmentResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        if (requestResult.transactionHash && fulfillmentResult.transactionHash) {
            console.log('  🔗 LayerZero Scan Links:');
            console.log(`    Request: ${requestResult.layerZeroScanUrl}`);
            console.log(`    Fulfillment: ${fulfillmentResult.layerZeroScanUrl}`);
        }
        
    } catch (error) {
        console.error('❌ Error in complete flow:', error);
    }
    
    console.log('');
}

/**
 * Example 6: Utility Functions
 */
function utilityFunctionsExample() {
    console.log('🎯 Example 6: Utility Functions');
    console.log('===============================');
    
    // Generate seeds
    console.log('🔑 Seed Generation:');
    for (let i = 0; i < 3; i++) {
        const seed = VRFUtils.generateSeed();
        console.log(`  Seed ${i + 1}: ${seed} (valid: ${VRFUtils.isValidHexSeed(seed)})`);
    }
    console.log('');
    
    // Create compact messages
    console.log('📦 Compact Message Creation:');
    
    const compactRequest = VRFUtils.createCompactVRFRequest({
        destinationEndpointId: 40161,
        seed: VRFUtils.generateSeed(),
        words: 1,
        fee: 500000
    });
    
    console.log('  VRF Request:', JSON.stringify(compactRequest));
    console.log(`  Size: ${JSON.stringify(compactRequest).length} bytes`);
    
    const compactFulfillment = VRFUtils.createCompactVRFFulfillment({
        destinationEndpointId: 40161,
        requestId: 'req_abc123',
        randomness: '1234567890abcdef',
        proof: 'proof_1234567890'
    });
    
    console.log('  VRF Fulfillment:', JSON.stringify(compactFulfillment));
    console.log(`  Size: ${JSON.stringify(compactFulfillment).length} bytes`);
    
    console.log('');
}

/**
 * Main function to run all examples
 */
async function main() {
    console.log('🚀 LayerZero VRF Client SDK Examples');
    console.log('====================================');
    console.log('');
    
    // Run all examples
    await basicVRFRequestExample();
    await vrfFulfillmentExample();
    vrfProofExample();
    messageValidationExample();
    await completeVRFFlowExample();
    utilityFunctionsExample();
    
    console.log('🎉 All examples completed!');
}

// Run examples if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

export {
    basicVRFRequestExample,
    vrfFulfillmentExample,
    vrfProofExample,
    messageValidationExample,
    completeVRFFlowExample,
    utilityFunctionsExample
}; 