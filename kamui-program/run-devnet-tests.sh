#!/bin/bash

# This script deploys and runs tests on Solana devnet

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Set required environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Default program IDs
VRF_PROGRAM_ID="4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1"
CONSUMER_PROGRAM_ID="4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y"

# Get wallet public key
WALLET_PUBKEY=$(solana address -k $ANCHOR_WALLET)

echo -e "${YELLOW}=== Kamui VRF Devnet Testing ===${NC}"
echo "Using wallet: $WALLET_PUBKEY"

# Check wallet balance
echo -e "\n${YELLOW}=== Checking Wallet Balance ===${NC}"
BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
echo "Current balance: $BALANCE SOL"

MIN_SOL=0.5
if (( $(echo "$BALANCE < $MIN_SOL" | bc -l) )); then
    echo -e "${YELLOW}Balance is low. Do you want to try to get an airdrop? (y/n)${NC}"
    read -r response
    if [[ "$response" == "y" ]]; then
        echo "Requesting airdrop..."
        solana airdrop 1 -k $ANCHOR_WALLET --url $ANCHOR_PROVIDER_URL
        BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
        echo "New balance: $BALANCE SOL"
    fi
fi

# Verify programs exist
echo -e "\n${YELLOW}=== Verifying Programs ===${NC}"
echo "Checking VRF program: $VRF_PROGRAM_ID"
if ! solana program show $VRF_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
    echo -e "${RED}Error: VRF program ID $VRF_PROGRAM_ID doesn't exist on devnet${NC}"
    exit 1
else
    echo -e "${GREEN}✓ VRF program verified${NC}"
fi

echo "Checking Consumer program: $CONSUMER_PROGRAM_ID"
if ! solana program show $CONSUMER_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
    echo -e "${YELLOW}Warning: Consumer program ID $CONSUMER_PROGRAM_ID doesn't exist on devnet${NC}"
    echo "Some tests may fail, but we'll continue anyway"
else
    echo -e "${GREEN}✓ Consumer program verified${NC}"
fi

# Update Anchor.toml
echo -e "\n${YELLOW}=== Updating Anchor.toml ===${NC}"
sed -i.bak "s/kamui_vrf = \"[^\"]*\"/kamui_vrf = \"$VRF_PROGRAM_ID\"/" Anchor.toml
sed -i.bak "s/kamui_vrf_consumer = \"[^\"]*\"/kamui_vrf_consumer = \"$CONSUMER_PROGRAM_ID\"/" Anchor.toml
echo -e "${GREEN}✓ Updated Anchor.toml with program IDs${NC}"

# Update simple-test.ts
echo -e "\n${YELLOW}=== Updating Test File ===${NC}"
sed -i.bak "s/const vrfProgramId = new PublicKey(\"[^\"]*\")/const vrfProgramId = new PublicKey(\"$VRF_PROGRAM_ID\")/" tests/simple-test.ts
sed -i.bak "s/const consumerProgramId = new PublicKey(\"[^\"]*\")/const consumerProgramId = new PublicKey(\"$CONSUMER_PROGRAM_ID\")/" tests/simple-test.ts
echo -e "${GREEN}✓ Updated test file with program IDs${NC}"

# Clean up backup files
rm -f Anchor.toml.bak tests/simple-test.ts.bak

# Run tests
echo -e "\n${YELLOW}=== Running Tests on Devnet ===${NC}"
echo "This will use real devnet SOL for transactions!"
echo -e "${YELLOW}Press Ctrl+C now to abort if you don't want to proceed.${NC}"
sleep 3

# Run the tests with devnet configuration
echo "Starting tests..."
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/simple-test.ts

# Display transaction history
echo -e "\n${YELLOW}=== Recent Transactions ===${NC}"
echo "Recent transactions from wallet $WALLET_PUBKEY"
echo "Check them on Solana Explorer: https://explorer.solana.com/address/$WALLET_PUBKEY?cluster=devnet"

echo -e "\n${GREEN}=== Testing Complete! ===${NC}" 