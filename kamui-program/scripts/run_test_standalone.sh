#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Running VRF devnet flow test...${NC}"

# Create a temporary Cargo.toml without workspace section
echo -e "${YELLOW}Creating temporary Cargo.toml without workspace section...${NC}"
cp Cargo.toml Cargo.toml.bak
sed -i '' '/\[workspace\]/d' Cargo.toml

# Run the test
echo -e "${YELLOW}Running test from kamui-program directory${NC}"
RUST_LOG=solana_runtime::system_instruction_processor=trace,solana_runtime::message_processor=debug,solana_bpf_loader=debug,solana_rbpf=debug \
cargo test test_vrf_flow_devnet -- --exact --nocapture

# Check test results
TEST_RESULT=$?

# Restore original Cargo.toml
echo -e "${YELLOW}Restoring original Cargo.toml...${NC}"
mv Cargo.toml.bak Cargo.toml

# Check test results
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
else
    echo -e "${RED}Tests failed!${NC}"
    exit 1
fi 