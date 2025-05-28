#!/bin/bash

# Optimized Devnet Tests Runner for Kamui
# This script runs the optimized tests for devnet with proper error handling

# Set colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Set required environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Function to run a test and report its status
run_test() {
    local test_file=$1
    local test_name=$(basename $test_file .ts)
    
    echo -e "\n${BLUE}=== Running Test: ${test_name} ===${NC}"
    echo "Test file: $test_file"
    
    # Run the test directly without timeout
    npx ts-mocha -p ./tsconfig.json -t 120000 $test_file
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✅ Test completed successfully: $test_name${NC}"
        return 0
    else
        echo -e "${RED}❌ Test failed with exit code $exit_code: $test_name${NC}"
        return 1
    fi
}

# Check wallet existence and balance
check_wallet() {
    if [ ! -f "$ANCHOR_WALLET" ]; then
        echo -e "${YELLOW}Wallet file not found, creating new keypair${NC}"
        solana-keygen new --no-bip39-passphrase -o "$ANCHOR_WALLET"
    fi
    
    # Get wallet public key
    WALLET_PUBKEY=$(solana address -k $ANCHOR_WALLET)
    echo -e "${BLUE}Using wallet: $WALLET_PUBKEY${NC}"
    
    # Check balance
    BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
    echo "Current balance: $BALANCE SOL"
    
    # Warn if balance is low
    MIN_SOL=0.2
    if (( $(echo "$BALANCE < $MIN_SOL" | bc -l) )); then
        echo -e "${YELLOW}Warning: Balance is low. Some tests may fail.${NC}"
        echo -e "${YELLOW}Do you want to try to get an airdrop? (y/n)${NC}"
        read -r response
        if [[ "$response" == "y" ]]; then
            echo "Requesting airdrop..."
            solana airdrop 1 -k $ANCHOR_WALLET --url $ANCHOR_PROVIDER_URL
            BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
            echo "New balance: $BALANCE SOL"
        fi
    fi
}

# Main script execution
echo -e "${BLUE}=== Kamui VRF Optimized Devnet Tests ===${NC}"

# Check wallet and balance
check_wallet

# List of test files to run
TEST_FILES=(
    "tests/honest-devnet-test.ts"
    "tests/devnet-working-test.ts"
    "tests/optimized-vrf-test.ts"
    "tests/lz-devnet-test.ts"
)

# Summary variables
TOTAL_TESTS=${#TEST_FILES[@]}
PASSED_TESTS=0
FAILED_TESTS=0

echo -e "\n${BLUE}=== Starting Tests (Total: $TOTAL_TESTS) ===${NC}"
echo "These tests use real devnet SOL. Press Ctrl+C now to abort."
echo -e "${YELLOW}Note: Some tests are expected to fail - this is the correct behavior!${NC}"
echo -e "${YELLOW}The honest-devnet-test.ts demonstrates proper error handling.${NC}"
sleep 5

# Run each test file
for test_file in "${TEST_FILES[@]}"; do
    if [ -f "$test_file" ]; then
        run_test "$test_file"
        if [ $? -eq 0 ]; then
            PASSED_TESTS=$((PASSED_TESTS+1))
        else
            FAILED_TESTS=$((FAILED_TESTS+1))
        fi
    else
        echo -e "${YELLOW}⚠️ Test file not found: $test_file${NC}"
        FAILED_TESTS=$((FAILED_TESTS+1))
    fi
done

# Display summary
echo -e "\n${BLUE}=== Test Summary ===${NC}"
echo -e "Total tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

# Display transaction history
echo -e "\n${BLUE}=== Recent Transactions ===${NC}"
echo "Recent transactions from wallet $WALLET_PUBKEY"
echo "Check them on Solana Explorer: https://explorer.solana.com/address/$WALLET_PUBKEY?cluster=devnet"

echo -e "\n${BLUE}=== Testing Complete! ===${NC}"

# Exit with appropriate code
if [ $FAILED_TESTS -eq 0 ]; then
    exit 0
else
    exit 1
fi 