#!/bin/bash

# Run VRF Server with WebSocket
# This script runs the VRF server with Solana's native WebSocket logsSubscribe

# Default values
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
FEEPAYER_KEYPAIR_PATH="keypair.json"
VRF_KEYPAIR_PATH="vrf-keypair.json"
RPC_URL="https://api.devnet.solana.com"
WS_URL=""  # Will be derived from RPC_URL if not provided
SCAN_INTERVAL=30000

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --program-id)
      PROGRAM_ID="$2"
      shift 2
      ;;
    --feepayer-keypair)
      FEEPAYER_KEYPAIR_PATH="$2"
      shift 2
      ;;
    --vrf-keypair)
      VRF_KEYPAIR_PATH="$2"
      shift 2
      ;;
    --rpc-url)
      RPC_URL="$2"
      shift 2
      ;;
    --ws-url)
      WS_URL="$2"
      shift 2
      ;;
    --scan-interval)
      SCAN_INTERVAL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Print configuration
echo "Starting VRF server with WebSocket logsSubscribe..."
echo "Program ID: $PROGRAM_ID"
echo "Fee Payer Keypair: $FEEPAYER_KEYPAIR_PATH"
echo "VRF Keypair: $VRF_KEYPAIR_PATH"
echo "RPC URL: $RPC_URL"
if [ -n "$WS_URL" ]; then
  echo "WebSocket URL: $WS_URL"
else
  echo "WebSocket URL: (derived from RPC URL)"
fi
echo "Backup Scan Interval: $SCAN_INTERVAL ms"

# Install required dependencies
echo "Installing dependencies..."
npm install ws tweetnacl log4js commander bn.js bs58 winston

# Run the server
echo "Starting VRF server..."
WS_OPTIONS=""
if [ -n "$WS_URL" ]; then
  WS_OPTIONS="--ws-url $WS_URL"
fi

# Run with output logged to file
node vrf-server-websocket.js \
  --program-id "$PROGRAM_ID" \
  --feepayer-keypair "$FEEPAYER_KEYPAIR_PATH" \
  --vrf-keypair "$VRF_KEYPAIR_PATH" \
  --rpc-url "$RPC_URL" \
  $WS_OPTIONS \
  --scan-interval "$SCAN_INTERVAL" > vrf-server-websocket.log 2>&1 &

# Save the PID
echo $! > vrf-server-websocket.pid
echo "VRF WebSocket server started with PID $!"
echo "Check vrf-server-websocket.log for output" 