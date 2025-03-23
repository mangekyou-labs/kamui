#!/bin/bash

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Deploying VRF Program to Devnet${NC}"

# Check if keypair.json exists
if [ ! -f "keypair.json" ]; then
    echo -e "${RED}Error: keypair.json not found in the current directory${NC}"
    exit 1
fi

# Build the program
echo -e "${YELLOW}Building the program...${NC}"
cargo build-bpf || {
    echo -e "${RED}Failed to build the program${NC}"
    exit 1
}

# Get the program ID from the keypair
PROGRAM_ID=$(solana-keygen pubkey keypair.json)
echo -e "${GREEN}Program ID: ${PROGRAM_ID}${NC}"

# Deploy the program
echo -e "${YELLOW}Deploying the program to devnet...${NC}"
solana program deploy \
    --keypair keypair.json \
    --url https://api.devnet.solana.com \
    --program-id keypair.json \
    target/deploy/kamui_program.so || {
    echo -e "${RED}Failed to deploy the program${NC}"
    exit 1
}

echo -e "${GREEN}Program deployed successfully!${NC}"
echo -e "${YELLOW}Program ID: ${PROGRAM_ID}${NC}"

# Update the VRF server configuration
echo -e "${YELLOW}Updating VRF server configuration...${NC}"
cd ../vrf-server
sed -i '' "s/program_id: String,\n    #\[arg(short, long, default_value = \".*\")\]/program_id: String,\n    #\[arg(short, long, default_value = \"$PROGRAM_ID\")\]/g" src/bin/vrf_server.rs

echo -e "${GREEN}VRF server configuration updated!${NC}"
echo -e "${YELLOW}You can now run the VRF server with:${NC}"
echo -e "${GREEN}cd ../vrf-server && cargo run --bin vrf-server${NC}" 