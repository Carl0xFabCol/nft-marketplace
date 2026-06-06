// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketplaceBids.sol";

contract AuthorizeMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Set via .env
        address CORE = vm.envAddress("CORE_ADDRESS");
        address MARKETPLACE = vm.envAddress("MARKETPLACE_ADDRESS");
        address BIDS = vm.envAddress("BIDS_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        MarketplaceBids bids = MarketplaceBids(payable(BIDS));

        console.log("Authorizing Marketplace...");
        bids.setMarketplaceAddress(MARKETPLACE);

        vm.stopBroadcast();

        console.log("Done.");
    }
}
