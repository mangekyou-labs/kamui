#!/bin/bash

# Script to get devnet SOL for testing using multiple faucets

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

KEYPAIR="./keypair.json"
DEVNET_URL="https://api.devnet.solana.com"

# Get public key
PUBKEY=$(solana address -k $KEYPAIR)

echo -e "${YELLOW}=== Devnet SOL Faucet Script ===${NC}"
echo "Wallet: $PUBKEY"

# Check current balance
current_balance() {
    BAL=$(solana balance -k $KEYPAIR --url $DEVNET_URL | awk '{print $1}')
    echo -e "Current balance: ${GREEN}$BAL SOL${NC}"
    return 0
}

current_balance

# Try official Solana airdrop
echo -e "\n${YELLOW}=== Trying Official Solana Faucet ===${NC}"
for i in {1..3}; do
    echo "Attempt $i: Requesting 1 SOL..."
    if solana airdrop 1 -k $KEYPAIR --url $DEVNET_URL; then
        echo -e "${GREEN}Success!${NC}"
        current_balance
        break
    else
        echo -e "${RED}Failed.${NC} Waiting 5 seconds..."
        sleep 5
    fi
done

# List other faucet options
echo -e "\n${YELLOW}=== Additional Devnet SOL Options ===${NC}"
echo "1. Visit https://solfaucet.com/ and enter your address: $PUBKEY"
echo "2. Visit https://faucet.solana.com/ and request devnet SOL"
echo "3. Use the Solana CLI to transfer SOL from another wallet"

echo -e "\n${YELLOW}=== For CI/CD Environments ===${NC}"
echo "To get SOL programmatically, consider these options:"
echo "1. Set up a devnet SOL treasury wallet with sufficient funds"
echo "2. Transfer small amounts to test wallets before tests"
echo "3. Implement retry mechanisms for airdrop requests"

echo -e "\n${YELLOW}=== Final Balance ===${NC}"
current_balance

echo -e "\n${GREEN}Done!${NC}" 