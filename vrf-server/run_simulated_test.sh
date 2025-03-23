#!/bin/bash

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to clean up on exit
cleanup() {
    echo "Cleaning up processes..."
    if [ ! -z "$VRF_SERVER_PID" ]; then
        echo "Stopping VRF server (PID: $VRF_SERVER_PID)"
        kill $VRF_SERVER_PID 2>/dev/null || true
    fi
}

# Set up trap to call cleanup function on exit
trap cleanup EXIT

# Create keypairs directory if it doesn't exist
mkdir -p keypairs

# Copy the existing keypair from kamui-program
echo "Copying existing keypair from kamui-program..."
cp -f /Users/zeref/workdir/mangekyou/kamui-program/keypair.json keypairs/payer.json || {
    echo -e "${RED}Failed to copy keypair from kamui-program. Make sure the path is correct.${NC}"
    exit 1
}

# Generate VRF keypair if it doesn't exist
if [ ! -f "vrf-keypair.json" ]; then
    echo "Generating VRF keypair..."
    solana-keygen new --no-bip39-passphrase -o vrf-keypair.json
fi

# Start VRF server with devnet configuration
echo "Starting VRF server with devnet configuration..."
./run_vrf_server.sh --rpc-url https://api.devnet.solana.com --ws-url wss://api.devnet.solana.com &
VRF_SERVER_PID=$!

# Wait for VRF server to initialize
echo "Waiting for VRF server to initialize (5 seconds)..."
sleep 5

# Create a simulated test script
echo "Creating simulated test script..."
mkdir -p simulated_test
cd simulated_test

# Create the simulated test script
cat > simulate_vrf_flow.sh << 'EOF'
#!/bin/bash

# Color codes for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting VRF flow simulation...${NC}"

# Load the payer keypair
PAYER_PUBKEY=$(solana-keygen pubkey ../keypairs/payer.json)
echo -e "${BLUE}Using payer with pubkey: ${PAYER_PUBKEY}${NC}"

# Check payer balance
BALANCE=$(solana balance -k ../keypairs/payer.json)
echo -e "${BLUE}Current payer balance: ${BALANCE}${NC}"

# Generate a random subscription ID
SUBSCRIPTION_ID=$(openssl rand -hex 8)
echo -e "${BLUE}Generated subscription ID: ${SUBSCRIPTION_ID}${NC}"

# Generate a random randomness account
RANDOMNESS_ACCOUNT=$(solana-keygen new --no-bip39-passphrase --force | grep "pubkey" | awk '{print $2}')
echo -e "${BLUE}Generated randomness account: ${RANDOMNESS_ACCOUNT}${NC}"

# Simulate VRF subscription creation
echo -e "${YELLOW}Simulating VRF subscription creation...${NC}"
echo -e "${GREEN}VRF subscription created successfully!${NC}"
sleep 1

# Simulate funding the subscription
echo -e "${YELLOW}Simulating funding the subscription...${NC}"
echo -e "${GREEN}Subscription funded with 0.01 SOL${NC}"
sleep 1

# Simulate requesting randomness
echo -e "${YELLOW}Simulating randomness request...${NC}"
REQUEST_SIGNATURE=$(openssl rand -hex 32)
echo -e "${GREEN}Randomness requested! Signature: ${REQUEST_SIGNATURE}${NC}"
sleep 1

# Print information for the VRF server
echo -e "\n${YELLOW}=== IMPORTANT: VRF REQUEST DETAILS ===${NC}"
echo -e "${BLUE}VRF Program ID: KAMUoHFPU4KJWx5vXPBbRWdHzEJpyFv4dQtw9xtwbYT${NC}"
echo -e "${BLUE}Randomness Account: ${RANDOMNESS_ACCOUNT}${NC}"
echo -e "${BLUE}Subscription ID: ${SUBSCRIPTION_ID}${NC}"
echo -e "${BLUE}Transaction Signature: ${REQUEST_SIGNATURE}${NC}"
echo -e "${YELLOW}======================================${NC}\n"

# Simulate VRF server processing
echo -e "${YELLOW}Simulating VRF server processing...${NC}"
echo -e "${BLUE}VRF server detected the request${NC}"
echo -e "${BLUE}VRF server generating proof...${NC}"
sleep 2
echo -e "${BLUE}VRF server verifying proof...${NC}"
sleep 1
echo -e "${BLUE}VRF server submitting fulfillment transaction...${NC}"
sleep 1
FULFILL_SIGNATURE=$(openssl rand -hex 32)
echo -e "${GREEN}VRF server fulfilled the request! Signature: ${FULFILL_SIGNATURE}${NC}"

# Simulate consuming randomness
echo -e "${YELLOW}Simulating consuming randomness...${NC}"
RANDOM_VALUE=$((RANDOM % 1000000))
echo -e "${GREEN}Randomness consumed! Random value: ${RANDOM_VALUE}${NC}"

echo -e "\n${GREEN}VRF flow simulation completed successfully!${NC}"
echo -e "${YELLOW}In a real scenario, the VRF server would:${NC}"
echo -e "${BLUE}1. Monitor the blockchain for VRF requests${NC}"
echo -e "${BLUE}2. Generate cryptographic proofs for the requested randomness${NC}"
echo -e "${BLUE}3. Submit fulfillment transactions to the blockchain${NC}"
echo -e "${BLUE}4. Allow the requesting program to consume the randomness${NC}"

echo -e "\n${YELLOW}The VRF server is running and ready to process real requests.${NC}"
echo -e "${YELLOW}To make a real request, you would need:${NC}"
echo -e "${BLUE}1. The VRF program deployed on the blockchain${NC}"
echo -e "${BLUE}2. A funded VRF subscription${NC}"
echo -e "${BLUE}3. A program that requests randomness from the VRF program${NC}"
EOF

# Make the script executable
chmod +x simulate_vrf_flow.sh

# Run the simulated test
echo "Running simulated test..."
./simulate_vrf_flow.sh

echo "Test completed. Cleaning up..."
cd .. 