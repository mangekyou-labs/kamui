# Node.js VRF Server

This is a Node.js implementation of a VRF (Verifiable Random Function) server for Solana, designed to work with the existing Rust-based ECVRF cryptographic operations in the parent directory.

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
- Rust toolchain with Cargo (already set up for the parent vrf-server project)
- Solana CLI tools
- Existing VRF and Oracle keypairs (shared with the Rust implementation)

## Installation

1. From the parent vrf-server directory, build the Rust ECVRF binary:
   ```
   cargo build --release
   ```
   
2. Install Node.js dependencies:
   ```
   cd nodejs
   npm install
   ```

## Usage

Run the server using the provided script:

```bash
cd vrf-server/nodejs
./run-node-vrf-server.sh --program-id <PROGRAM_ID> --keypair <ORACLE_KEYPAIR> --vrf-keypair <VRF_KEYPAIR>
```

Or to use the same keypairs as the Rust implementation:

```bash
cd vrf-server/nodejs
./run-node-vrf-server.sh --program-id <PROGRAM_ID> --keypair ../oracle-keypair.json --vrf-keypair ../vrf-keypair.json
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
2. If changes to the ECVRF implementation are needed, make them in the Rust code under the parent `vrf-server/src` directory
3. Rebuild the Rust binary after changes:
   ```
   cd ..
   cargo build --release
   ```

## Troubleshooting

Check the log files for details:

- Node.js server logs: `vrf-server-nodejs.log`
- Rust VRF binary logs: `../vrf-server.log`

Common issues:

1. **Keypair files not found**: Make sure the paths to the keypair files are correct
2. **Oracle account balance too low**: Fund the Oracle account with SOL
3. **Rust binary fails**: Check if the VRF keypair is in the correct format 