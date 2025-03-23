## Benchmarks

In `mangekyou`, one can compare all currently implemented cryptographic schemes by running:
```
$ cargo bench
```

## Usage

### Generate keys
```
cargo run --bin ecvrf-cli keygen
```

This outputs a secret key and a public key in hex format. Both the secret and public keys are 32-byte strings:
```
Secret key: 673d09357e636004c6129349a4019120ff09c0f5cb3204c67a64d5b661f93007
Public key: 42b1b195493d8977f9432c1ea8208a8cf9adba1be06ed555ee1732c5b0637261
```

### Compute VRF output and proof

To compute the VRF output and proof for the input string Hi Kamui!, which is 4869204b616d756921 in hexadecimal, with the key pair generated previously, run the following command:

```
cargo run --bin ecvrf-cli prove --input 4869204b616d756921 --secret-key 673d09357e636004c6129349a4019120ff09c0f5cb3204c67a64d5b661f93007
```

This should the 80-byte proof and VRF 64-byte output, both in hex format:
```
Proof:  42b1b195493d8977f9432c1ea8208a8cf9adba1be06ed555ee1732c5b0637261d9cd24cdb47ab446b86451974dab1ea382065e17c22085c63cfd7059ec834d08433c3158debd8e69547997a07fa083c9
Output: cd6a1b9e6751a55fec6e196c8a62a0ddbe64b080ebcbd571ecab1c28d80a94d809ca8d803fafbc814874de36f6540055057faafdba85395e6ae2b7256cbde94b
```

### Verify proof

1. You can verify the proof and output in a solana smart contract using mangekyou::ecvrf::ecvrf_verify from the Mangekyou Network (coming soon)

2. You can also use the CLI tool for verification:

```
cargo run --bin ecvrf-cli verify --output cd6a1b9e6751a55fec6e196c8a62a0ddbe64b080ebcbd571ecab1c28d80a94d809ca8d803fafbc814874de36f6540055057faafdba85395e6ae2b7256cbde94b --proof 42b1b195493d8977f9432c1ea8208a8cf9adba1be06ed555ee1732c5b0637261d9cd24cdb47ab446b86451974dab1ea382065e17c22085c63cfd7059ec834d08433c3158debd8e69547997a07fa083c9 --input 4869204b616d756921 --public-key 42b1b195493d8977f9432c1ea8208a8cf9adba1be06ed555ee1732c5b0637261
```

The preceding command returns the verification:
```
Proof verified correctly!
```

## Tests

There exist unit tests for all primitives in all three crates, which can be run by: 
```
$ cargo test
```

# Node.js VRF Server

This is a Node.js implementation of a VRF (Verifiable Random Function) server for Solana, designed to work with the existing Rust-based ECVRF cryptographic operations.

## Overview

The server is designed to:

1. Monitor Solana blockchain for pending randomness requests
2. Call the Rust-based ECVRF library to generate cryptographic proofs
3. Submit transactions to fulfill randomness requests with the generated proofs

This hybrid approach provides:

- Simplified server logic in Node.js
- Robust cryptographic operations using the established Rust ECVRF implementation
- Compatibility with the existing VRF keypair format

## Prerequisites

- Node.js 16+
- Rust toolchain with Cargo
- Solana CLI tools
- Existing VRF and Oracle keypairs

## Installation

1. Clone the repository
2. Build the Rust ECVRF binary:
   ```
   cd vrf-server
   cargo build --release
   ```
3. Install Node.js dependencies:
   ```
   cd ..
   npm install
   ```

## Usage

Run the server using the provided script:

```bash
./run-node-vrf-server.sh --program-id <PROGRAM_ID> --keypair <ORACLE_KEYPAIR> --vrf-keypair <VRF_KEYPAIR>
```

### Command-line Options

- `--program-id`: Solana program ID of the VRF coordinator
- `--keypair`: Path to the Oracle keypair file (default: `oracle-keypair.json`)
- `--vrf-keypair`: Path to the VRF keypair file (default: `vrf-keypair.json`)
- `--rpc-url`: Solana RPC URL (default: `https://api.devnet.solana.com`)
- `--poll-interval`: Polling interval in milliseconds (default: 5000)

## How It Works

1. The server initializes by loading Oracle and VRF keypairs
2. It periodically checks for pending randomness requests on-chain
3. When a request is found, it extracts the seed and calls the Rust ECVRF binary to generate a proof
4. The server then submits a transaction to fulfill the request with the generated proof

## Development

To make changes to the VRF server:

1. Modify `vrf-server-nodejs.js` for server logic changes
2. If changes to the ECVRF implementation are needed, make them in the Rust code under `vrf-server/src`
3. Rebuild the Rust binary after changes:
   ```
   cd vrf-server
   cargo build --release
   ```

## Troubleshooting

Check the log files for details:

- Node.js server logs: `vrf-server-nodejs.log`
- Rust VRF binary logs: `vrf-server/vrf-server.log`

Common issues:

1. **Keypair files not found**: Make sure the paths to the keypair files are correct
2. **Oracle account balance too low**: Fund the Oracle account with SOL
3. **Rust binary fails**: Check if the VRF keypair is in the correct format