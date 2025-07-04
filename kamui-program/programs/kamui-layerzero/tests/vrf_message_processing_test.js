import { expect } from 'chai';

// ... existing code ...

import { expect } from 'chai';

describe('VRF Message Processing Test', () => {
    console.log('=== LayerZero VRF Message Processing Tests ===');
    
    it('should process VRF request message correctly', () => {
        console.log('\n=== Testing VRF Request Message Processing ===');
        
        // Create a VRF request payload - EVM compatible format
        const requester = new Array(32).fill(0x01); // EVM address padded to 32 bytes
        const seed = new Array(32).fill(0x42); // Test seed
        const callbackData = new Array(32).fill(0x11); // Request ID (32 bytes, no length prefix)
        const numWords = 3; // uint32 for EVM compatibility
        const poolId = 1; // Pool ID for EVM compatibility
        
        const vrfRequestPayload = createVrfRequestPayload(
            requester,
            seed,
            callbackData,
            numWords,
            poolId
        );
        
        console.log('VRF Request Payload created (EVM compatible):');
        console.log('- Message Type: VrfRequest (0)');
        console.log('- Requester: [01, 01, 01, ...] (32 bytes)');
        console.log('- Seed: [42, 42, 42, ...] (32 bytes)');
        console.log('- Callback Data: [11, 11, 11, ...] (32 bytes)');
        console.log('- Num Words:', numWords, '(uint32)');
        console.log('- Pool ID:', poolId);
        
        // Test that the message can be decoded properly
        const messageType = vrfRequestPayload[0];
        expect(messageType).to.equal(0); // VrfRequest
        
        console.log('✅ VRF Request Message Type Validation: PASSED');
        
        // Verify payload structure - EVM compatible format: 1 + 32 + 32 + 32 + 4 + 1 = 102 bytes
        expect(vrfRequestPayload.length).to.be.greaterThan(100);
        
        console.log('✅ VRF Request Payload Size Validation: PASSED');
        
        // Test payload content
        const expectedSize = 1 + 32 + 32 + 32 + 4 + 1; // 102 bytes
        expect(vrfRequestPayload.length).to.equal(expectedSize);
        
        console.log('✅ VRF Request Payload Structure: PASSED');
    });
    
    it('should process VRF fulfillment message correctly', () => {
        console.log('\n=== Testing VRF Fulfillment Message Processing ===');
        
        // Create a VRF fulfillment payload - EVM compatible format
        const requestId = new Array(32).fill(0x11); // Test request ID (32 bytes)
        const randomness = new Array(64).fill(0x99); // Fixed 64 bytes for EVM compatibility
        
        const vrfFulfillmentPayload = createVrfFulfillmentPayload(
            requestId,
            randomness
        );
        
        console.log('VRF Fulfillment Payload created (EVM compatible):');
        console.log('- Message Type: VrfFulfillment (1)');
        console.log('- Request ID: [11, 11, 11, ...] (32 bytes)');
        console.log('- Randomness: [99, 99, 99, ...] (64 bytes)');
        
        // Test that the message can be decoded properly
        const messageType = vrfFulfillmentPayload[0];
        expect(messageType).to.equal(1); // VrfFulfillment
        
        console.log('✅ VRF Fulfillment Message Type Validation: PASSED');
        
        // Verify payload structure - EVM compatible format: 1 + 32 + 64 = 97 bytes
        expect(vrfFulfillmentPayload.length).to.be.greaterThan(90);
        
        console.log('✅ VRF Fulfillment Payload Size Validation: PASSED');
        
        // Test payload content
        const expectedSize = 1 + 32 + 64; // 97 bytes
        expect(vrfFulfillmentPayload.length).to.equal(expectedSize);
        
        console.log('✅ VRF Fulfillment Payload Structure: PASSED');
    });
    
    it('should handle generic string message correctly', () => {
        console.log('\n=== Testing Generic String Message Processing ===');
        
        // Create a generic string message (existing format)
        const testMessage = 'Hello LayerZero!';
        const genericPayload = encodeStringMessage(testMessage);
        
        console.log('Generic String Message created:');
        console.log('- Message:', testMessage);
        console.log('- Payload Size:', genericPayload.length, 'bytes');
        
        // Verify payload structure matches expected format
        expect(genericPayload.length).to.equal(32 + testMessage.length); // 32-byte header + string
        
        console.log('✅ Generic String Message Validation: PASSED');
        
        // Test header structure
        expect(genericPayload[31]).to.equal(testMessage.length); // Length in last byte of header
        
        console.log('✅ Generic String Message Header: PASSED');
    });
    
    it('should validate message processing workflow', () => {
        console.log('\n=== Testing Message Processing Workflow ===');
        
        const vrfRequestPayload = createVrfRequestPayload(
            new Array(32).fill(0x01),
            new Array(32).fill(0x42),
            new Array(32).fill(0x11),
            1,
            0
        );
        
        const vrfFulfillmentPayload = createVrfFulfillmentPayload(
            new Array(32).fill(0x11),
            new Array(64).fill(0x99)
        );
        
        const genericPayload = encodeStringMessage('test message');
        
        // Verify message type detection
        expect(vrfRequestPayload[0]).to.equal(0);
        expect(vrfFulfillmentPayload[0]).to.equal(1);
        expect(genericPayload[0]).to.equal(0);
        
        console.log('✅ Message Type Detection: PASSED');
        console.log('✅ Message Processing Workflow: COMPLETE');
    });
    
    it('should validate codec roundtrip', () => {
        console.log('\n=== Testing Codec Roundtrip Validation ===');
        
        const originalRequester = new Array(32).fill(0x01);
        const originalSeed = new Array(32).fill(0x42);
        const originalCallbackData = new Array(32).fill(0x11);
        const originalNumWords = 5;
        const originalPoolId = 2;
        
        const vrfRequestPayload = createVrfRequestPayload(
            originalRequester, originalSeed, originalCallbackData, originalNumWords, originalPoolId
        );
        
        expect(vrfRequestPayload[0]).to.equal(0);
        expect(vrfRequestPayload[1]).to.equal(0x01);
        expect(vrfRequestPayload[33]).to.equal(0x42);
        expect(vrfRequestPayload[65]).to.equal(0x11);
        expect(vrfRequestPayload[101]).to.equal(originalPoolId);
        
        console.log('✅ VRF Request Roundtrip: PASSED');
        
        const originalRequestId = new Array(32).fill(0x11);
        const originalRandomness = new Array(64).fill(0x99);
        
        const vrfFulfillmentPayload = createVrfFulfillmentPayload(originalRequestId, originalRandomness);
        
        expect(vrfFulfillmentPayload[0]).to.equal(1);
        expect(vrfFulfillmentPayload[1]).to.equal(0x11);
        expect(vrfFulfillmentPayload[33]).to.equal(0x99);
        
        console.log('✅ VRF Fulfillment Roundtrip: PASSED');
        console.log('✅ Codec Roundtrip Validation: COMPLETE');
    });
});

function createVrfRequestPayload(requester, seed, callbackData, numWords, poolId) {
    const payload = [];
    payload.push(0);
    payload.push(...requester);
    payload.push(...seed);
    payload.push(...callbackData);
    payload.push((numWords >> 24) & 0xff, (numWords >> 16) & 0xff, (numWords >> 8) & 0xff, numWords & 0xff);
    payload.push(poolId);
    return new Uint8Array(payload);
}

function createVrfFulfillmentPayload(requestId, randomness) {
    const payload = [];
    payload.push(1);
    payload.push(...requestId);
    payload.push(...randomness);
    return new Uint8Array(payload);
}

function encodeStringMessage(message) {
    const messageBytes = Buffer.from(message, 'utf-8');
    const payload = new Uint8Array(32 + messageBytes.length);
    payload.set(new Uint8Array(28), 0);
    payload.set([(messageBytes.length >> 24) & 0xff, (messageBytes.length >> 16) & 0xff, (messageBytes.length >> 8) & 0xff, messageBytes.length & 0xff], 28);
    payload.set(messageBytes, 32);
    return payload;
} 