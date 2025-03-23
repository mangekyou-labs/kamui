#!/bin/bash
cargo build && ./target/debug/vrf-server --keypair $1 --vrf-keypair $2 --program-id $3 --rpc-url "https://api.devnet.solana.com" --ws-url "wss://api.devnet.solana.com" --log-level "info" > vrf-server.log 2>&1
