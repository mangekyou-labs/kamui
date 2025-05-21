#!/bin/bash

# Script to deploy Kamui VRF programs to devnet
# This will build and deploy the programs and update the Anchor.toml file with the new program IDs

# Exit on error
set -e

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Kamui VRF Devnet Deployment ===${NC}"

# Check if solana-keygen is installed
if ! command -v solana-keygen &> /dev/null; then
    echo -e "${RED}Error: solana-keygen is not installed.${NC}"
    echo "Please install the Solana CLI tools: https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi

# Check if anchor is installed
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}Error: anchor is not installed.${NC}"
    echo "Please install Anchor: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

# Check if keypair.json exists, create it if it doesn't
if [ ! -f keypair.json ]; then
    echo -e "${YELLOW}No keypair.json found, creating a new one...${NC}"
    solana-keygen new --no-bip39-passphrase -o keypair.json
fi

# Set Solana config to use devnet and the keypair
echo -e "${BLUE}Setting Solana config to use devnet and keypair.json...${NC}"
solana config set --url devnet --keypair keypair.json

# Check balance
BALANCE=$(solana balance | awk '{print $1}')
echo -e "${BLUE}Current balance: ${BALANCE} SOL${NC}"

# Request airdrop if balance is low
if (( $(echo "$BALANCE < 1.0" | bc -l) )); then
    echo -e "${YELLOW}Balance is low, requesting airdrop...${NC}"
    solana airdrop 2
    echo -e "${GREEN}New balance: $(solana balance | awk '{print $1}') SOL${NC}"
fi

# Build the programs
echo -e "${BLUE}Building Kamui VRF programs...${NC}"
anchor build

# Deploy the programs to devnet
echo -e "${BLUE}Deploying programs to devnet...${NC}"

# Deploy Kamui VRF
echo -e "${BLUE}Deploying Kamui VRF...${NC}"
KAMUI_VRF_KEYPAIR="target/deploy/kamui_vrf-keypair.json"
KAMUI_VRF_PROGRAM_ID=$(solana deploy --keypair $KAMUI_VRF_KEYPAIR | grep "Program Id" | awk '{print $3}')
echo -e "${GREEN}Kamui VRF deployed with program ID: ${KAMUI_VRF_PROGRAM_ID}${NC}"

# Deploy Kamui VRF Consumer
echo -e "${BLUE}Deploying Kamui VRF Consumer...${NC}"
KAMUI_VRF_CONSUMER_KEYPAIR="target/deploy/kamui_vrf_consumer-keypair.json"
KAMUI_VRF_CONSUMER_PROGRAM_ID=$(solana deploy --keypair $KAMUI_VRF_CONSUMER_KEYPAIR | grep "Program Id" | awk '{print $3}')
echo -e "${GREEN}Kamui VRF Consumer deployed with program ID: ${KAMUI_VRF_CONSUMER_PROGRAM_ID}${NC}"

# Deploy Kamui LayerZero
echo -e "${BLUE}Deploying Kamui LayerZero...${NC}"
KAMUI_LAYERZERO_KEYPAIR="target/deploy/kamui_layerzero-keypair.json"
KAMUI_LAYERZERO_PROGRAM_ID=$(solana deploy --keypair $KAMUI_LAYERZERO_KEYPAIR | grep "Program Id" | awk '{print $3}')
echo -e "${GREEN}Kamui LayerZero deployed with program ID: ${KAMUI_LAYERZERO_PROGRAM_ID}${NC}"

# Update Anchor.toml with the new program IDs
echo -e "${BLUE}Updating Anchor.toml with new program IDs...${NC}"

# Create a backup of the original file
cp Anchor.toml Anchor.toml.bak

# Update program IDs in Anchor.toml
sed -i '' "s/kamui_vrf = \"[^\"]*\"/kamui_vrf = \"$KAMUI_VRF_PROGRAM_ID\"/" Anchor.toml
sed -i '' "s/kamui_vrf_consumer = \"[^\"]*\"/kamui_vrf_consumer = \"$KAMUI_VRF_CONSUMER_PROGRAM_ID\"/" Anchor.toml
sed -i '' "s/kamui_layerzero = \"[^\"]*\"/kamui_layerzero = \"$KAMUI_LAYERZERO_PROGRAM_ID\"/" Anchor.toml

echo -e "${GREEN}Anchor.toml updated with new program IDs.${NC}"
echo -e "${BLUE}Original file backed up as Anchor.toml.bak${NC}"

# Update ID files in the target directory
echo -e "${BLUE}Updating program ID files...${NC}"
echo $KAMUI_VRF_PROGRAM_ID > target/idl/kamui_vrf.json
echo $KAMUI_VRF_CONSUMER_PROGRAM_ID > target/idl/kamui_vrf_consumer.json
echo $KAMUI_LAYERZERO_PROGRAM_ID > target/idl/kamui_layerzero.json

echo -e "${GREEN}Deployment complete! Program IDs updated in Anchor.toml.${NC}"
echo -e "${BLUE}You can now run the devnet tests with:${NC}"
echo -e "${YELLOW}npm run test:comprehensive-devnet${NC}" 