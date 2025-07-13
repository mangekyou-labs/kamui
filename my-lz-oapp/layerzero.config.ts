import { EndpointId } from '@layerzerolabs/lz-definitions'
import { ExecutorOptionType } from '@layerzerolabs/lz-v2-utilities'
import { TwoWayConfig, generateConnectionsConfig } from '@layerzerolabs/metadata-tools'
import { OAppEnforcedOption, OmniPointHardhat } from '@layerzerolabs/toolbox-hardhat'

import { getSolanaOAppAddress } from './tasks/solana'

const sepoliaContract: OmniPointHardhat = {
    eid: EndpointId.SEPOLIA_V2_TESTNET,
    address: '0x824af7339b4fFC04D0FD867953eCbfCc75dEAf18',
    contractName: 'MyOApp',
}

const solanaContract: OmniPointHardhat = {
    eid: EndpointId.SOLANA_V2_TESTNET,
    address: 'Buef2wMdPvADYjVK4cPU6Hsp7EZTFqCRmVXMVuxbz8pU', // Our deployed OApp store account address
}

// For this example's simplicity, we will use the same enforced options values for sending to all chains
// For production, you should ensure `gas` is set to the correct value through profiling the gas usage of calling OApp._lzReceive(...) on the destination chain
// To learn more, read https://docs.layerzero.network/v2/concepts/applications/oapp-standard#execution-options-and-enforced-settings
const EVM_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1,
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 100_000,
    },
]

const SOLANA_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1,
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 100_000,
    },
]

// To connect Ethereum Sepolia and Solana Devnet
const pathways: TwoWayConfig[] = [
    [
        sepoliaContract, // Chain A contract
        solanaContract, // Chain B contract
        [['LayerZero Labs'], []], // [ requiredDVN[], [ optionalDVN[], threshold ] ]
        [1, 32], // [A to B confirmations, B to A confirmations]
        [SOLANA_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS], // Chain B enforcedOptions, Chain A enforcedOptions
    ],
]

export default async function () {
    // Generate the connections config based on the pathways
    const connections = await generateConnectionsConfig(pathways)
    return {
        contracts: [{ contract: sepoliaContract }, { contract: solanaContract }],
        connections,
    }
}
