// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "../src/Marketplace.sol";

contract AuthorizeMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address CORE = vm.envAddress("CORE_ADDRESS");
        address MARKETPLACE = vm.envAddress("MARKETPLACE_ADDRESS");
        address BIDS = vm.envAddress("BIDS_ADDRESS");

        MarketplaceCore core = MarketplaceCore(payable(CORE));
        MarketplaceBids bids = MarketplaceBids(payable(BIDS));
        Marketplace marketplace = Marketplace(payable(MARKETPLACE));

        vm.startBroadcast(deployerPrivateKey);

        console.log("=================================");
        console.log("CONFIGURING MARKETPLACE");
        console.log("=================================");

        // ═══════════════════════════════════════════════════════════════════════
        // 1. Authorize Bids in Core
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n1. Authorizing Bids in Core...");

        if (!core.authorizedContracts(BIDS)) {
            core.setAuthorizedContract(BIDS, true);
            console.log("Bids authorized");
        } else {
            console.log("Bids already authorized");
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 2. Authorize Marketplace in Core
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n2. Authorizing Marketplace in Core...");

        if (!core.authorizedContracts(MARKETPLACE)) {
            core.setAuthorizedContract(MARKETPLACE, true);
            console.log("Marketplace authorized");
        } else {
            console.log("Marketplace already authorized");
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 3. Configure Bids -> Marketplace
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n3. Configuring Bids marketplace address...");

        if (bids.marketplace() != MARKETPLACE) {
            bids.setMarketplaceAddress(MARKETPLACE);
            console.log("Marketplace address configured");
        } else {
            console.log("Marketplace address already configured");
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 4. Accept pending component ownership
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n4. Checking component ownership...");

        if (core.pendingOwner() == MARKETPLACE) {
            marketplace.acceptComponentOwnership();
            console.log("Core ownership accepted");
        }

        if (bids.pendingOwner() == MARKETPLACE) {
            marketplace.acceptComponentOwnership();
            console.log("Bids ownership accepted");
        }

        vm.stopBroadcast();

        // ═══════════════════════════════════════════════════════════════════════
        // Verification
        // ═══════════════════════════════════════════════════════════════════════

        console.log("\n=================================");
        console.log("CONFIGURATION COMPLETE");
        console.log("=================================");

        console.log("Core:", CORE);
        console.log("Bids:", BIDS);
        console.log("Marketplace:", MARKETPLACE);

        console.log("\nOwners:");
        console.log("Core owner:", core.owner());
        console.log("Bids owner:", bids.owner());
        console.log("Marketplace owner:", marketplace.owner());

        console.log("\nAuthorized:");
        console.log("Bids:", core.authorizedContracts(BIDS));
        console.log("Marketplace:", core.authorizedContracts(MARKETPLACE));

        console.log("\nBids marketplace:");
        console.log(bids.marketplace());

        require(core.authorizedContracts(BIDS), "Bids is not authorized");

        require(core.authorizedContracts(MARKETPLACE), "Marketplace is not authorized");

        require(bids.marketplace() == MARKETPLACE, "Bids marketplace is incorrect");

        console.log("\nAll checks passed.");
        console.log("=================================");
    }
}
