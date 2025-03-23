#!/bin/bash

# Run VRF Server with Polling
# This script runs the VRF server with a polling approach to monitor transactions

# Default values
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
FEEPAYER_KEYPAIR_PATH="keypair.json"
VRF_KEYPAIR_PATH="vrf-keypair.json"
RPC_URL="https://api.devnet.solana.com"
POLL_INTERVAL=5000
TRANSACTION_LIMIT=20

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
    --poll-interval)
      POLL_INTERVAL="$2"
      shift 2
      ;;
    --transaction-limit)
      TRANSACTION_LIMIT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Print configuration
echo "Starting VRF server with polling..."
echo "Program ID: $PROGRAM_ID"
echo "Fee Payer Keypair: $FEEPAYER_KEYPAIR_PATH"
echo "VRF Keypair: $VRF_KEYPAIR_PATH"
echo "RPC URL: $RPC_URL"
echo "Poll Interval: $POLL_INTERVAL ms"
echo "Transaction Limit: $TRANSACTION_LIMIT"

# Install required dependencies
echo "Installing dependencies..."
npm install

# Run the server
echo "Starting VRF server..."
node vrf-server-nodejs.js \
  --program-id "$PROGRAM_ID" \
  --feepayer-keypair "$FEEPAYER_KEYPAIR_PATH" \
  --vrf-keypair "$VRF_KEYPAIR_PATH" \
  --rpc-url "$RPC_URL" \
  --poll-interval "$POLL_INTERVAL" \
  --transaction-limit "$TRANSACTION_LIMIT" 