# Kamui Enhanced VRF System

## LayerZero Kamui Integration (Solana OApp)

The Kamui LayerZero program provides **cross-chain VRF** for EVM ↔ Solana using the LayerZero omnichain protocol.

👉 **Heads-up:** Due to a `zeroize` dependency conflict when building inside this monorepo, the full LayerZero OApp has been **vendored from a standalone workspace** (see `/tmp/kamui-layerzero-standalone-evm-test`).  That code has now been copied verbatim into `programs/kamui-layerzero/`.  If you hit `zeroize` linker errors again, simply move `programs/kamui-layerzero` to its own repository, build there with Anchor/Solana and then deploy; the on-chain behavior is unaffected.

### Real Unit-Test Results (codec only)

```bash
=== LayerZero VRF Message Processing Tests ===

  VRF Message Processing Test

=== Testing VRF Request Message Processing ===
VRF Request Payload created (EVM compatible):
- Message Type: VrfRequest (0)
- Requester: [01, 01, 01, ...] (32 bytes)
- Seed: [42, 42, 42, ...] (32 bytes)
- Callback Data: [11, 11, 11, ...] (32 bytes)
- Num Words: 3 (uint32)
- Pool ID: 1
✅ VRF Request Message Type Validation: PASSED
✅ VRF Request Payload Size Validation: PASSED
✅ VRF Request Payload Structure: PASSED
    ✔ should process VRF request message correctly

=== Testing VRF Fulfillment Message Processing ===
VRF Fulfillment Payload created (EVM compatible):
- Message Type: VrfFulfillment (1)
- Request ID: [11, 11, 11, ...] (32 bytes)
- Randomness: [99, 99, 99, ...] (64 bytes)
✅ VRF Fulfillment Message Type Validation: PASSED
✅ VRF Fulfillment Payload Size Validation: PASSED
✅ VRF Fulfillment Payload Structure: PASSED
    ✔ should process VRF fulfillment message correctly

=== Testing Generic String Message Processing ===
Generic String Message created:
- Message: Hello LayerZero!
- Payload Size: 48 bytes
✅ Generic String Message Validation: PASSED
✅ Generic String Message Header: PASSED
    ✔ should handle generic string message correctly

=== Testing Message Processing Workflow ===
✅ Message Type Detection: PASSED
✅ Message Processing Workflow: COMPLETE
    ✔ should validate message processing workflow

=== Testing Codec Roundtrip Validation ===
✅ VRF Request Roundtrip: PASSED
✅ VRF Fulfillment Roundtrip: PASSED
✅ Codec Roundtrip Validation: COMPLETE
    ✔ should validate codec roundtrip

  5 passing (2ms)
```

These five assertions confirm that the **EVM-compatible VRF message codec** (request & fulfillment) behaves exactly as expected.

### Quick Start

```bash
yarn install   # or npm install
node --experimental-vm-modules node_modules/mocha/bin/mocha.js \
  programs/kamui-layerzero/tests/vrf_message_processing_test.js
```


## Architecture

The system consists of several core components:

1. **Subscription Management**: Users create subscriptions to request randomness, with configuration for confirmations, limits, and balance requirements
2. **VRF Oracle**: Monitors the blockchain for requests and responds with cryptographic ECVRF proofs
3. **Verification System**: External program that verifies ECVRF proofs before accepting randomness
4. **Consumer Contracts**: Sample implementations showing how to consume verified randomness

## Deployed Programs

The VRF system has been deployed to Solana devnet with the following program IDs:

- **Kamui VRF**: `6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a`
- **VRF Consumer**: `2Pd6R21gGNJgrfxHQPegcXgwmSd5MY1uHBYrNAtYgPbE`
- **Verification Program**: `4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y`

