# Kamui Enhanced VRF System

This directory contains the implementation of Kamui's enhanced Verifiable Random Function (VRF) system for Solana blockchain applications. The system provides secure, verifiable randomness for on-chain applications with robustness, scalability, and performance improvements.

## Key Features

- **Enhanced Subscriptions**: Subscriptions track balance, confirmations, and request limits
- **Secure ID Generation**: Request IDs generated using cryptographic entropy
- **Real ECVRF Integration**: Uses elliptic curve VRF for cryptographically secure randomness
- **Flexible Configuration**: Configurable confirmation levels, gas limits, and request parameters
- **Consumer Program Integration**: Sample game implementation showing randomness consumption

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