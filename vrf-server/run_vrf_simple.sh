#!/bin/bash
# Check if the VRF server binary exists, build if needed
if [ ! -f ./target/debug/vrf-server ]; then
  echo "Building VRF server..."
  cargo build
fi

# Run the VRF server with the oracle keypair
./target/debug/vrf-server --keypair ../oracle-keypair.json --program-id BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D --rpc-url "https://api.devnet.solana.com" --ws-url "wss://api.devnet.solana.com" --log-level info
