# Kamui Enhanced VRF Tests

This directory contains tests for the Kamui Enhanced VRF system. The tests are written to allow direct proof generation without relying on the VRF server, making them faster and more reliable for CI/CD environments.

## Test Types

1. **Direct On-Chain Tests (`enhanced_vrf_local_test.rs`)**:
   - Uses the Solana Program Test framework
   - Tests the entire flow of the VRF system
   - Generates VRF proofs directly without requiring a server

2. **Anchor Tests (`anchor/`)**:
   - Tests from a client perspective using the Anchor framework
   - Demonstrates how to interact with the VRF system in a dApp
   - Includes a sample consumer program to show full integration

## Running the Tests

### On-Chain Tests

To run the on-chain Rust tests:

```bash
cd kamui-program
cargo test enhanced_vrf_local_test -- --nocapture
```

### Anchor Tests

To run the Anchor tests:

```bash
cd kamui-program/tests/anchor
yarn install
anchor test
```

## Test Flow

The tests follow this general flow:

1. **Setup**:
   - Initialize an Oracle Registry
   - Register an Oracle with stake
   - Create and fund a Subscription
   - Initialize a Request Pool

2. **Request & Fulfill**:
   - Request randomness
   - Generate VRF proof directly using the ECVRF keypair
   - Fulfill the request with the generated proof
   - Consume the randomness in the consumer program

3. **Batch Processing**:
   - Create multiple requests
   - Generate proofs for each request
   - Process all requests in a single batch transaction

## Using the ECVRF Keypair for Direct Proof Generation

The tests demonstrate how to use the ECVRF keypair directly to generate proofs without needing the VRF server. This is done by:

1. Creating an `ECVRFKeyPair` instance
2. Using its `output()` method to generate both the output and the proof
3. Using the generated proof to fulfill the request

Example:

```rust
// Generate a keypair
let vrf_keypair = ECVRFKeyPair::generate(&mut rand::thread_rng());

// Generate seed for randomness
let seed: [u8; 32] = rand::random();

// Generate proof directly
let (output, proof) = vrf_keypair.output(&seed);
let proof_bytes = proof.to_bytes();

// Use the proof to fulfill a request
// ...
```

This approach allows for fast and deterministic testing without needing to run a VRF server. 