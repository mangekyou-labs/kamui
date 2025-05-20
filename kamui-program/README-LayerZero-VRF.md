# Cross-Chain VRF Integration with LayerZero

This project demonstrates how to use LayerZero messaging protocol to integrate Solana VRF (Verifiable Random Function) with EVM chains. The integration enables EVM chains to request randomness from Solana's high-quality VRF service and receive the results in a verifiable manner.

## Overview

The project consists of:

1. **Solana Programs**:
   - `kamui-vrf`: Verifiable Random Function program for generating provable randomness
   - `kamui-layerzero`: LayerZero endpoint integration for Solana
   
2. **EVM Contracts**:
   - `VRFConsumerLZ.sol`: Contract for requesting and receiving randomness via LayerZero
   - `GameWithVRF.sol`: Example game contract that uses the VRF service

## Architecture

![Architecture Diagram](./docs/architecture.png)

### Flow of Operations

1. An EVM contract calls `requestRandomness()` on `VRFConsumerLZ` contract
2. `VRFConsumerLZ` sends a message to Solana via LayerZero
3. The `kamui-layerzero` program on Solana receives the message
4. `kamui-layerzero` calls the `kamui-vrf` program to generate randomness
5. Once randomness is generated, `kamui-vrf` returns the result to `kamui-layerzero`
6. `kamui-layerzero` sends the randomness back to the EVM chain via LayerZero
7. `VRFConsumerLZ` receives the randomness and notifies the requesting contract

## Solana Programs

### kamui-layerzero

This program handles LayerZero integration on the Solana side. It:
- Implements the LayerZero messaging protocol for Solana
- Handles cross-chain message verification
- Processes VRF requests from EVM chains
- Sends VRF fulfillments back to EVM chains

Key components:
- `Endpoint`: Manages the LayerZero endpoint on Solana
- `OApp`: Application-specific messaging account
- `TrustedRemote`: Configuration for trusted remote chains
- Instructions for message sending and receiving

### kamui-vrf

This is the core VRF service on Solana that:
- Generates cryptographically secure random numbers
- Provides on-chain verification of randomness
- Supports multiple VRF requests simultaneously

## EVM Contracts

### VRFConsumerLZ

This contract allows EVM contracts to request randomness from Solana:
- Inherits from `NonblockingLzApp` from LayerZero
- Encodes VRF requests as LayerZero messages
- Processes VRF fulfillment messages from Solana
- Handles callback to requesting contracts

### GameWithVRF

An example game contract that:
- Requests randomness for dice rolls
- Processes the randomness when it's received
- Updates player scores based on the random rolls

## Setup and Deployment

### Prerequisites

- Solana CLI (version 1.14.0 or later)
- Anchor Framework (version 0.29.0 or later)
- Node.js (version 14 or later)
- Hardhat (for EVM deployment)

### Solana Deployment

1. Build and deploy the Solana programs:

```bash
anchor build
solana-keygen pubkey target/deploy/kamui_vrf-keypair.json
solana-keygen pubkey target/deploy/kamui_layerzero-keypair.json

# Update declare_id! in programs/kamui-vrf/src/lib.rs and programs/kamui-layerzero/src/lib.rs
anchor deploy
```

2. Initialize the LayerZero endpoint:

```bash
ts-node scripts/init-layerzero.ts
```

### EVM Deployment

1. Deploy the EVM contracts:

```bash
npx hardhat run scripts/deploy-lz-vrf.js --network <your-network>
```

## Usage

### Requesting Randomness from EVM

```solidity
// Initialize game contract
GameWithVRF game = new GameWithVRF(vrfConsumerAddress);

// Request a roll using Solana VRF (chainId 0 is Solana in LayerZero)
game.requestRoll{value: messageFee}(0);
```

### Handling Randomness in EVM

The randomness is received through the callback function:

```solidity
function rawFulfillRandomness(bytes32 requestId, uint256[] memory randomWords) external override {
    // Use randomness here
    uint256 roll = (randomWords[0] % 100) + 1;
    // Update game state
}
```

## Testing

1. Run Solana tests:

```bash
anchor test tests/layerzero-vrf-integration.ts
```

2. Run EVM tests:

```bash
npx hardhat test test/vrf-lz-test.js
```

## Security Considerations

- Both chains must properly validate messages from trusted sources only
- LayerZero trusted remotes must be correctly configured
- VRF randomness should be properly verified
- Appropriate fees must be provided for cross-chain messages

## License

MIT 