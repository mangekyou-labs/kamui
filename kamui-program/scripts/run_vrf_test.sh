#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting VRF server with mock feature...${NC}"

# Run the VRF server directly from the kamui-program directory
# This bypasses the workspace issue by using cargo directly in this directory
echo -e "${YELLOW}Running VRF server from kamui-program directory${NC}"
cargo run --bin vrf_server --features mock &
VRF_SERVER_PID=$!

# Give the server a moment to start
sleep 5

echo -e "${YELLOW}VRF server started with PID: ${VRF_SERVER_PID}${NC}"
echo -e "${YELLOW}Running VRF devnet flow test...${NC}"

# Run the test
RUST_LOG=solana_runtime::system_instruction_processor=trace,solana_runtime::message_processor=debug,solana_bpf_loader=debug,solana_rbpf=debug \
cargo test test_vrf_flow_devnet -- --exact --nocapture

# Check test results
TEST_RESULT=$?

# Kill the VRF server
echo -e "${YELLOW}Stopping VRF server...${NC}"
kill $VRF_SERVER_PID 2>/dev/null || echo "VRF server already stopped"

# Check test results
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
else
    echo -e "${RED}Tests failed!${NC}"
    exit 1
fi 