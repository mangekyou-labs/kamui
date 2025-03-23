#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Change to the kamui-program directory
cd "$(dirname "$0")/.."

# Step 1: Create test keypair
echo -e "${YELLOW}Step 1: Creating test keypair...${NC}"
./scripts/create_test_keypair.sh

# Check if keypair creation was successful
if [ ! -f "keypair.json" ]; then
    echo -e "${RED}Error: Failed to create keypair.json${NC}"
    exit 1
fi

# Generate VRF keypair if it doesn't exist
if [ ! -f "vrf-keypair.json" ]; then
    echo -e "${YELLOW}Generating VRF keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o vrf-keypair.json
fi

# Step 2: Run the integration test with the actual VRF server
echo -e "\n${YELLOW}Step 2: Running integration test with actual VRF server...${NC}"
./scripts/run_devnet_integration_test.sh

# Check the test result
TEST_RESULT=$?
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "\n${GREEN}Integration test completed successfully!${NC}"
else
    echo -e "\n${RED}Integration test failed!${NC}"
    exit 1
fi

echo -e "\n${GREEN}All tests completed successfully!${NC}" 