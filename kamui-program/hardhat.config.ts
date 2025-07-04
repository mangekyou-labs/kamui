// Get the environment configuration from .env file
import 'dotenv/config'

import 'hardhat-deploy'
import '@nomicfoundation/hardhat-ethers'
import 'hardhat-contract-sizer'
import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy-ethers'
import '@layerzerolabs/toolbox-hardhat'
import { HardhatUserConfig, HttpNetworkAccountsUserConfig } from 'hardhat/types'

import { EndpointId } from '@layerzerolabs/lz-definitions'

// Set your preferred authentication method
const MNEMONIC = process.env.MNEMONIC
const PRIVATE_KEY = process.env.PRIVATE_KEY

const accounts: HttpNetworkAccountsUserConfig | undefined = MNEMONIC
    ? { mnemonic: MNEMONIC }
    : PRIVATE_KEY
      ? [PRIVATE_KEY]
      : undefined

if (accounts == null) {
    console.warn(
        'Could not find MNEMONIC or PRIVATE_KEY environment variables. It will not be possible to execute transactions.'
    )
}

const config: HardhatUserConfig = {
    paths: {
        cache: 'cache/hardhat',
    },
    solidity: {
        compilers: [
            {
                version: '0.8.22',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    networks: {
        'ethereum-testnet': {
            eid: EndpointId.ETHEREUM_V2_TESTNET,
            url: process.env.RPC_URL_ETHEREUM_TESTNET || 'https://rpc.sepolia.org',
            accounts,
        },
        'optimism-testnet': {
            eid: EndpointId.OPTSEP_V2_TESTNET,
            url: process.env.RPC_URL_OPTIMISM_TESTNET || 'https://sepolia.optimism.io',
            accounts,
        },
        'arbitrum-testnet': {
            eid: EndpointId.ARBSEP_V2_TESTNET,
            url: process.env.RPC_URL_ARBITRUM_TESTNET || 'https://sepolia-rollup.arbitrum.io/rpc',
            accounts,
        },
        'base-testnet': {
            eid: EndpointId.BASESEP_V2_TESTNET,
            url: process.env.RPC_URL_BASE_TESTNET || 'https://sepolia.base.org',
            accounts,
        },
        'polygon-testnet': {
            eid: EndpointId.AMOY_V2_TESTNET,
            url: process.env.RPC_URL_POLYGON_TESTNET || 'https://rpc-amoy.polygon.technology',
            accounts,
        },
        'avalanche-testnet': {
            eid: EndpointId.AVALANCHE_V2_TESTNET,
            url: process.env.RPC_URL_AVALANCHE_TESTNET || 'https://api.avax-test.network/ext/bc/C/rpc',
            accounts,
        },
        'solana-testnet': {
            eid: EndpointId.SOLANA_V2_TESTNET,
            url: process.env.RPC_URL_SOLANA_TESTNET || 'https://api.devnet.solana.com',
            accounts,
        },
    },
    namedAccounts: {
        deployer: {
            default: 0, // wallet address of index[0], of the mnemonic in .env
        },
    },
}

export default config 