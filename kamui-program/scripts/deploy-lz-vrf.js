// Script to deploy the LayerZero VRF integration contracts on EVM chains
const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Get the LayerZero endpoint address for the current network
    const network = await ethers.provider.getNetwork();
    let lzEndpointAddress;

    // Map of network chain IDs to LayerZero endpoint addresses
    const endpointMap = {
        1: "0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675", // Ethereum
        137: "0x3c2269811836af69497E5F486A85D7316753cf62", // Polygon
        56: "0x3c2269811836af69497E5F486A85D7316753cf62", // BNB Chain
        43114: "0x3c2269811836af69497E5F486A85D7316753cf62", // Avalanche
        10: "0x3c2269811836af69497E5F486A85D7316753cf62", // Optimism
        42161: "0x3c2269811836af69497E5F486A85D7316753cf62", // Arbitrum
        // Add more networks as needed
    };

    lzEndpointAddress = endpointMap[network.chainId];
    if (!lzEndpointAddress) {
        if (network.chainId === 31337) { // Hardhat local network
            console.log("Deploying on local network, deploying mock LayerZero endpoint");

            // Deploy a mock endpoint for testing
            const LZEndpointMock = await ethers.getContractFactory("LZEndpointMock");
            const lzEndpoint = await LZEndpointMock.deploy(network.chainId);
            await lzEndpoint.deployed();
            lzEndpointAddress = lzEndpoint.address;
            console.log("Mock LZ Endpoint deployed at:", lzEndpointAddress);
        } else {
            throw new Error(`No LayerZero endpoint defined for network with chain ID ${network.chainId}`);
        }
    }

    // Deploy the VRFConsumerLZ contract
    const VRFConsumerLZ = await ethers.getContractFactory("VRFConsumerLZ");
    const vrfConsumer = await VRFConsumerLZ.deploy(lzEndpointAddress);
    await vrfConsumer.deployed();
    console.log("VRFConsumerLZ deployed to:", vrfConsumer.address);

    // Deploy the GameWithVRF contract
    const GameWithVRF = await ethers.getContractFactory("GameWithVRF");
    const game = await GameWithVRF.deploy(vrfConsumer.address);
    await game.deployed();
    console.log("GameWithVRF deployed to:", game.address);

    // If we're on a testnet, set trusted remotes for testing
    if (network.chainId !== 1) {
        console.log("Setting up trusted remotes for testing...");

        // Set Solana as a trusted remote (chain ID 0 in LayerZero)
        const solanaChainId = 0;
        const solanaAddress = "0x" + "11".repeat(32); // Mock address for Solana endpoint

        try {
            // Set trusted remote on the VRF consumer
            await vrfConsumer.setTrustedRemoteAddress(
                solanaChainId,
                solanaAddress
            );
            console.log(`Trusted remote set for Solana (chain ID ${solanaChainId})`);
        } catch (error) {
            console.error("Error setting trusted remote:", error);
        }
    }

    console.log("Deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 