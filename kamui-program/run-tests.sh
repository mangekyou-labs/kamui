#!/bin/bash

# Set required environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Default test file
TEST_FILE="tests/simple-test.ts"

# Check if a test file was specified
if [ $# -gt 0 ]; then
  TEST_FILE=$1
fi

echo "Running test file: $TEST_FILE"

echo "Building program with Anchor..."
anchor build

echo "Setting up test validator with custom buffer size..."
solana-test-validator --reset \
  --bpf-program 4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1 target/deploy/kamui_vrf.so \
  --bpf-program 4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y target/deploy/kamui_vrf_consumer.so &

sleep 5
echo "Test validator started"

echo "Running test with larger buffer size..."
solana config set --url localhost
yarn run ts-mocha -p ./tsconfig.json -t 1000000 $TEST_FILE

# Kill the test validator
pkill -f solana-test-validator 