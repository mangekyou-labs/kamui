#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}Error: Solana CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Create keypair file if it doesn't exist
if [ ! -f "keypair.json" ]; then
    echo -e "${YELLOW}Creating new keypair for testing...${NC}"
    solana-keygen new --no-passphrase -o keypair.json
else
    echo -e "${YELLOW}Keypair file already exists.${NC}"
fi

# Get public key
PUBKEY=$(solana-keygen pubkey keypair.json)
echo -e "${GREEN}Keypair public key: ${PUBKEY}${NC}"

# Check balance
BALANCE=$(solana balance $PUBKEY --url devnet)
echo -e "${YELLOW}Current balance on devnet: ${BALANCE}${NC}"

# Request airdrop if balance is low
if [[ "$BALANCE" == "0 SOL" || "$BALANCE" == "0.00000000 SOL" ]]; then
    echo -e "${YELLOW}Requesting airdrop of 2 SOL...${NC}"
    solana airdrop 2 $PUBKEY --url devnet
    
    # Check new balance
    NEW_BALANCE=$(solana balance $PUBKEY --url devnet)
    echo -e "${GREEN}New balance: ${NEW_BALANCE}${NC}"
else
    echo -e "${GREEN}Balance is sufficient for testing.${NC}"
fi

echo -e "${GREEN}Keypair is ready for testing!${NC}" 