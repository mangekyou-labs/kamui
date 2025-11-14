// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
import {Script} from "forge-std/Script.sol";
import {BlockHashStore} from "../src/BlockHashStore.sol";
contract BlockHashStoreScript is Script {
    BlockHashStore public blockHashStore;
    uint256 public deployerPrivateKey = vm.envUint("PRIVATE_KEY");

    // @forge-script: forge script BlockHashStoreScript --broadcast 
    // --chain-id 336 --rpc-url 
    // https://mevm.devnet.m1.movementlabs.xyz/v1 --legacy
    function run() public {
        vm.startBroadcast(deployerPrivateKey);
        blockHashStore = new BlockHashStore();
        vm.stopBroadcast();
    }
}