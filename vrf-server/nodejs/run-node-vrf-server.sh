#!/bin/bash

# Script to run the Node.js VRF server

set -e

# Default values
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
ORACLE_KEYPAIR="../oracle-keypair.json"
VRF_KEYPAIR="../vrf-keypair.json"
RPC_URL="https://api.devnet.solana.com"
POLL_INTERVAL=5000

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --program-id)
      PROGRAM_ID="$2"
      shift 2
      ;;
    --keypair)
      ORACLE_KEYPAIR="$2"
      shift 2
      ;;
    --vrf-keypair)
      VRF_KEYPAIR="$2"
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
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Check if the keypair files exist
if [ ! -f "$ORACLE_KEYPAIR" ]; then
  echo "Oracle keypair file not found: $ORACLE_KEYPAIR"
  exit 1
fi

if [ ! -f "$VRF_KEYPAIR" ]; then
  echo "VRF keypair file not found: $VRF_KEYPAIR"
  exit 1
fi

# Ensure npm packages are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Make the script executable
chmod +x vrf-server-nodejs.js

# Print startup info
echo "Starting Node.js VRF Server with:"
echo "Program ID: $PROGRAM_ID"
echo "Oracle Keypair: $ORACLE_KEYPAIR"
echo "VRF Keypair: $VRF_KEYPAIR"
echo "RPC URL: $RPC_URL"
echo "Poll Interval: $POLL_INTERVAL ms"

# Run the server
node vrf-server-nodejs.js \
  --program-id "$PROGRAM_ID" \
  --keypair "$ORACLE_KEYPAIR" \
  --vrf-keypair "$VRF_KEYPAIR" \
  --rpc-url "$RPC_URL" \
  --poll-interval "$POLL_INTERVAL" 