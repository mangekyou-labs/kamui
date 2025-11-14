// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {Script} from "forge-std/Script.sol";
import {VRFCoordinator} from "../src/VRFCoordinator.sol";
contract VRFCoordinatorScript is Script {
    VRFCoordinator public vrfCoordinator;
    uint256 public deployerPrivateKey = vm.envUint("PRIVATE_KEY");
    address public blockHashStore = 0x114983FA50BeC1dA12Cd02d3FacB1B484dbDE127;
    function run() public {
        vm.startBroadcast(deployerPrivateKey);
        vrfCoordinator = new VRFCoordinator(blockHashStore);
        vm.stopBroadcast();
    }
}