// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

contract TestBroadcast is Script {
    function run() external {
        vm.startBroadcast();
        vm.stopBroadcast();
    }
}
