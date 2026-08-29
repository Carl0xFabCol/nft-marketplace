// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import "../src/Marketplace.sol";

contract DeployMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address deployer = vm.addr(deployerPrivateKey);
        address feeReceiver = vm.envOr("FEE_RECEIVER", deployer);
        uint16 marketplaceFee = uint16(vm.envOr("MARKETPLACE_FEE", uint256(100))); // 1%

        vm.startBroadcast(deployerPrivateKey);

        console.log("=================================");
        console.log("DEPLOYING MARKETPLACE");
        console.log("=================================");
        console.log("Deployer:", deployer);
        console.log("Fee Receiver:", feeReceiver);
        console.log("Marketplace Fee:", marketplaceFee, "basis points");

        // ═══════════════════════════════════════════════════════════════════════
        // 1. Deploy Core
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n1. Deploying MarketplaceCore...");

        MarketplaceCore core = new MarketplaceCore(marketplaceFee, feeReceiver);

        console.log("MarketplaceCore deployed at:", address(core));

        // ═══════════════════════════════════════════════════════════════════════
        // 2. Deploy Bids
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n2. Deploying MarketplaceBids...");

        MarketplaceBids bids = new MarketplaceBids(address(core));

        console.log("MarketplaceBids deployed at:", address(bids));

        // ═══════════════════════════════════════════════════════════════════════
        // 3. Deploy Router
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n3. Deploying Marketplace...");

        Marketplace marketplace = new Marketplace(address(core), address(bids));

        console.log("Marketplace deployed at:", address(marketplace));

        // ═══════════════════════════════════════════════════════════════════════
        // 4. Authorize Bids + Marketplace in Core
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n4. Authorizing contracts in Core...");

        core.setAuthorizedContract(address(bids), true);

        console.log("Bids authorized");

        core.setAuthorizedContract(address(marketplace), true);

        console.log("Marketplace authorized");

        // ═══════════════════════════════════════════════════════════════════════
        // 5. Transfer Core ownership -> Marketplace
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n5. Transferring Core ownership to Marketplace...");

        core.transferOwnership(address(marketplace));

        console.log("Core ownership transfer initiated");

        // ═══════════════════════════════════════════════════════════════════════
        // 6. Transfer Bids ownership -> Marketplace
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n6. Transferring Bids ownership to Marketplace...");

        bids.transferOwnership(address(marketplace));

        console.log("Bids ownership transfer initiated");

        // ═══════════════════════════════════════════════════════════════════════
        // 7. Accept both ownership transfers
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n7. Accepting component ownership...");

        marketplace.acceptComponentOwnership();

        console.log("Core owner:", core.owner());
        console.log("Bids owner:", bids.owner());

        require(core.owner() == address(marketplace), "Core ownership transfer failed");

        require(bids.owner() == address(marketplace), "Bids ownership transfer failed");

        // ═══════════════════════════════════════════════════════════════════════
        // 8. Configure Bids -> Marketplace
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n8. Configuring Bids marketplace address...");

        marketplace.configureBidsMarketplace();

        require(bids.marketplace() == address(marketplace), "Bids marketplace configuration failed");

        console.log("Bids marketplace configured");

        vm.stopBroadcast();

        // ═══════════════════════════════════════════════════════════════════════
        // Summary
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n=================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("=================================");

        console.log("MarketplaceCore:", address(core));
        console.log("MarketplaceBids:", address(bids));
        console.log("Marketplace:", address(marketplace));

        console.log("\nOwners:");
        console.log("Core:", core.owner());
        console.log("Bids:", bids.owner());
        console.log("Marketplace:", marketplace.owner());

        console.log("\nConfiguration:");
        console.log("Bids.marketplace:", bids.marketplace());
        console.log("Fee Receiver:", core.feeReceiver());
        console.log("Marketplace Fee:", core.marketplaceFee());

        console.log("\nIMPORTANT:");
        console.log("- Users interact with:", address(marketplace));
        console.log("- NFT approvals must be granted to:", address(core));
        console.log("- Core and Bids are owned by Marketplace");
        console.log("- Marketplace admin is:", deployer);
        console.log("=================================");

        // ═══════════════════════════════════════════════════════════════════════
        // Save addresses
        // ═══════════════════════════════════════════════════════════════════════

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

        // Write the deployment information.
        vm.writeJson(json, "deployments/latest.json");

        console.log("\nDeployment saved to deployments/latest.json");
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
