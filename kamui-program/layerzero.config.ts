import { EndpointId } from '@layerzerolabs/lz-definitions'
import { ExecutorOptionType } from '@layerzerolabs/lz-v2-utilities'
import { TwoWayConfig, generateConnectionsConfig } from '@layerzerolabs/metadata-tools'
import { OAppEnforcedOption, OmniPointHardhat } from '@layerzerolabs/toolbox-hardhat'

// Solana devnet configuration
const solanaContract: OmniPointHardhat = {
    eid: EndpointId.SOLANA_V2_TESTNET, // 40168
    // This address will be set after deploying the OApp Store
    address: "E8ka62cKB63dqbC3CLNReWXRVF4rHJy3qvaXcBimJQSU", // Kamui LayerZero program ID
}

// Ethereum Sepolia testnet configuration
const ethereumContract: OmniPointHardhat = {
    eid: EndpointId.ETHEREUM_V2_TESTNET, // 40161
    contractName: 'KamuiVRFEthereumOApp', // Contract name for EVM deployment
}

// Optimism Sepolia testnet configuration
const optimismContract: OmniPointHardhat = {
    eid: EndpointId.OPTSEP_V2_TESTNET, // 40232
    contractName: 'KamuiVRFOptimismOApp', // Contract name for EVM deployment
}

// Enforced options for Solana
const SOLANA_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1, // VRF request message type
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 200_000, // Gas for lz_receive execution
    },
    {
        msgType: 2, // VRF fulfillment message type
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 150_000, // Gas for VRF fulfillment
    },
]

// Enforced options for EVM chains
const EVM_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1, // VRF request message type
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 200_000, // Gas for lz_receive execution
    },
    {
        msgType: 2, // VRF fulfillment message type
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 150_000, // Gas for VRF fulfillment
    },
]

// Define cross-chain pathways for VRF
const pathways: TwoWayConfig[] = [
    // Solana <-> Ethereum Sepolia
    [
        solanaContract,
        ethereumContract,
        [['LayerZero Labs'], []], // [requiredDVN[], [optionalDVN[], threshold]]
        [1, 12], // [Solana confirmations, Ethereum confirmations]
        [EVM_ENFORCED_OPTIONS, SOLANA_ENFORCED_OPTIONS], // [To EVM, To Solana]
    ],
    // Solana <-> Optimism Sepolia
    [
        solanaContract,
        optimismContract,
        [['LayerZero Labs'], []], // [requiredDVN[], [optionalDVN[], threshold]]
        [1, 12], // [Solana confirmations, Optimism confirmations]
        [EVM_ENFORCED_OPTIONS, SOLANA_ENFORCED_OPTIONS], // [To EVM, To Solana]
    ],
]

export default async function () {
    // Generate the connections config based on the pathways
    const connections = await generateConnectionsConfig(pathways)
    
    return {
        contracts: [
            { contract: solanaContract },
            { contract: ethereumContract },
            { contract: optimismContract },
        ],
        connections,
    }
} 