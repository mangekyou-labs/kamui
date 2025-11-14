// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;
import {Script} from "forge-std/Script.sol";
import {VRFCoordinatorModule} from "../src/VRFCoordinatorModule.sol";
import {VRFCoordinatorSystem} from "../src/VRFCoordinatorSystem.sol";
import "forge-std/console.sol";
contract InteractScript is Script {
    VRFCoordinatorModule public vrfCoordinatorModule;
    VRFCoordinatorSystem public vrfCoordinatorSystem;
    uint256 public deployerPrivateKey = vm.envUint("PRIVATE_KEY");
    function run() public {
        vm.startBroadcast(deployerPrivateKey);
        vrfCoordinatorSystem = VRFCoordinatorSystem(0x1c1bC3C040EB3C1B2215F64CfcE56Ad98300ce0e);
        // vrfCoordinatorModule.setNumber(1);
        console.log("WorldAdderess is : ", vrfCoordinatorSystem.getWorldAddress());

        vm.stopBroadcast();
    }
}