You can verify these deployments on [Solana Explorer](https://explorer.solana.com/address/6k1Lmt37b5QQAhPz5YXbTPoHCSCDbSEeNAC96nWZn85a?cluster=devnet).

## 📊 Devnet Test Results

### Core VRF Features 
- ✅ Enhanced VRF subscription creation
- ✅ Subscription funding mechanism
- ✅ Request pool initialization
- ✅ Randomness request generation
- ✅ Real ECVRF proof generation
- ✅ Consumer program integration

### Security & Validation 
- ✅ Balance constraint validation
- ✅ Request pooling and limits
- ✅ Account ownership verification
- ✅ Arithmetic overflow protection
- ✅ Input validation and sanitization

### Performance Optimizations
- Fixed-size arrays instead of Vec<u8> for large data
- Stack-based operations avoiding heap allocation
- Zero-copy deserialization for large accounts
- Streaming verification for oversized proofs
- Compressed account storage option available

## Usage

### For dApp Developers

1. **Create a Subscription**:
   ```rust
   // Create a subscription with minimum balance and confirmation settings
   let create_subscription_ix = create_enhanced_subscription_instruction(
       &wallet.pubkey(),     // Owner
       &subscription_pubkey, // PDA for subscription account
       1_000_000,            // Minimum balance
       3,                    // Confirmations required
       10,                   // Maximum concurrent requests
   );
   ```

2. **Request Randomness**:
   ```rust
   let request_ix = request_randomness_instruction(
       &wallet.pubkey(),         // Requester
       &request_keypair.pubkey(),// Request account (keypair)
       &subscription_pubkey,     // Subscription account
       seed,                     // Random seed
       callback_data,            // Data to pass to callback
       1,                        // Number of random words
       3,                        // Confirmations required
       50_000,                   // Gas limit for callback
   );
   ```

3. **Consume Randomness in Your dApp**:
   ```rust
   // Your callback function receives the randomness
   pub fn consume_randomness(
       ctx: Context<ConsumeRandomness>,
       randomness_bytes: [u8; 8],
   ) -> Result<()> {
       // Use the randomness for your application
       // For example, to generate a number between 1 and 100:
       let random_number = 1 + (u64::from_le_bytes(randomness_bytes) % 100);
       Ok(())
   }
   ```

## Testing

### Running Tests on Local Validator

To run the tests using a local validator:

```bash
# Run tests with building programs
anchor test

# Run tests without building (if programs already built)
anchor test --skip-build
```

### Running Tests on Devnet

To run tests against the deployed programs on Solana devnet:

```bash
# Run tests on devnet without building or deploying
anchor test --skip-build --provider.cluster devnet
```

The tests include:
1. Creating enhanced VRF subscriptions
2. Verifying real ECVRF proofs using the external verification program
3. Requesting randomness with proper account structures
4. Fulfilling randomness requests with cryptographic proofs
5. Integrating with consumer programs to use the randomness

### Test Features

The test suite demonstrates:
- **Real ECVRF Proof Verification**: Uses actual elliptic curve VRF proofs for cryptographic security
- **Subscription Management**: Creates and funds VRF subscriptions with proper balance tracking
- **Request/Fulfillment Flow**: Complete cycle from randomness request to delivery
- **Consumer Integration**: Sample game that consumes VRF randomness
- **Error Handling**: Proper account validation and constraint checking

## Architecture Overview

```
• The protocol shall allow users to create VRF subscriptions for randomness requests
• The protocol shall allow users to fund their subscriptions with SOL
• The protocol shall provide verifiable random numbers to consumer programs
• The protocol shall verify oracle proofs cryptographically using ECVRF
• The protocol shall enable subscription owners to manage request parameters

                             2 - Fulfills Request
                      ┌─────────────────────────────────┐
                      │                                 │
                      │                                 ▼
┌────────────────────┐│  ┌───────────────────┐    ┌────────────────┐
│                    ││  │                   │    │                │
│   VRF Contract     ││  │   VRF Oracle      │    │   VRF Result   │
├────────────────────┤│  ├───────────────────┤    ├────────────────┤
│ + subscription: PDA│◄─┘  │ + vrf_keypair     │    │ + randomness   │
│ + request: Keypair │     │ + proof_generation│    │ + proof        │
│ + vrf_result: PDA  │     │ + monitoring      │    │ + request_id   │
└────────────────────┘     └───────────────────┘    └────────────────┘
          ▲                                                   │
          │                                                   │
          │ 1 - Requests Randomness                           │
          │                                                   │
          │                                                   ▼
┌─────────┴──────────┐                           ┌─────────────────────┐
│                    │                           │                     │
│    User/Consumer   │◄──────────────────────────┤  Consumer Program   │
│                    │   3 - Consumes Randomness  │                     │
└────────────────────┘                           └─────────────────────┘
```

**Flow Description:**
- **1 - User Requests Randomness**: User creates a randomness request through their subscription using a keypair account
- **2 - Oracle Fulfills Request**: VRF oracle monitors for pending requests, generates ECVRF proof, and stores verified result
- **3 - Consumer Program Uses Randomness**: Consumer program retrieves VRF result and uses it for application logic

## Security Features

The enhanced VRF system provides:

- **Cryptographic Security**: Uses elliptic curve VRF (ECVRF) for provably fair randomness
- **External Verification**: Separate verification program validates all VRF proofs
- **Subscription Access Control**: Only subscription owners can make requests
- **Balance Management**: Automatic balance checking prevents insufficient fund scenarios
- **Request Validation**: Comprehensive constraint checking on all operations

## Performance Considerations

- Each VRF request requires ECVRF proof generation, which is computationally intensive
- Tests run efficiently on both local validator and devnet
- Subscription-based model allows for efficient batch funding of multiple requests
- Consumer programs can process randomness results immediately upon fulfillment

## License

This project is licensed under the Apache License, Version 2.0. See the LICENSE file for details.

## Overview: LayerZero Kamui Cross-Chain VRF Flow

The Kamui LayerZero program enables cross-chain VRF (Verifiable Random Function) requests and fulfillments between Solana and EVM chains using LayerZero's omnichain protocol. This allows EVM contracts to request randomness from Solana and receive verifiable results.

### High-Level Flow
1. **EVM contract** calls `requestRandomness()` on its LayerZero VRF consumer contract.
2. **LayerZero** relays the request to Solana, where the `kamui-layerzero` program receives it.
3. **kamui-layerzero** processes the message, validates the sender, and routes the request to the Kamui VRF program.
4. **Kamui VRF** generates randomness and returns the result to `kamui-layerzero`.
5. **kamui-layerzero** sends the VRF fulfillment back to the EVM chain via LayerZero.
6. **EVM contract** receives the randomness and executes its callback logic.

### Key Components
- **kamui-layerzero**: Solana program implementing LayerZero OApp interface, message routing, and VRF request/fulfillment logic.
- **kamui-vrf**: Solana program generating cryptographically secure randomness.
- **VRFConsumerLZ.sol**: EVM contract for requesting and receiving randomness via LayerZero.

For a detailed architecture diagram and message type breakdown, see `docs/README-LayerZero-VRF.md` and `LAYERZERO_DEVNET_SETUP.md`.

---




---

## Additional Resources
- [LayerZero Solana OApp Overview](https://docs.layerzero.network/v2/developers/solana/oapp/overview)
- [Kamui VRF Documentation](../README.md)
- [LAYERZERO_DEVNET_SETUP.md](./LAYERZERO_DEVNET_SETUP.md)
- [docs/README-LayerZero-VRF.md](./docs/README-LayerZero-VRF.md)
- [`programs/kamui-layerzero/tests/vrf_message_processing_test.js`](./programs/kamui-layerzero/tests/vrf_message_processing_test.js) — unit test validating the VRF message codec (run with `node --experimental-vm-modules node_modules/mocha/bin/mocha.js programs/kamui-layerzero/tests/vrf_message_processing_test.js`). 



