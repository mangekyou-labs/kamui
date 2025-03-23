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

# Copy the test keypair from the main project
echo -e "${YELLOW}Copying test keypair...${NC}"
cp /Users/zeref/workdir/mangekyou/kamui-program/keypair.json .

# Generate VRF keypair if it doesn't exist
if [ ! -f "vrf-keypair.json" ]; then
    echo -e "${YELLOW}Generating VRF keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o vrf-keypair.json
fi

# Start the VRF server in the background
echo -e "${YELLOW}Starting VRF server...${NC}"
RUST_LOG=debug ./target/debug/vrf-server \
    --keypair vrf-keypair.json \
    --program-id BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D \
    --rpc-url https://api.devnet.solana.com \
    --ws-url wss://api.devnet.solana.com \
    --log-level debug &
SERVER_PID=$!

# Wait for the server to start
echo -e "${YELLOW}Waiting for VRF server to initialize (5 seconds)...${NC}"
sleep 5

# Check if the server is running
if ps -p $SERVER_PID > /dev/null; then
  echo -e "${GREEN}VRF server is running with PID: $SERVER_PID${NC}"
else
  echo -e "${RED}VRF server failed to start${NC}"
  exit 1
fi

# Run the integration test
echo -e "${YELLOW}Running integration test on devnet...${NC}"
cd /Users/zeref/workdir/mangekyou/kamui-program
RUST_LOG=debug cargo test test_vrf_flow_devnet -- --exact --nocapture

# Check test results
TEST_RESULT=$?

# Report results
if [ $TEST_RESULT -eq 0 ]; then
  echo -e "${GREEN}Integration test completed successfully!${NC}"
else
  echo -e "${RED}Integration test failed!${NC}"
fi

# The cleanup function will be called automatically on exit
echo -e "${YELLOW}Test completed. Cleaning up...${NC}" 