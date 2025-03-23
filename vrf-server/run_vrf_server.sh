#!/bin/bash

# Get the directory of this script
SCRIPT_DIR=$(dirname "$0")
cd "$SCRIPT_DIR" || exit

# Default values
FEEPAYER_KEYPAIR_PATH="../kamui-program/keypair.json"
VRF_KEYPAIR_PATH="vrf-keypair.json"
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
RPC_URL="https://api.devnet.solana.com"
WS_URL="wss://api.devnet.solana.com"
LOG_LEVEL="info"
LOG_FILE="vrf-server.log"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --feepayer-keypair)
      FEEPAYER_KEYPAIR_PATH="$2"
      shift 2
      ;;
    --vrf-keypair)
      VRF_KEYPAIR_PATH="$2"
      shift 2
      ;;
    --program-id)
      PROGRAM_ID="$2"
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
    --log-level)
      LOG_LEVEL="$2"
      shift 2
      ;;
    --output-log)
      LOG_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if the keypairs exist and create shared keypair if needed
if [ -f "shared-keypair.json" ]; then
  echo "Found shared keypair file, using it for consistency"
  cp shared-keypair.json "$FEEPAYER_KEYPAIR_PATH"
fi

# Print the settings
echo "Starting VRF server..."
echo "Fee Payer keypair: $FEEPAYER_KEYPAIR_PATH"
echo "VRF keypair: $VRF_KEYPAIR_PATH"
echo "Program ID: $PROGRAM_ID"
echo "RPC URL: $RPC_URL"
echo "WebSocket URL: $WS_URL"
echo "Log level: $LOG_LEVEL"
echo "Output log: $LOG_FILE"

# Check if the binary exists
if [ ! -f "target/release/vrf-server" ]; then
  echo "Building VRF server..."
  cargo build --release
fi

# Run the VRF server
echo "Starting VRF oracle server..."
./target/release/vrf-server \
  --keypair "$FEEPAYER_KEYPAIR_PATH" \
  --program-id "$PROGRAM_ID" \
  --rpc-url "$RPC_URL" \
  --ws-url "$WS_URL" \
  --log-level "$LOG_LEVEL" \
  > "$LOG_FILE" 2>&1 