#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting VRF server with mock feature...${NC}"

# Go to the standalone VRF server directory
echo -e "${YELLOW}Going to standalone VRF server directory...${NC}"
cd /tmp/vrf_server

# Run the VRF server
echo -e "${YELLOW}Running VRF server from standalone directory${NC}"
cargo run --bin vrf_server 