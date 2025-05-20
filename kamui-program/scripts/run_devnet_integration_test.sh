#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to clean up processes on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up processes...${NC}"
  if [ ! -z "$SERVER_PID" ]; then
    echo -e "${YELLOW}Stopping VRF server (PID: $SERVER_PID)${NC}"
    kill $SERVER_PID
  fi
  exit 0
}

# Set up trap to catch Ctrl+C and other termination signals
trap cleanup SIGINT SIGTERM EXIT

# Default config
ENHANCED_MODE=true
BATCH_SIZE=5
LOG_LEVEL="debug"
RPC_URL="https://api.devnet.solana.com"
WS_URL="wss://api.devnet.solana.com"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --enhanced-mode)
      ENHANCED_MODE="$2"
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
    --rpc-url)
      RPC_URL="$2"
      shift 2
      ;;
    --ws-url)
      WS_URL="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Build the VRF server
echo -e "${YELLOW}Building VRF server...${NC}"
cargo build --bin vrf-server --features mock

# Generate keypairs if they don't exist
if [ ! -f "vrf-keypair.json" ]; then
    echo -e "${YELLOW}Generating VRF keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o vrf-keypair.json
fi

if [ ! -f "oracle-keypair.json" ]; then
    echo -e "${YELLOW}Generating Oracle authority keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o oracle-keypair.json
fi

# Get current keypair for funding
KEYPAIR_PATH=$(solana config get keypair | awk '{print $2}')
echo -e "${YELLOW}Using keypair: $KEYPAIR_PATH${NC}"

# Ensure there's enough SOL balance
echo -e "${YELLOW}Checking balance...${NC}"
PUBKEY=$(solana-keygen pubkey $KEYPAIR_PATH)
BALANCE=$(solana balance $PUBKEY | awk '{print $1}')
MIN_REQUIRED=1.0

if (( $(echo "$BALANCE < $MIN_REQUIRED" | bc -l) )); then
  echo -e "${RED}Not enough balance for integration tests. Need at least 1 SOL.${NC}"
  echo -e "${YELLOW}Get SOL from faucet: https://solfaucet.com/${NC}"
  exit 1
fi

# Configure registry settings if enhanced mode is enabled
REGISTRY_OPTIONS=""
if [ "$ENHANCED_MODE" == "true" ]; then
  echo -e "${YELLOW}Preparing for enhanced mode with oracle registry...${NC}"
  # Auto-generate a registry if none exists
  if [ ! -f "registry-id.txt" ]; then
    echo -e "${YELLOW}Creating new oracle registry...${NC}"
    # Will be created when the server runs
    echo "auto-generated" > registry-id.txt
  else
    REGISTRY_ID=$(cat registry-id.txt)
    if [ "$REGISTRY_ID" != "auto-generated" ]; then
      REGISTRY_OPTIONS="--registry-id $REGISTRY_ID"
    fi
  fi
fi

# Create logs directory
mkdir -p logs

# Start the VRF server in the background with explicit parameters
echo -e "${YELLOW}Starting VRF server...${NC}"
RUST_LOG=$LOG_LEVEL ../target/debug/vrf-server \
    --keypair vrf-keypair.json \
    --oracle-keypair oracle-keypair.json \
    --program-id BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D \
    --rpc-url $RPC_URL \
    --ws-url $WS_URL \
    --enhanced-mode $ENHANCED_MODE \
    --batch-size $BATCH_SIZE \
    --log-level $LOG_LEVEL \
    $REGISTRY_OPTIONS > logs/vrf-server-test.log 2>&1 &
SERVER_PID=$!

# Wait for the server to start
echo -e "${YELLOW}Waiting for VRF server to initialize (5 seconds)...${NC}"
sleep 5

# Check if the server is running
if ps -p $SERVER_PID > /dev/null; then
  echo -e "${GREEN}VRF server is running with PID: $SERVER_PID${NC}"
else
  echo -e "${RED}VRF server failed to start${NC}"
  cat logs/vrf-server-test.log
  exit 1
fi

# Set environment variables for the test to use
export VRF_TEST_ENHANCED=$ENHANCED_MODE
export VRF_TEST_ORACLE_KEYPAIR="oracle-keypair.json"
export VRF_TEST_BATCH_SIZE=$BATCH_SIZE
export VRF_TEST_RPC_URL=$RPC_URL

# Run the integration test
echo -e "${YELLOW}Running integration test on devnet...${NC}"
RUST_LOG=$LOG_LEVEL cargo test test_enhanced_vrf_flow_devnet -- --exact --nocapture

# Check test results
TEST_RESULT=$?

# Report results
if [ $TEST_RESULT -eq 0 ]; then
  echo -e "${GREEN}Integration test completed successfully!${NC}"
else
  echo -e "${RED}Integration test failed!${NC}"
  echo -e "${YELLOW}Check logs/vrf-server-test.log for details${NC}"
fi

# The cleanup function will be called automatically on exit
echo -e "${YELLOW}Test completed. Cleaning up...${NC}" 