// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "../src/Marketplace.sol";

contract DeployMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address deployer = vm.addr(deployerPrivateKey);
        address feeReceiver = vm.envOr("FEE_RECEIVER", deployer);
        uint16 marketplaceFee = uint16(vm.envOr("MARKETPLACE_FEE", uint256(100)));

        // Safety check: this deployment is intended for Sepolia.
        require(block.chainid == 11155111, "Wrong network: expected Sepolia");

        vm.startBroadcast(deployerPrivateKey);

        console.log("=================================");
        console.log("DEPLOYING MARKETPLACE");
        console.log("=================================");
        console.log("Network: Sepolia");
        console.log("Deployer:", deployer);
        console.log("Fee Receiver:", feeReceiver);
        console.log("Marketplace Fee:", marketplaceFee, "basis points");

        // ================================================================
        // 1. Deploy Core
        // ================================================================

        console.log("\n1. Deploying MarketplaceCore...");

        MarketplaceCore core = new MarketplaceCore(marketplaceFee, feeReceiver);

        console.log("MarketplaceCore:", address(core));

        // ================================================================
        // 2. Deploy Bids
        // ================================================================

        console.log("\n2. Deploying MarketplaceBids...");

        MarketplaceBids bids = new MarketplaceBids(address(core));

        console.log("MarketplaceBids:", address(bids));

        // ================================================================
        // 3. Deploy Router
        // ================================================================

        console.log("\n3. Deploying Marketplace...");

        Marketplace marketplace = new Marketplace(address(core), address(bids));

        console.log("Marketplace:", address(marketplace));

        // ================================================================
        // 4. Authorize Bids + Router in Core
        // ================================================================

        console.log("\n4. Authorizing contracts in Core...");

        core.setAuthorizedContract(address(bids), true);
        core.setAuthorizedContract(address(marketplace), true);

        require(core.authorizedContracts(address(bids)), "Bids authorization failed");

        require(core.authorizedContracts(address(marketplace)), "Marketplace authorization failed");

        console.log("Bids authorized");
        console.log("Marketplace authorized");

        // ================================================================
        // 5. Transfer Core ownership -> Router
        // ================================================================

        console.log("\n5. Transferring Core ownership...");

        core.transferOwnership(address(marketplace));

        require(core.pendingOwner() == address(marketplace), "Core pending owner incorrect");

        console.log("Core ownership transfer initiated");

        // ================================================================
        // 6. Transfer Bids ownership -> Router
        // ================================================================

        console.log("\n6. Transferring Bids ownership...");

        bids.transferOwnership(address(marketplace));

        require(bids.pendingOwner() == address(marketplace), "Bids pending owner incorrect");

        console.log("Bids ownership transfer initiated");

        // ================================================================
        // 7. Router accepts ownership of Core + Bids
        // ================================================================

        console.log("\n7. Accepting component ownership...");

        marketplace.acceptComponentOwnership();

        require(core.owner() == address(marketplace), "Core ownership transfer failed");

        require(bids.owner() == address(marketplace), "Bids ownership transfer failed");

        console.log("Core owner:", core.owner());
        console.log("Bids owner:", bids.owner());

        // ================================================================
        // 8. Configure Bids -> Router
        // ================================================================

        console.log("\n8. Configuring Bids marketplace address...");

        marketplace.configureBidsMarketplace();

        require(bids.marketplace() == address(marketplace), "Bids marketplace configuration failed");

        console.log("Bids marketplace:", bids.marketplace());

        // ================================================================
        // 9. Final security/configuration checks
        // ================================================================

        console.log("\n9. Running final checks...");

        require(marketplace.owner() == deployer, "Marketplace owner is not deployer");

        require(core.owner() == address(marketplace), "Core owner incorrect");

        require(bids.owner() == address(marketplace), "Bids owner incorrect");

        require(core.authorizedContracts(address(bids)), "Bids is not authorized in Core");

        require(core.authorizedContracts(address(marketplace)), "Marketplace is not authorized in Core");

        require(bids.marketplace() == address(marketplace), "Bids marketplace incorrect");

        require(address(marketplace.core()) == address(core), "Router Core address incorrect");

        require(address(marketplace.bids()) == address(bids), "Router Bids address incorrect");

        console.log("All checks passed.");

        vm.stopBroadcast();

        // ================================================================
        // Summary
        // ================================================================

        console.log("\n=================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("=================================");

        console.log("Network: Sepolia");
        console.log("Chain ID:", block.chainid);

        console.log("\nContracts:");
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
        console.log("- NFT approvals go to:", address(core));
        console.log("- Core owner:", address(marketplace));
        console.log("- Bids owner:", address(marketplace));
        console.log("- Marketplace admin:", deployer);

        // ================================================================
        // Save deployment
        // ================================================================

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
                '  "chainId": ',
                vm.toString(block.chainid),
                ",\n",
                '  "network": "sepolia"\n',
                "}"
            )
        );

        vm.writeJson(json, "deployments/latest.json");

        console.log("\nDeployment saved to deployments/latest.json");
        console.log("=================================");
    }
}
