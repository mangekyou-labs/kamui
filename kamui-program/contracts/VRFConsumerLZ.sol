// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";

/**
 * @title VRFConsumerLZ
 * @dev A contract for consuming VRF randomness from Solana via LayerZero
 */
contract VRFConsumerLZ is NonblockingLzApp {
    // Request ID to randomness mapping
    mapping(bytes32 => uint256[]) public randomResults;
    // Request ID to request status mapping
    mapping(bytes32 => bool) public fulfilled;
    // Request ID to callbackAddress mapping
    mapping(bytes32 => address) public requesters;
    
    // Counter for request IDs
    uint256 public requestCount;
    
    // Events
    event RandomnessRequested(bytes32 requestId, address requester, bytes seed);
    event RandomnessFulfilled(bytes32 requestId, uint256[] randomness);
    
    /**
     * @dev Constructor
     * @param _lzEndpoint LayerZero endpoint address
     */
    constructor(address _lzEndpoint) NonblockingLzApp(_lzEndpoint) {}
    
    /**
     * @dev Request randomness from Solana VRF service
     * @param _dstChainId LayerZero destination chain ID (Solana)
     * @param _seed Custom seed for VRF
     * @param _numWords Number of random words to request
     * @param _poolId Pool ID on Solana VRF
     */
    function requestRandomness(
        uint16 _dstChainId,
        bytes calldata _seed,
        uint32 _numWords,
        uint8 _poolId
    ) external payable returns (bytes32) {
        // Create VRF request ID
        bytes32 requestId = keccak256(abi.encodePacked(
            msg.sender,
            requestCount,
            _seed,
            block.timestamp
        ));
        
        requestCount++;
        requesters[requestId] = msg.sender;
        
        // Prepare payload for LayerZero message
        // [0] is message type (0 = VRF request)
        // [1:33] is requester address (padded to 32 bytes)
        // [33:65] is seed (32 bytes)
        // [65:...] is callback data (requestId)
        // [...] is numWords (uint32)
        // [...] is poolId (uint8)
        
        // Encode the requester address to 32 bytes (Solana pubkey size)
        bytes memory requesterBytes = new bytes(32);
        bytes memory senderBytes = abi.encodePacked(msg.sender);
        for (uint i = 0; i < senderBytes.length && i < 32; i++) {
            requesterBytes[i] = senderBytes[i];
        }
        
        // Encode the callback data (request ID)
        bytes memory callbackData = abi.encodePacked(requestId);
        
        // Prepare the final payload
        bytes memory payload = abi.encodePacked(
            uint8(0), // Message type: VRF request
            requesterBytes,
            _seed,
            callbackData,
            _numWords,
            _poolId
        );
        
        // Calculate fee for LayerZero message
        (uint256 messageFee, ) = lzEndpoint.estimateFees(
            _dstChainId,
            address(this),
            payload,
            false,
            bytes("")
        );
        
        require(msg.value >= messageFee, "Insufficient fee for LayerZero message");
        
        // Send message to Solana via LayerZero
        _lzSend(
            _dstChainId,
            payload,
            payable(msg.sender),
            address(0x0),
            bytes(""),
            msg.value
        );
        
        emit RandomnessRequested(requestId, msg.sender, _seed);
        
        return requestId;
    }
    
    /**
     * @dev Receive and process messages from LayerZero
     * @param _srcChainId Source chain ID
     * @param _srcAddress Source address
     * @param _nonce Nonce
     * @param _payload Payload containing VRF fulfillment
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal override {
        // First byte is message type
        uint8 messageType = uint8(_payload[0]);
        
        if (messageType == 1) { // VRF fulfillment
            // Parse VRF fulfillment payload
            // [1:33] is request ID
            // [33:97] is randomness (64 bytes)
            
            bytes32 requestId;
            assembly {
                requestId := mload(add(_payload, 33)) // 1 (message type) + 32 bytes
            }
            
            // Extract randomness (convert 64 bytes to uint256 array)
            uint256[] memory randomWords = new uint256[](1); // Assuming 1 random word for simplicity
            assembly {
                mstore(add(randomWords, 32), mload(add(_payload, 97))) // 1 + 32 + 64 bytes
            }
            
            // Store results
            randomResults[requestId] = randomWords;
            fulfilled[requestId] = true;
            
            // Emit event
            emit RandomnessFulfilled(requestId, randomWords);
            
            // Call requester if it's a contract
            address requester = requesters[requestId];
            if (requester.code.length > 0) {
                try VRFConsumerCallbackInterface(requester).rawFulfillRandomness(requestId, randomWords) {}
                catch {}
            }
        }
    }
    
    /**
     * @dev Get random result for a request
     * @param _requestId Request ID
     * @return Random value
     */
    function getRandomResult(bytes32 _requestId) external view returns (uint256[] memory) {
        require(fulfilled[_requestId], "Request not fulfilled yet");
        return randomResults[_requestId];
    }
}

/**
 * @title VRFConsumerCallbackInterface
 * @dev Interface for contracts that want to receive VRF callback
 */
interface VRFConsumerCallbackInterface {
    function rawFulfillRandomness(bytes32 requestId, uint256[] memory randomWords) external;
} 