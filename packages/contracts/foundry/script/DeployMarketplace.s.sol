// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import "../src/Marketplace.sol";

contract DeployMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address feeReceiver = vm.envOr("FEE_RECEIVER", vm.addr(deployerPrivateKey));
        uint16 marketplaceFee = uint16(vm.envOr("MARKETPLACE_FEE", uint256(100))); // 1% default

        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying Marketplace contracts...");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Fee Receiver:", feeReceiver);
        console.log("Marketplace Fee:", marketplaceFee, "basis points");

        // 1. Deploy Core
        console.log("\n1. Deploying MarketplaceCore...");
        MarketplaceCore core = new MarketplaceCore(marketplaceFee, feeReceiver);
        console.log("MarketplaceCore deployed at:", address(core));

        // 2. Deploy Bids
        console.log("\n2. Deploying MarketplaceBids...");
        MarketplaceBids bids = new MarketplaceBids(address(core));
        console.log("MarketplaceBids deployed at:", address(bids));

        // 3. Deploy Marketplace Proxy
        console.log("\n3. Deploying Marketplace Proxy...");
        Marketplace marketplace = new Marketplace(address(core), address(bids));
        console.log("Marketplace Proxy deployed at:", address(marketplace));

        // 4. Authorize
        console.log("\n4. Authorizing Bids contract...");
        core.setAuthorizedContract(address(bids), true);
        console.log("Bids contract authorized");
        core.setAuthorizedContract(address(marketplace), true);
        console.log("Marketplace contract authorized");

        // 5. Transfer ownerships (optional, keeps them on deployer)

        vm.stopBroadcast();

        // Print deployment summary
        console.log("\n=================================");
        console.log("DEPLOYMENT SUMMARY");
        console.log("=================================");
        console.log("MarketplaceCore:", address(core));
        console.log("MarketplaceBids:", address(bids));
        console.log("Marketplace (Main):", address(marketplace));
        console.log("\nIMPORTANT:");
        console.log("- Users should interact with:", address(marketplace));
        console.log("- NFT approvals should be set for:", address(core));
        console.log("=================================");

        // Save addresses to file
        string memory json = string(
            abi.encodePacked(
                "{\n",
                '  "core": "',
                vm.toString(address(core)),
                '",\n',
                '  "bids": "',
                vm.toString(address(bids)),
                '",\n',
                '  "marketplace": "',
                vm.toString(address(marketplace)),
                '",\n',
                '  "feeReceiver": "',
                vm.toString(feeReceiver),
                '",\n',
                '  "marketplaceFee": ',
                vm.toString(marketplaceFee),
                ",\n",
                '  "network": "',
                getChainName(),
                '"\n',
                "}"
            )
        );

        console.log("\nAddresses saved to: deployments/latest.json");
    }

    function getChainName() internal view returns (string memory) {
        uint256 chainId = block.chainid;
        if (chainId == 1) return "mainnet";
        if (chainId == 11155111) return "sepolia";
        if (chainId == 5) return "goerli";
        if (chainId == 137) return "polygon";
        if (chainId == 80001) return "mumbai";
        return vm.toString(chainId);
    }
}
