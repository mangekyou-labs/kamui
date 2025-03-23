#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting VRF server with mock feature...${NC}"

# Run the VRF server directly from the kamui-program directory
# This bypasses the workspace issue by using cargo directly in this directory
echo -e "${YELLOW}Running VRF server from kamui-program directory${NC}"
cargo run --bin vrf_server --features mock 