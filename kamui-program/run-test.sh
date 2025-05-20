#!/bin/bash

set -e

echo "Building programs..."
anchor build

echo "Starting local validator..."
# Start a local validator with increased buffer size
solana-test-validator \
  --reset \
  --bpf-program 4zxDQnSVK6XPTERb8kY8b7EQsHWbwrRFfaDunF9Ryjg1 target/deploy/kamui_vrf.so \
  --bpf-program 4qqRVYJAeBynm2yTydBkTJ9wVay3CrUfZ7gf9chtWS5Y target/deploy/kamui_vrf_consumer.so \
  --bind-address 0.0.0.0 \
  --rpc-port 8899 &

# Allow time for the validator to start
sleep 5

echo "Setting environment variables..."
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=./keypair.json

echo "Running compressed account tests..."
# Run anchor test which will use the script in Anchor.toml
anchor test --skip-local-validator --skip-deploy

echo "Shutting down validator..."
# Clean up the validator process
pkill -f solana-test-validator || true 