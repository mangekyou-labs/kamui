#!/bin/bash
KEYPAIR_PATH="../oracle-keypair.json"
PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
RPC_URL="https://api.devnet.solana.com"
WS_URL="wss://api.devnet.solana.com"
LOG_LEVEL="info"
cargo build
./target/debug/vrf-server --keypair "$KEYPAIR_PATH" --program-id "$PROGRAM_ID" --rpc-url "$RPC_URL" --ws-url "$WS_URL" --log-level "$LOG_LEVEL"
