# Kamui VRF - Anchor Implementation

This is an Anchor-based implementation of the Kamui VRF (Verifiable Random Function) system. It provides a secure and transparent randomness service for Solana programs.

## Features

- **Enhanced Subscription Management**: Track and manage subscription balances, request pools, and request limits.
- **Robust ID Generation**: Unique and collision-resistant request identifiers.
- **Oracle Management**: Register and manage oracles with stake and reputation systems.
- **Batch Processing**: Process multiple randomness requests in a single transaction.
- **Direct Proof Generation**: Simplified testing with direct VRF proof generation.

## Program Components

### Accounts

- `EnhancedSubscription`: Manages user subscriptions with balance tracking and request limits
- `RequestPool`: Organizes requests by subscription with efficient storage
- `RandomnessRequest`: Stores details about randomness requests
- `VrfResult`: Stores the randomness output and proof verification results
- `OracleRegistry`: Manages the set of approved oracles for generating proofs
- `EnhancedOracle`: Tracks individual oracle details, stake, and reputation

### Main Instructions

1. **Subscription Management**
   - `create_enhanced_subscription`: Create a new subscription
   - `fund_subscription`: Add funds to a subscription
   - `initialize_request_pool`: Initialize a request pool for a subscription

2. **Randomness Requests**
   - `request_randomness`: Submit a request for randomness
   - `fulfill_randomness`: Fulfill a request with a VRF proof
   - `clean_expired_requests`: Clean expired requests from a pool

3. **Oracle Management**
   - `initialize_oracle_registry`: Set up the oracle registry
   - `register_oracle`: Register a new oracle with stake
   - `rotate_oracles`: Rotate active oracles

## Testing

This implementation makes testing easier with Anchor. You can test the VRF system with:

1. **Unit Tests**: Test individual components with Anchor's testing framework.

2. **Integration Tests**: Test the full flow from request to fulfillment using the included test files.

3. **Direct Proof Generation**: Generate proofs directly in tests without running a VRF server.

## Example Usage

```rust
// Create a subscription
let tx = program.methods
    .createEnhancedSubscription(
        new BN(1_000_000), // min_balance
        1,                 // confirmations
        10                 // max_requests
    )
    .accounts({
        owner: wallet.publicKey,
        subscription: subscriptionPDA,
        seed: seedAccount.publicKey,
        systemProgram: SystemProgram.programId,
    })
    .signers([wallet, seedAccount])
    .rpc();

// Request randomness
let tx = program.methods
    .requestRandomness(
        Array.from(seed),           // seed
        Array.from(callbackData),   // callback_data
        1,                          // num_words
        1,                          // minimum_confirmations
        100_000,                    // callback_gas_limit
        poolId                      // pool_id
    )
    .accounts({
        owner: wallet.publicKey,
        request: requestPDA,
        subscription: subscriptionPDA,
        requestPool: requestPoolPDA,
        systemProgram: SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();
```

## Converting from Native Solana

This implementation has converted the original native Solana program to Anchor format, which provides:

1. Better account validation with Anchor constraints
2. Simplified PDA derivation with account seeds
3. Built-in deserialization and account validation
4. Improved error handling with custom error types
5. Simplified testing with Anchor's testing framework
6. Cross-program invocation (CPI) for easy integration

## Environment Setup

Make sure to install Anchor and set up your environment:

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Test the program
anchor test
``` 