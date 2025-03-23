#!/bin/bash

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to clean up on exit
cleanup() {
    echo -e "\n${YELLOW}Stopping VRF server...${NC}"
    if [ ! -z "$VRF_SERVER_PID" ]; then
        echo -e "${YELLOW}Killing VRF server process with PID: ${VRF_SERVER_PID}${NC}"
        kill $VRF_SERVER_PID 2>/dev/null || true
        wait $VRF_SERVER_PID 2>/dev/null || true
        echo -e "${GREEN}VRF server stopped${NC}"
    else
        echo -e "${RED}No VRF server PID found${NC}"
        # Try to find and kill any running VRF server processes
        VRF_PIDS=$(pgrep -f vrf-server)
        if [ ! -z "$VRF_PIDS" ]; then
            echo -e "${YELLOW}Found other VRF server processes, killing them...${NC}"
            pkill -f vrf-server
            echo -e "${GREEN}All VRF server processes stopped${NC}"
        fi
    fi
    exit 0
}

# Set up trap to call cleanup function on exit or when Ctrl+C is pressed
trap cleanup EXIT INT TERM

echo -e "${YELLOW}Starting VRF Server with Event Monitoring${NC}"

# Check if the program is built
if [ ! -f "target/release/vrf-server" ]; then
    echo -e "${YELLOW}Building VRF server...${NC}"
    cargo build --release || {
        echo -e "${RED}Failed to build VRF server${NC}"
        exit 1
    }
fi

# Get the program ID from the keypair
PROGRAM_ID=$(solana-keygen pubkey ../kamui-program/keypair.json)
echo -e "${GREEN}Using Program ID: ${PROGRAM_ID}${NC}"

# Generate VRF keypair if it doesn't exist
if [ ! -f "vrf-keypair.json" ]; then
    echo -e "${YELLOW}Generating VRF keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o vrf-keypair.json || {
        echo -e "${RED}Failed to generate VRF keypair${NC}"
        exit 1
    }
fi

# Generate oracle keypair if it doesn't exist
if [ ! -f "oracle-keypair.json" ]; then
    echo -e "${YELLOW}Generating oracle keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o oracle-keypair.json || {
        echo -e "${RED}Failed to generate oracle keypair${NC}"
        exit 1
    }
fi

# Run the VRF server with event monitoring
echo -e "${YELLOW}Starting VRF server with event monitoring...${NC}"
echo -e "${GREEN}Press Ctrl+C to stop the server${NC}"

# Run with debug logging to see more details
RUST_LOG=debug ./target/release/vrf-server \
    --keypair vrf-keypair.json \
    --program-id $PROGRAM_ID \
    --rpc-url https://api.devnet.solana.com \
    --ws-url wss://api.devnet.solana.com \
    --log-level debug &

VRF_SERVER_PID=$!
echo -e "${GREEN}VRF server started with PID: ${VRF_SERVER_PID}${NC}"

# Wait for the VRF server process to complete
# This will keep the script running until the VRF server is stopped
wait $VRF_SERVER_PID 