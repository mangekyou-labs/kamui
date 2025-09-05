#!/bin/bash

# Kamui VRF Standalone Server Runner
# This script sets up and runs the standalone VRF server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/mangekyou-cli"
SERVER_SCRIPT="$SCRIPT_DIR/standalone-vrf-server.js"
PACKAGE_JSON="$SCRIPT_DIR/standalone-vrf-package.json"

echo -e "${BLUE}🚀 Kamui VRF Standalone Server Setup${NC}"
echo "============================================"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js (>= 16.0.0) from https://nodejs.org/"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed${NC}"
    echo "Please install npm"
    exit 1
fi

if ! command_exists cargo; then
    echo -e "${RED}❌ Cargo is not installed${NC}"
    echo "Please install Rust and Cargo from https://rustup.rs/"
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
echo -e "${GREEN}✅ Node.js version: $NODE_VERSION${NC}"

# Setup Node.js dependencies
echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
cp "$PACKAGE_JSON" package.json
npm install
echo -e "${GREEN}✅ Node.js dependencies installed${NC}"

# Build Mangekyou CLI
echo -e "${YELLOW}🔧 Building Mangekyou CLI...${NC}"
if [ -d "$CLI_DIR" ]; then
    cd "$CLI_DIR"
    cargo build --bin ecvrf-cli
    echo -e "${GREEN}✅ Mangekyou CLI built successfully${NC}"
    cd "$SCRIPT_DIR"
else
    echo -e "${RED}❌ Mangekyou CLI directory not found at $CLI_DIR${NC}"
    echo "Please ensure the mangekyou-cli directory exists"
    exit 1
fi

# Test CLI integration
echo -e "${YELLOW}🧪 Testing CLI integration...${NC}"
if node "$SERVER_SCRIPT" --test-cli; then
    echo -e "${GREEN}✅ CLI integration test passed${NC}"
else
    echo -e "${RED}❌ CLI integration test failed${NC}"
    exit 1
fi

# Test Solana connection
echo -e "${YELLOW}🌐 Testing Solana connection...${NC}"
if node "$SERVER_SCRIPT" --test-connection; then
    echo -e "${GREEN}✅ Solana connection test passed${NC}"
else
    echo -e "${YELLOW}⚠️  Solana connection test failed (this might be okay)${NC}"
fi

# Check for oracle keypair
ORACLE_KEYPAIR="./oracle-keypair.json"
if [ ! -f "$ORACLE_KEYPAIR" ]; then
    echo -e "${YELLOW}⚠️  Oracle keypair not found at $ORACLE_KEYPAIR${NC}"
    echo "You'll need to provide an oracle keypair to run the server"
    echo ""
    echo "To generate one:"
    echo "  solana-keygen new --outfile oracle-keypair.json"
fi

echo ""
echo -e "${GREEN}🎉 Setup completed successfully!${NC}"
echo ""
echo -e "${BLUE}📚 Usage:${NC}"
echo "  Basic start:     node standalone-vrf-server.js"
echo "  Debug mode:      LOG_LEVEL=debug node standalone-vrf-server.js"  
echo "  Test CLI only:   node standalone-vrf-server.js --test-cli"
echo "  Help:            node standalone-vrf-server.js --help"
echo ""
echo -e "${BLUE}📁 Production deployment structure:${NC}"
echo "  ├── standalone-vrf-server.js     # Main server"
echo "  ├── mangekyou-cli/               # CLI directory (git submodule or download)"
echo "  │   └── target/debug/ecvrf-cli   # Built CLI binary"
echo "  ├── oracle-keypair.json          # Oracle keypair"
echo "  ├── vrf-keypair.json            # Auto-generated VRF keypair"
echo "  ├── package.json                # Node.js dependencies"
echo "  └── node_modules/               # Dependencies"
echo ""
echo -e "${GREEN}Ready to run! 🚀${NC}"
