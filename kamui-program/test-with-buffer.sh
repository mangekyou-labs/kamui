#!/bin/bash

# Set required environment variables
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=$(pwd)/keypair.json

echo "Building program with Anchor..."
anchor build

echo "Starting custom validator with bigger buffer..."
solana-test-validator --reset \
  --bpf-program 4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1 target/deploy/kamui_vrf.so \
  --bpf-program 4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y target/deploy/kamui_vrf_consumer.so \
  --bind-address 0.0.0.0 \
  --rpc-port 8899 \
  --ticks-per-slot 64 \
  --slots-per-epoch 32 &

# Give validator time to start
echo "Waiting for validator to start..."
sleep 10

# Ensure using local network
solana config set --url http://localhost:8899

echo "Running tests..."
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/simple-test.ts

# Cleanup
echo "Cleaning up..."
pkill -f solana-test-validator 