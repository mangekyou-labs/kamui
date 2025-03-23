#!/bin/bash

# Script to regenerate valid keypairs for the VRF server
# This helps ensure that keypairs are in the correct format and will work with the server

set -e

echo "Building VRF server and tools..."
cargo build --release -q

echo "Generating Oracle keypair..."
solana-keygen new --no-bip39-passphrase -o oracle-keypair.json -f

echo "Generating VRF keypair..."

MAX_ATTEMPTS=5
ATTEMPT=1
SUCCESS=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ] && [ "$SUCCESS" = false ]; do
    echo "Attempt $ATTEMPT to generate valid VRF keypair..."
    
    # Generate a new VRF keypair
    cargo run --release --bin vrf-server -- generate-keypair --output vrf-keypair.json
    
    # Test the keypair with our new test binary
    if cargo run --release --bin vrf_test -- vrf-keypair.json "test_message" &> /dev/null; then
        echo "VRF keypair test passed!"
        SUCCESS=true
    else
        echo "VRF keypair test failed, regenerating..."
        ATTEMPT=$((ATTEMPT+1))
    fi
done

if [ "$SUCCESS" = false ]; then
    echo "Failed to generate valid VRF keypair after $MAX_ATTEMPTS attempts."
    echo "Please check the VRF implementation and try again."
    exit 1
fi

echo "Setup complete!"
echo "You can now run the VRF server with:"
echo "  ./run_vrf_server.sh --program-id 'BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D' --keypair oracle-keypair.json --vrf-keypair vrf-keypair.json" 