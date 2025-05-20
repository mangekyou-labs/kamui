#!/bin/bash

# This script runs tests on the Solana devnet using the project's keypair.json for funding

# Set required environment variables for devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Define program IDs - match these with Anchor.toml
VRF_PROGRAM_ID="4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y"
CONSUMER_PROGRAM_ID="5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6"

# Get wallet public key
WALLET_PUBKEY=$(solana address -k $ANCHOR_WALLET)

# Check wallet balance
echo "Checking wallet balance..."
BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
echo "Current balance: $BALANCE SOL"

# Verify programs exist
echo "Verifying that programs exist on devnet..."
if ! solana program show $VRF_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
    echo "Error: VRF program ID $VRF_PROGRAM_ID doesn't exist on devnet"
    echo "Please run deploy-to-devnet.sh first or update the program ID"
    exit 1
fi

# Only check consumer program if we have one specified
if [ -n "$CONSUMER_PROGRAM_ID" ]; then
    if ! solana program show $CONSUMER_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
        echo "Warning: Consumer program ID $CONSUMER_PROGRAM_ID doesn't exist on devnet"
        echo "Some tests may fail, but we'll continue anyway"
    fi
fi

echo "Running tests on devnet..."
echo "This will use real devnet SOL for transactions!"
echo "Press Ctrl+C now to abort if you don't want to proceed."
sleep 3

# Run the tests with devnet configuration
echo "Starting tests..."
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/simple-test.ts

# Display any transaction logs from devnet
echo "Recent transactions from this wallet:"
solana transaction-history --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET $WALLET_PUBKEY | head -n 10 