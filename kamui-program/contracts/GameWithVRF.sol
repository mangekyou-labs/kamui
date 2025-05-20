// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./VRFConsumerLZ.sol";

/**
 * @title GameWithVRF
 * @dev An example game contract that uses VRF via LayerZero
 */
contract GameWithVRF is VRFConsumerCallbackInterface {
    // VRF consumer contract
    VRFConsumerLZ public vrfConsumer;
    
    // Game state
    mapping(address => uint256) public playerScores;
    mapping(bytes32 => address) public pendingRolls;
    
    // Events
    event RollRequested(bytes32 indexed requestId, address indexed player);
    event RollCompleted(bytes32 indexed requestId, address indexed player, uint256 roll);
    
    /**
     * @dev Constructor
     * @param _vrfConsumer VRF consumer contract address
     */
    constructor(address _vrfConsumer) {
        vrfConsumer = VRFConsumerLZ(_vrfConsumer);
    }
    
    /**
     * @dev Request a roll of the dice
     * @param _solanaChainId LayerZero Solana chain ID
     */
    function requestRoll(uint16 _solanaChainId) external payable {
        // Create a seed based on the player's address and block data
        bytes memory seed = abi.encodePacked(
            msg.sender,
            blockhash(block.number - 1),
            block.timestamp
        );
        
        // Request randomness
        bytes32 requestId = vrfConsumer.requestRandomness{value: msg.value}(
            _solanaChainId,
            seed,
            1, // numWords
            0  // poolId
        );
        
        // Store pending roll
        pendingRolls[requestId] = msg.sender;
        
        emit RollRequested(requestId, msg.sender);
    }
    
    /**
     * @dev Callback function called by VRFConsumer when randomness is fulfilled
     * @param requestId Request ID
     * @param randomWords Random words
     */
    function rawFulfillRandomness(
        bytes32 requestId,
        uint256[] memory randomWords
    ) external override {
        // Only allow the VRF consumer to call this function
        require(msg.sender == address(vrfConsumer), "Only VRF consumer can fulfill");
        
        // Get the player who requested this roll
        address player = pendingRolls[requestId];
        require(player != address(0), "Invalid request ID");
        
        // Use the randomness to generate a roll (1-100)
        uint256 rollResult = (randomWords[0] % 100) + 1;
        
        // Update player score
        playerScores[player] += rollResult;
        
        // Clean up
        delete pendingRolls[requestId];
        
        // Emit event
        emit RollCompleted(requestId, player, rollResult);
    }
    
    /**
     * @dev Get player score
     * @param player Player address
     * @return Player score
     */
    function getScore(address player) external view returns (uint256) {
        return playerScores[player];
    }
} 