# Kamui Enhanced VRF System

This directory contains the implementation of Kamui's enhanced Verifiable Random Function (VRF) system for Solana blockchain applications. The system provides secure, verifiable randomness for on-chain applications with robustness, scalability, and performance improvements.

## Key Features

- **Request Pools**: Requests are organized into subscription-specific pools for efficient batch processing
- **Enhanced Subscriptions**: Subscriptions track active requests and maintain request history
- **Robust Oracle Management**: Oracle registry with reputation tracking and automatic rotation
- **Secure ID Generation**: Request IDs generated using multiple entropy sources
- **Batch Processing**: Process multiple requests efficiently in a single transaction
- **Automated Cleanup**: Expired request handling and pool maintenance
- **Flexible Configuration**: Configurable confirmation levels, gas limits, and request parameters

## Architecture

The system consists of several core components:

1. **Subscription Management**: Users create subscriptions to request randomness, with configuration for confirmations, limits, and balance requirements
2. **Request Pools**: Each subscription can have multiple request pools to organize randomness requests
3. **Oracle Registry**: Tracks oracle reputation, activity, and facilitates oracle rotation
4. **VRF Server**: Monitors the blockchain for requests and responds with cryptographic proofs
5. **Callback System**: Delivers verified randomness to consumer contracts

## Deployed Programs

The VRF system has been deployed to Solana devnet with the following program IDs:

- **Kamui VRF**: `4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1`
- **Verification Program**: `4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y`

You can verify these deployments on [Solana Explorer](https://explorer.solana.com/address/4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1?cluster=devnet).

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

2. **Initialize Request Pool**:
   ```rust
   let init_pool_ix = initialize_request_pool_instruction(
       &wallet.pubkey(),     // Owner
       &subscription_pubkey, // Subscription account
       &pool_pubkey,         // PDA for pool account
       1,                    // Pool ID
       100,                  // Maximum capacity
   );
   ```

3. **Request Randomness**:
   ```rust
   let request_ix = request_randomness_instruction(
       &wallet.pubkey(),         // Requester
       &request_pubkey,          // PDA for request account
       &subscription_pubkey,     // Subscription account
       &pool_pubkey,             // Request pool account
       seed,                     // Random seed
       callback_data,            // Data to pass to callback
       1,                        // Number of random words
       3,                        // Confirmations required
       50_000,                   // Gas limit for callback
       1,                        // Pool ID
   );
   ```

4. **Consume Randomness in Your dApp**:
   ```rust
   // Your callback function receives the randomness
   pub fn consume_randomness(
       ctx: Context<ConsumeRandomness>,
       randomness: [u8; 64],
   ) -> Result<()> {
       // Use the randomness for your application
       // For example, to generate a number between 1 and 100:
       let random_number = 1 + (u64::from_le_bytes(randomness[0..8].try_into().unwrap()) % 100);
       Ok(())
   }
   ```

### Running the VRF Server

To run the VRF server that fulfills randomness requests, use the provided script:

```bash
# Basic usage
./run_vrf_simple_ws.sh

# Advanced usage with all parameters
./run_vrf_simple_ws.sh \
  --program-id <PROGRAM_ID> \
  --feepayer-keypair keypair.json \
  --vrf-keypair vrf-keypair.json \
  --oracle-keypair oracle-keypair.json \
  --registry-id <REGISTRY_PUBKEY> \
  --rpc-url https://api.devnet.solana.com \
  --ws-url wss://api.devnet.solana.com \
  --scan-interval 30000 \
  --batch-size 10 \
  --log-level debug
```

### Integration Testing

Run the integration test script to test the full flow:

```bash
# Basic usage
./scripts/run_devnet_integration_test.sh

# Advanced usage
./scripts/run_devnet_integration_test.sh \
  --enhanced-mode true \
  --batch-size 5 \
  --log-level debug \
  --rpc-url https://api.devnet.solana.com \
  --ws-url wss://api.devnet.solana.com
```

## Testing

### Running Tests on Local Validator

To run the tests using a local validator:

```bash
# Run with local validator
anchor test
```

### Running Tests on Devnet

For running tests on Solana devnet, we provide a dedicated script that properly configures the environment and handles test account funding:

```bash
# Make the script executable
chmod +x run-devnet-tests.sh

# Run the tests on devnet
./run-devnet-tests.sh
```

The devnet test script will:
1. Verify that the programs exist on devnet
2. Update configuration files with the correct program IDs
3. Check your wallet balance and offer to airdrop SOL if needed
4. Transfer small amounts of SOL to test accounts (about 0.01 SOL each)
5. Run the full test suite against the deployed devnet programs

Alternatively, you can run tests directly with the Anchor CLI:

```bash
# Run tests on devnet without deploying
anchor test --skip-local-validator --skip-deploy
```

## Advanced Features

### Oracle Rotation

The system automatically rotates oracles based on reputation and configured frequency:

```rust
// Rotate oracles
let rotate_ix = rotate_oracles_instruction(
    &admin.pubkey(),     // Admin or permissionless
    &registry_pubkey,    // Oracle registry
);
```

### Batch Processing

Process multiple randomness requests in a single transaction:

```rust
let batch_ix = process_request_batch_instruction(
    &oracle.pubkey(),            // Oracle
    &oracle_config_pubkey,       // Oracle config
    &pool_pubkey,                // Request pool
    request_ids,                 // Array of request IDs
    proofs,                      // Array of VRF proofs
    public_keys,                 // Array of public keys
    pool_id,                     // Pool ID
    request_indices,             // Array of request indices
);
```

### Cleaning Expired Requests

Maintain system health by cleaning expired requests:

```rust
let clean_ix = clean_expired_requests_instruction(
    &wallet.pubkey(),        // Any account (permissionless)
    &pool_pubkey,            // Request pool
    &subscription_pubkey,    // Subscription
    pool_id,                 // Pool ID
);
```

## Performance Considerations

- Each VRF request requires VRF proof generation, which is computationally intensive
- Batch processing significantly improves throughput for applications with multiple requests
- Request pools help organize and prioritize requests based on application needs
- Oracle rotation ensures reliable service even if individual oracles become unavailable

## Security

The enhanced VRF system provides:

- Cryptographic verification of randomness using elliptic curve VRF proofs
- Protection against request expiration to prevent stale requests
- Oracle reputation tracking to maintain service quality
- Subscription-based access control for randomness consumers

## License

This project is licensed under the Apache License, Version 2.0. See the LICENSE file for details. 