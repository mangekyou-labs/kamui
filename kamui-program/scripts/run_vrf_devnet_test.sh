#!/bin/bash

# Run VRF Devnet Test
# This script runs the VRF devnet test with the VRF server

# Set up error handling
set -e

echo "Running VRF Devnet Test"

# Check if VRF server is running
VRF_SERVER_PID=$(pgrep -f "vrf-server")
if [ -z "$VRF_SERVER_PID" ]; then
    echo "VRF server is not running. Starting it now..."
    
    # Start VRF server with the correct program ID
    cd ../vrf-server
    ./run_vrf_server.sh --program-id "BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D" &
    VRF_SERVER_PID=$!
    cd ../kamui-program
    
    # Wait for VRF server to initialize
    echo "Waiting for VRF server to initialize (5 seconds)..."
    sleep 5
fi

# Run the VRF devnet test
echo "Running VRF devnet test..."
cargo test --test vrf_devnet_test test_vrf_flow_devnet -- --nocapture

# Check if test was successful
if [ $? -ne 0 ]; then
    echo "VRF devnet test failed"
    exit 1
fi

echo "VRF devnet test completed successfully"

# If we started the VRF server, stop it
if [ ! -z "$VRF_SERVER_PID" ]; then
    echo "Stopping VRF server (PID: ${VRF_SERVER_PID})..."
    kill $VRF_SERVER_PID
    echo "VRF server stopped"
fi 