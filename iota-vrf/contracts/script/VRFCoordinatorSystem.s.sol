// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {Script} from "forge-std/Script.sol";
import {VRFCoordinatorSystem} from "../src/VRFCoordinatorSystem.sol";
contract VRFCoordinatorSystemScript is Script {
    VRFCoordinatorSystem public vrfCoordinatorSystem;
    uint256 public deployerPrivateKey = vm.envUint("PRIVATE_KEY");
    function run() public {
        vm.startBroadcast(deployerPrivateKey);
        vrfCoordinatorSystem = new VRFCoordinatorSystem();
        vm.stopBroadcast();
    }
}