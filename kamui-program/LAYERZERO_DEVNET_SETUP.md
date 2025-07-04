# LayerZero Devnet Setup Guide

This guide walks you through setting up and testing the Kamui VRF LayerZero integration on Solana devnet and EVM testnets.

## 🎯 Overview

The Kamui LayerZero implementation enables cross-chain VRF (Verifiable Random Function) requests and fulfillment between Solana and EVM chains using LayerZero's omnichain protocol.

### Key Features
- ✅ Cross-chain VRF requests from EVM to Solana
- ✅ VRF fulfillment delivery from Solana to EVM
- ✅ LayerZero OApp standard compliance
- ✅ Devnet/Testnet ready configuration
- ✅ Multi-chain support (Ethereum, Optimism, Arbitrum, etc.)

## 📋 Prerequisites

### Required Software
- Rust 1.75.0+
- Solana CLI 1.17.31+
- Anchor 0.31.1+
- Node.js 18.0.0+
- Docker (for Anchor builds)

### Required Accounts
- Solana wallet with devnet SOL
- EVM wallets with testnet ETH on supported chains

## 🔧 Setup Instructions

### 1. Environment Configuration

Copy the environment configuration:
```bash
cp .env.example .env
```

Configure your environment variables:
- `SOLANA_PRIVATE_KEY`: Your Solana private key (base58)
- `MNEMONIC` or `PRIVATE_KEY`: Your EVM wallet credentials
- Testnet RPC URLs (or use the provided defaults)

### 2. Install Dependencies

Install both Rust and Node.js dependencies:
```bash
# Install Node.js dependencies
npm install

# Build Rust programs
anchor build
```

### 3. Fund Wallets

#### Solana Devnet
```bash
# Check your Solana address
solana address

# Request devnet SOL
solana airdrop 2 --url devnet

# Or use the faucet: https://faucet.solana.com/
```

#### EVM Testnets
Get testnet tokens from:
- Ethereum Sepolia: https://faucet.sepolia.dev/
- Optimism Sepolia: https://app.optimism.io/faucet
- Arbitrum Sepolia: https://faucet.arbitrum.io/
- Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

### 4. Deploy Programs

Deploy the Kamui LayerZero program to devnet:
```bash
# Set Solana to devnet
solana config set --url devnet

# Deploy the program
anchor deploy --program-name kamui-layerzero

# Note the deployed program ID for configuration
```

## 🧪 Testing

### Running Tests

#### Basic Functionality Test
```bash
npm run test-layerzero
```

#### Simple Devnet Test
```bash
npx ts-node lz-devnet-test-simple.ts
```

#### Comprehensive Devnet Test
```bash
npm run test-layerzero-devnet
```

### Test Scenarios

The test suite covers:

1. **Program Verification**: Ensures the LayerZero program is deployed
2. **OApp Store Initialization**: Sets up the LayerZero OApp store
3. **Cross-chain Peer Configuration**: Configures EVM testnet peers
4. **Message Type Handling**: Tests `lz_receive_types` functionality
5. **VRF Request Flow**: Tests cross-chain VRF requests
6. **Message Sending**: Tests LayerZero message transmission
7. **Delegate Management**: Tests admin/delegate functionality

## 🔗 LayerZero Configuration

### Supported Chains

| Chain | Network | Endpoint ID | Status |
|-------|---------|-------------|---------|
| Solana | Devnet | 40168 | ✅ Ready |
| Ethereum | Sepolia | 40161 | ✅ Ready |
| Optimism | Sepolia | 40232 | ✅ Ready |
| Arbitrum | Sepolia | 40231 | ✅ Ready |
| Base | Sepolia | 40245 | ✅ Ready |
| Polygon | Amoy | 40267 | ✅ Ready |

### Message Types

| Type | Description | Gas Limit |
|------|-------------|-----------|
| 1 | VRF Request | 200,000 |
| 2 | VRF Fulfillment | 150,000 |

## 🔄 Cross-chain Workflow

### VRF Request Flow
1. **EVM Chain**: User calls `requestVRF()` on EVM contract
2. **LayerZero**: Message routed through LayerZero protocol
3. **Solana**: Kamui program receives request via `lz_receive`
4. **VRF Generation**: Oracle generates VRF proof on Solana
5. **Fulfillment**: VRF result sent back to EVM via LayerZero

### Key Components

#### Solana Side
- **Store PDA**: Main OApp address and state
- **Peer PDAs**: Cross-chain peer configurations
- **VRF Integration**: Kamui VRF program integration

#### EVM Side
- **OApp Contract**: LayerZero OApp implementation
- **VRF Consumer**: Application-specific VRF handling
- **Message Codec**: Cross-chain message encoding/decoding

## 🚀 Deployment Process

### 1. Solana Program Deployment
```bash
# Build and deploy
anchor build
anchor deploy

# Initialize OApp Store
npx hardhat lz:oapp:solana:create --eid 40168 --program-id <PROGRAM_ID>
```

### 2. EVM Contract Deployment
```bash
# Deploy to testnets
npx hardhat lz:deploy

# Configure cross-chain settings
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts
```

### 3. Cross-chain Configuration
```bash
# Initialize Solana configurations
npx hardhat lz:oapp:solana:init-config --oapp-config layerzero.config.ts

# Wire cross-chain pathways
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts
```

## 🐛 Troubleshooting

### Common Issues

#### Program Not Found
```
Error: Program not found on devnet
```
**Solution**: Deploy the program first using `anchor deploy`

#### Insufficient Balance
```
Error: Insufficient balance for testing
```
**Solution**: Fund your wallet with devnet SOL using `solana airdrop`

#### LayerZero Endpoint Errors
```
Error: LayerZero endpoint error
```
**Solution**: These are expected without full LayerZero infrastructure setup

#### Dependency Conflicts
```
Error: Cannot resolve LayerZero dependencies
```
**Solution**: Ensure all LayerZero packages are properly installed

### Expected Test Behaviors

- ✅ Program verification should always pass
- ⚠️ Store initialization may fail without LayerZero endpoint
- ⚠️ Peer configuration may fail without full setup
- ⚠️ Message sending expected to fail in test environment
- ✅ Type validation and interface testing should pass

## 📚 Resources

### Documentation
- [LayerZero Docs](https://docs.layerzero.network/)
- [Solana OApp Reference](https://docs.layerzero.network/v2/developers/solana/oapp/overview)
- [Kamui VRF Documentation](../README.md)

### Explorers
- [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet)
- [LayerZero Scan](https://layerzeroscan.com/)

### Faucets
- [Solana Devnet Faucet](https://faucet.solana.com/)
- [Ethereum Sepolia Faucet](https://faucet.sepolia.dev/)
- [Multi-chain Faucet List](https://faucetlink.to/)

## 🎯 Next Steps

1. **Full Deployment**: Deploy to mainnet after thorough testing
2. **EVM Integration**: Deploy companion EVM contracts
3. **Oracle Network**: Set up decentralized oracle infrastructure
4. **Production Testing**: Comprehensive end-to-end testing
5. **Monitoring**: Set up cross-chain monitoring and alerting

## 📞 Support

For issues and questions:
- Create an issue in the repository
- Check the LayerZero Discord for protocol-specific questions
- Review the test output for detailed error information 