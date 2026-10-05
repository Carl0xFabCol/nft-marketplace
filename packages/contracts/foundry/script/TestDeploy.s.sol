// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

contract TinyContract {
    uint256 public value;

    constructor(uint256 _value) {
        value = _value;
    }
}

contract TestDeploy is Script {
    function run() external {
        vm.startBroadcast();

        new TinyContract(123);

        vm.stopBroadcast();
    }
}
