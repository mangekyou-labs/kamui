#!/bin/bash

# Set required environment variables for devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Run the tests directly with ts-mocha
echo "Running tests directly on devnet..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/simple-test.ts 