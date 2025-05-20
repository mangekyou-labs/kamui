#!/bin/bash

# This script deploys the Kamui VRF programs to Solana devnet

# Set required environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$(pwd)/keypair.json

# Default program IDs (can be overridden)
KAMUI_VRF_PROGRAM_ID="BfwfooykCSdb1vgu6FcP75ncUgdcdt4ciUaeaSLzxM4D"
KAMUI_VRF_CONSUMER_PROGRAM_ID="5gSZAw9aDQYGJABr6guQqPRFzyX656BSoiEdhHaUzyh6"

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --vrf-id) KAMUI_VRF_PROGRAM_ID="$2"; shift ;;
        --consumer-id) KAMUI_VRF_CONSUMER_PROGRAM_ID="$2"; shift ;;
        --skip-vrf) SKIP_VRF=true ;;
        --skip-consumer) SKIP_CONSUMER=true ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Get wallet public key
WALLET_PUBKEY=$(solana address -k $ANCHOR_WALLET)

# Check wallet balance
echo "Checking wallet balance..."
BALANCE=$(solana balance --url $ANCHOR_PROVIDER_URL -k $ANCHOR_WALLET | awk '{print $1}')
echo "Current balance: $BALANCE SOL"

REQUIRED_SOL=5.0
if (( $(echo "$BALANCE < $REQUIRED_SOL" | bc -l) )); then
    echo "Warning: Balance is less than $REQUIRED_SOL SOL, which may not be enough for deployment"
    echo "Do you want to continue anyway? (y/n)"
    read -r response
    if [[ "$response" != "y" ]]; then
        echo "Exiting. Please fund your account and try again."
        exit 1
    fi
fi

echo "Building programs..."
anchor build

# Deploy kamui_vrf program if not skipped
if [ "$SKIP_VRF" != "true" ]; then
    echo "Deploying kamui_vrf program..."
    
    if [ -n "$KAMUI_VRF_PROGRAM_ID" ]; then
        echo "Using existing VRF program ID: $KAMUI_VRF_PROGRAM_ID"
        
        # Verify the program exists
        if ! solana program show $KAMUI_VRF_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
            echo "Error: Program ID $KAMUI_VRF_PROGRAM_ID doesn't exist on devnet"
            exit 1
        fi
    else
        # Deploy new VRF program
        KAMUI_VRF_KEYPAIR="target/deploy/kamui_vrf-keypair.json"
        if [ ! -f "$KAMUI_VRF_KEYPAIR" ]; then
            echo "Error: $KAMUI_VRF_KEYPAIR not found. Build failed or file is missing."
            exit 1
        fi

        solana program deploy \
            --keypair $ANCHOR_WALLET \
            --program-id $KAMUI_VRF_KEYPAIR \
            --url $ANCHOR_PROVIDER_URL \
            target/deploy/kamui_vrf.so

        KAMUI_VRF_PROGRAM_ID=$(solana-keygen pubkey $KAMUI_VRF_KEYPAIR)
        echo "kamui_vrf program deployed with ID: $KAMUI_VRF_PROGRAM_ID"
    fi
else
    echo "Skipping kamui_vrf program deployment, using ID: $KAMUI_VRF_PROGRAM_ID"
fi

# Deploy kamui_vrf_consumer program if not skipped
if [ "$SKIP_CONSUMER" != "true" ]; then
    echo "Deploying kamui_vrf_consumer program..."
    
    if [ -n "$KAMUI_VRF_CONSUMER_PROGRAM_ID" ]; then
        echo "Using existing consumer program ID: $KAMUI_VRF_CONSUMER_PROGRAM_ID"
        
        # Verify the program exists
        if ! solana program show $KAMUI_VRF_CONSUMER_PROGRAM_ID --url $ANCHOR_PROVIDER_URL &>/dev/null; then
            echo "Error: Program ID $KAMUI_VRF_CONSUMER_PROGRAM_ID doesn't exist on devnet"
            exit 1
        fi
    else
        # Deploy new consumer program
        KAMUI_VRF_CONSUMER_KEYPAIR="target/deploy/kamui_vrf_consumer-keypair.json"
        if [ ! -f "$KAMUI_VRF_CONSUMER_KEYPAIR" ]; then
            echo "Error: $KAMUI_VRF_CONSUMER_KEYPAIR not found. Build failed or file is missing."
            exit 1
        fi

        solana program deploy \
            --keypair $ANCHOR_WALLET \
            --program-id $KAMUI_VRF_CONSUMER_KEYPAIR \
            --url $ANCHOR_PROVIDER_URL \
            target/deploy/kamui_vrf_consumer.so

        KAMUI_VRF_CONSUMER_PROGRAM_ID=$(solana-keygen pubkey $KAMUI_VRF_CONSUMER_KEYPAIR)
        echo "kamui_vrf_consumer program deployed with ID: $KAMUI_VRF_CONSUMER_PROGRAM_ID"
    fi
else
    echo "Skipping kamui_vrf_consumer program deployment"
fi

echo "Deployment complete!"
echo "kamui_vrf program ID: $KAMUI_VRF_PROGRAM_ID"
echo "kamui_vrf_consumer program ID: $KAMUI_VRF_CONSUMER_PROGRAM_ID"
echo ""
echo "Now update your Anchor.toml file with these program IDs under [programs.devnet]" 