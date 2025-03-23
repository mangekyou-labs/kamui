# VRF Server

This repository contains two implementations of a VRF (Verifiable Random Function) server for the Solana blockchain:

1. **Polling-based Server**: Monitors VRF request accounts by polling for transactions on the Solana blockchain.
2. **WebSocket-based Server**: Monitors VRF request accounts by subscribing to program logs via WebSocket.

Both implementations fulfill randomness requests by generating cryptographic proofs and submitting them back to the blockchain.

## Features

### Polling-based Server
- Efficient transaction polling to detect randomness requests
- Log-based request detection for reliable request identification
- Automatic retry mechanism for failed fulfillment attempts
- Backup scanning for pending requests

### WebSocket-based Server
- Real-time processing using Solana's native WebSocket `logsSubscribe`
- More resource-efficient than regular polling
- Log-based request detection for reliable request identification
- Backup scanning to catch any missed requests

## Prerequisites

- Node.js (v14 or later)
- npm
- Solana CLI tools (for key management)

## File Setup

Place the following files in the `vrf-server` directory:
- `keypair.json` - The fee payer keypair file (used to pay for transactions)
- `vrf-keypair.json` - The VRF keypair file (used for cryptographic operations)

## Configuration

Both implementations require the following parameters:

- **Program ID**: The address of the VRF Coordinator program on Solana
- **Fee Payer Keypair**: A keypair with SOL to pay for transaction fees
- **VRF Keypair**: The keypair used to generate VRF proofs
- **RPC URL**: Solana RPC endpoint URL

### Polling-specific Configuration
- **Poll Interval**: How frequently to poll for transactions (in milliseconds)
- **Transaction Limit**: Maximum number of transactions to retrieve per poll

### WebSocket-specific Configuration
- **WebSocket URL**: Solana WebSocket endpoint URL (optional, derived from RPC URL if not provided)
- **Scan Interval**: How frequently to perform backup scans for missed requests (in milliseconds)

## Usage

### Polling-based Server
```
./run_vrf_server_polling.sh [options]
```

### WebSocket-based Server
```
./run_vrf_server_websocket.sh [options]
```

### Options
- `--program-id`: Specify the VRF Coordinator program ID
- `--feepayer-keypair`: Path to the fee payer keypair file
- `--vrf-keypair`: Path to the VRF keypair file
- `--rpc-url`: Solana RPC endpoint URL

#### Polling-specific Options
- `--poll-interval`: Set polling interval (milliseconds)
- `--transaction-limit`: Set maximum transactions per poll

#### WebSocket-specific Options
- `--ws-url`: Specify WebSocket URL (optional)
- `--scan-interval`: Set backup scan interval (milliseconds)

## Examples

### Start the Polling-based Server
```
./run_vrf_server_polling.sh --program-id BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D --rpc-url https://api.devnet.solana.com
```

### Start the WebSocket-based Server
```
./run_vrf_server_websocket.sh --program-id BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D --rpc-url https://api.devnet.solana.com
```

## How It Works

1. The server regularly polls for recent transactions involving the VRF program.
2. When transactions are found, it checks their logs for RequestRandomness instructions.
3. For new pending requests, it:
   - Extracts the seed from the request account
   - Generates a VRF proof using the Rust implementation
   - Creates and submits a transaction to fulfill the request
4. In parallel, it regularly scans for any pending request accounts to catch any missed requests.

## Performance Considerations

- Increasing `poll-interval` and `transaction-limit` can improve response times but may use more RPC resources.
- Request fulfillment speed is primarily limited by Solana network confirmation times.
- Using a reliable RPC provider is important for consistent performance.

## Troubleshooting

- **RPC Connection Issues**: Check your RPC endpoint and connection settings.
- **Proof Generation Failures**: Ensure the Rust components are built correctly and the VRF keypair is properly formatted.
- **Transaction Errors**: Review the logs for detailed error messages from the Solana network.

## License

[MIT]

## Credits

This implementation builds upon the Kamui VRF program. 