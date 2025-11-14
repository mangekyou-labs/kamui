// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {Script} from "forge-std/Script.sol";
import {VRFCoordinatorModule} from "../src/VRFCoordinatorModule.sol";
contract VRFCoordinatorModuleScript is Script {
    VRFCoordinatorModule public vrfCoordinatorModule;
    uint256 public deployerPrivateKey = vm.envUint("PRIVATE_KEY");
    function run() public {
        vm.startBroadcast(deployerPrivateKey);
        vrfCoordinatorModule = new VRFCoordinatorModule();
        vm.stopBroadcast();
    }
}