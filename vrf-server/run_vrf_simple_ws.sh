#!/bin/bash

# Run simplified VRF Server with WebSocket
# This script runs the simplified VRF server that uses Solana's WebSocket logsSubscribe
# Updated to support enhanced VRF features: subscription pools, oracle registry, and batch processing

# Default values
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
FEEPAYER_KEYPAIR_PATH="keypair.json"
VRF_KEYPAIR_PATH="vrf-keypair.json"
ORACLE_KEYPAIR_PATH="oracle-keypair.json" # Oracle authority keypair
RPC_URL="https://api.devnet.solana.com"
WS_URL=""  # Will be derived from RPC_URL if not provided
SCAN_INTERVAL=30000
REGISTRY_ID=""  # Optional registry ID
BATCH_SIZE=10   # Number of requests to process in a batch
LOG_LEVEL="info" # Logging level: info, debug, trace

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
    --oracle-keypair)
      ORACLE_KEYPAIR_PATH="$2"
      shift 2
      ;;  
    --registry-id)
      REGISTRY_ID="$2"
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
    --batch-size)
      BATCH_SIZE="$2"
      shift 2
      ;;
    --log-level)
      LOG_LEVEL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Print configuration
echo "Starting enhanced VRF server with WebSocket logsSubscribe..."
echo "Program ID: $PROGRAM_ID"
echo "Fee Payer Keypair: $FEEPAYER_KEYPAIR_PATH"
echo "VRF Keypair: $VRF_KEYPAIR_PATH"
echo "Oracle Authority Keypair: $ORACLE_KEYPAIR_PATH"
echo "RPC URL: $RPC_URL"
echo "Batch Size: $BATCH_SIZE requests"
echo "Log Level: $LOG_LEVEL"

if [ -n "$WS_URL" ]; then
  echo "WebSocket URL: $WS_URL"
else
  echo "WebSocket URL: (derived from RPC URL)"
fi

if [ -n "$REGISTRY_ID" ]; then
  echo "Registry ID: $REGISTRY_ID"
else
  echo "Registry ID: (auto-detected)"
fi
echo "Backup Scan Interval: $SCAN_INTERVAL ms"

# Check if keypairs exist, generate if needed
if [ ! -f "$VRF_KEYPAIR_PATH" ]; then
  echo "VRF keypair not found, generating a new one..."
  solana-keygen new --no-bip39-passphrase -o "$VRF_KEYPAIR_PATH"
fi

if [ ! -f "$ORACLE_KEYPAIR_PATH" ]; then
  echo "Oracle authority keypair not found, generating a new one..."
  solana-keygen new --no-bip39-passphrase -o "$ORACLE_KEYPAIR_PATH"
fi

# Install required dependencies
echo "Installing dependencies..."
npm install ws tweetnacl commander borsh bs58 solana-web3.js

# Make the server script executable
chmod +x vrf-server-websocket.js

# Run the server
echo "Starting VRF server..."
WS_OPTIONS=""
if [ -n "$WS_URL" ]; then
  WS_OPTIONS="--ws-url $WS_URL"
fi

REGISTRY_OPTIONS=""
if [ -n "$REGISTRY_ID" ]; then
  REGISTRY_OPTIONS="--registry-id $REGISTRY_ID"
fi

# Stop any existing processes
pkill -f "node vrf-server-websocket.js" || true

# Create log directory if it doesn't exist
mkdir -p logs

# Get timestamp for log file name
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/vrf-server-${TIMESTAMP}.log"

# Run with output to dedicated log file
node vrf-server-websocket.js \
  --program-id "$PROGRAM_ID" \
  --feepayer-keypair "$FEEPAYER_KEYPAIR_PATH" \
  --vrf-keypair "$VRF_KEYPAIR_PATH" \
  --rpc-url "$RPC_URL" \
  $WS_OPTIONS \
  --scan-interval "$SCAN_INTERVAL" > "$LOG_FILE" 2>&1 &

# Save the PID
SERVER_PID=$!
echo $SERVER_PID > vrf-server-websocket.pid
echo "VRF WebSocket server started with PID $SERVER_PID"
echo "Check $LOG_FILE for output"

# Monitor the logs in real-time (optional, can be killed with Ctrl+C without stopping the server)
echo "Showing live logs (Ctrl+C to stop viewing logs, server will continue running)..."
tail -f "$LOG_FILE" 
