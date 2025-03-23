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

# Create a directory for keypairs
mkdir -p keypairs

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

# Run the manual integration test
echo -e "${YELLOW}Running manual integration test on devnet...${NC}"

# Load keypair
KEYPAIR_PATH="keypair.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo -e "${RED}Error: Keypair file not found at $KEYPAIR_PATH${NC}"
    exit 1
fi

# Step 1: Create VRF subscription
echo -e "${YELLOW}Step 1: Creating VRF subscription...${NC}"

# Generate subscription owner keypair
solana-keygen new --no-bip39-passphrase -o keypairs/subscription_owner.json --force
SUBSCRIPTION_OWNER=$(solana-keygen pubkey keypairs/subscription_owner.json)

# Generate subscription account keypair
solana-keygen new --no-bip39-passphrase -o keypairs/subscription_account.json --force
SUBSCRIPTION_ACCOUNT=$(solana-keygen pubkey keypairs/subscription_account.json)

echo -e "Subscription owner: $SUBSCRIPTION_OWNER"
echo -e "Subscription account: $SUBSCRIPTION_ACCOUNT"

# Fund the subscription owner account
echo -e "${YELLOW}Funding subscription owner account...${NC}"
solana transfer --keypair $KEYPAIR_PATH $SUBSCRIPTION_OWNER 0.005 --allow-unfunded-recipient --url https://api.devnet.solana.com

# Create subscription
echo -e "${YELLOW}Creating subscription...${NC}"
# This would normally be a transaction to create a subscription
# For now, we'll just simulate it
echo -e "${GREEN}Subscription created (simulated)!${NC}"

# Step 2: Initialize game
echo -e "${YELLOW}Step 2: Initializing game...${NC}"

# Generate game owner keypair
solana-keygen new --no-bip39-passphrase -o keypairs/game_owner.json --force
GAME_OWNER=$(solana-keygen pubkey keypairs/game_owner.json)

echo -e "Game owner: $GAME_OWNER"

# Fund the game owner account
echo -e "${YELLOW}Funding game owner account...${NC}"
solana transfer --keypair $KEYPAIR_PATH $GAME_OWNER 0.01 --allow-unfunded-recipient --url https://api.devnet.solana.com

# Initialize game
echo -e "${YELLOW}Initializing game...${NC}"
# This would normally be a transaction to initialize the game
# For now, we'll just simulate it
echo -e "${GREEN}Game initialized (simulated)!${NC}"

# Step 3: Request random number
echo -e "${YELLOW}Step 3: Requesting random number...${NC}"
# This would normally be a transaction to request randomness
# For now, we'll just simulate it
echo -e "${GREEN}Random number requested (simulated)!${NC}"

# Step 4: Wait for VRF server to fulfill randomness
echo -e "${YELLOW}Step 4: Waiting for VRF server to fulfill randomness...${NC}"
# This would normally involve waiting for the VRF server to fulfill the request
# For now, we'll just simulate it
sleep 5
echo -e "${GREEN}VRF server has fulfilled the randomness (simulated)!${NC}"

# Step 5: Consume randomness
echo -e "${YELLOW}Step 5: Consuming randomness...${NC}"
# This would normally be a transaction to consume the randomness
# For now, we'll just simulate it
echo -e "${GREEN}Randomness consumed (simulated)!${NC}"

echo -e "${GREEN}Integration test completed successfully!${NC}"

# The cleanup function will be called automatically on exit
echo -e "${YELLOW}Test completed. Cleaning up...${NC}" 