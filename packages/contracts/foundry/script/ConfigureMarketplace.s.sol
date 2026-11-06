// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";

/**
 * @title ConfigureMarketplace
 * @notice Step 2 of 3. Idempotent ownership handshake and wiring for a stack
 *         that DeployMarketplace has already put in place. It never deploys a
 *         contract, never changes fees, and never marks a deployment verified.
 *
 * Safe to re-run. Every action is conditional on current on-chain state, so an
 * interrupted run is resumed simply by running the script again.
 *
 * On irreversibility: MarketplaceCore.setRouter, MarketplaceCore.setBidsContract
 * and MarketplaceBids.setMarketplaceAddress each revert with AlreadySet() once
 * written, and Marketplace.configureBidsMarketplace calls all three in one
 * transaction. The wiring is therefore all-or-nothing and permanent. When a
 * partially or wrongly wired stack is detected this script reports exactly which
 * anchors are frozen and what has to be redeployed, rather than attempting a
 * repair that cannot succeed (audit finding H-3).
 *
 * Address source, chosen explicitly and never inferred:
 *   - default:               deployments/<NETWORK>.json (must exist)
 *   - USE_ENV_ADDRESSES=true CORE_ADDRESS, BIDS_ADDRESS, MARKETPLACE_ADDRESS
 *                            and optional LAUNCHPAD_ADDRESS
 *
 * Required environment:
 *   NETWORK, PRIVATE_KEY
 */
contract ConfigureMarketplace is DeploymentConfig {
    struct Wiring {
        address coreRouter;
        address coreBids;
        address bidsMarketplace;
        bool allUnset;
        bool allCorrect;
    }

    struct Plan {
        bool needsRouterAccept;
        bool needsCoreTransfer;
        bool needsBidsTransfer;
        bool needsComponentAccept;
        bool needsConfigure;
        bool needsAuthorize;
        bool needsTx;
    }

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        Addresses memory addrs = _resolveValidatedAddresses(net);

        MarketplaceCore core = MarketplaceCore(payable(addrs.core));
        MarketplaceBids bids = MarketplaceBids(payable(addrs.bids));
        Marketplace router = Marketplace(addrs.marketplace);

        _logHeader(net, deployer, addrs);

        Wiring memory wiring = _inspectWiring(core, bids, router);
        _reportWiring(wiring, addrs);
        _requireRecoverable(wiring, addrs);
        _validateOwnership(router, core, bids, deployer);

        Plan memory plan = _buildPlan(router, core, bids, deployer, addrs.launchpad, wiring);
        _reportPlan(plan);
        _logDryRunNotice();

        if (plan.needsTx) {
            vm.startBroadcast(privateKey);
            _apply(router, core, bids, addrs.launchpad, plan);
            vm.stopBroadcast();
        }

        _logFooter(net);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WIRING INSPECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function _inspectWiring(MarketplaceCore core, MarketplaceBids bids, Marketplace router)
        internal
        view
        returns (Wiring memory wiring)
    {
        wiring.coreRouter = core.router();
        wiring.coreBids = core.bidsContract();
        wiring.bidsMarketplace = bids.marketplace();

        wiring.allUnset =
            wiring.coreRouter == address(0) && wiring.coreBids == address(0) && wiring.bidsMarketplace == address(0);
        wiring.allCorrect = wiring.coreRouter == address(router) && wiring.coreBids == address(bids)
            && wiring.bidsMarketplace == address(router);
    }

    function _reportWiring(Wiring memory wiring, Addresses memory addrs) internal view {
        console.log("");
        console.log("Set-once wiring anchors (permanent once written):");
        _reportAnchor("Core.router          ", wiring.coreRouter, addrs.marketplace);
        _reportAnchor("Core.bidsContract    ", wiring.coreBids, addrs.bids);
        _reportAnchor("Bids.marketplace     ", wiring.bidsMarketplace, addrs.marketplace);
    }

    function _reportAnchor(string memory label, address actual, address expected) internal pure {
        if (actual == address(0)) {
            console.log(string.concat("  ", label, " unset (can still be written)"));
        } else if (actual == expected) {
            console.log(string.concat("  ", label, " already correct"));
        } else {
            console.log(string.concat("  ", label, " FROZEN at a different address"));
        }
    }

    /**
     * @notice Refuses to continue when the wiring cannot legally be completed.
     * @dev Three outcomes only: already correct, completely unset (writable in
     *      one transaction), or frozen (unrecoverable). Anything partially
     *      written cannot be finished, because configureBidsMarketplace writes
     *      all three anchors in a single call and reverts on the first one that
     *      is already set.
     */
    function _requireRecoverable(Wiring memory wiring, Addresses memory addrs) internal view {
        if (wiring.allCorrect || wiring.allUnset) return;

        console.log("");
        console.log("UNRECOVERABLE WIRING STATE");

        if (wiring.coreRouter != address(0) && wiring.coreRouter != addrs.marketplace) {
            console.log("  Core.router is permanently bound to:", wiring.coreRouter);
            console.log("  Expected router:", addrs.marketplace);
            console.log("  -> This MarketplaceCore can never be re-pointed. A new Core is required.");
        }
        if (wiring.coreBids != address(0) && wiring.coreBids != addrs.bids) {
            console.log("  Core.bidsContract is permanently bound to:", wiring.coreBids);
            console.log("  Expected bids:", addrs.bids);
            console.log("  -> This MarketplaceCore can never be re-pointed. A new Core is required.");
        }
        if (wiring.bidsMarketplace != address(0) && wiring.bidsMarketplace != addrs.marketplace) {
            console.log("  Bids.marketplace is permanently bound to:", wiring.bidsMarketplace);
            console.log("  Expected router:", addrs.marketplace);
            console.log("  -> This MarketplaceBids can never be re-pointed. A new Bids is required.");
        }

        console.log("");
        console.log("  Recoverable: nothing. Partially written anchors cannot be completed,");
        console.log("  because Marketplace.configureBidsMarketplace writes all three in one");
        console.log("  transaction and reverts with AlreadySet() on the first one already set.");
        console.log("  Required action: deploy a fresh stack (archive this record first).");

        revert(
            "Partial or mismatched Core/Bids wiring. The set-once anchors above are permanent; "
            "this stack cannot be configured and must be redeployed. No transaction was sent."
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OWNERSHIP
    // ═══════════════════════════════════════════════════════════════════════════

    function _validateOwnership(Marketplace router, MarketplaceCore core, MarketplaceBids bids, address deployer)
        internal
        view
    {
        if (router.owner() != deployer) {
            require(
                router.pendingOwner() == deployer,
                string.concat(
                    "Deployer ",
                    vm.toString(deployer),
                    " is neither owner nor pending owner of the router (owner is ",
                    vm.toString(router.owner()),
                    ")"
                )
            );
        }

        // When the deployer still owns a component, transferOwnership overwrites
        // any stale pending owner, so no further precondition is needed.
        if (core.owner() != deployer) {
            require(
                core.owner() == address(router),
                string.concat("Core is owned by an unexpected address: ", vm.toString(core.owner()))
            );
            require(
                core.pendingOwner() == address(0),
                string.concat("Core has an unexpected pending owner: ", vm.toString(core.pendingOwner()))
            );
        }

        if (bids.owner() != deployer) {
            require(
                bids.owner() == address(router),
                string.concat("Bids is owned by an unexpected address: ", vm.toString(bids.owner()))
            );
            require(
                bids.pendingOwner() == address(0),
                string.concat("Bids has an unexpected pending owner: ", vm.toString(bids.pendingOwner()))
            );
        }
    }

    function _buildPlan(
        Marketplace router,
        MarketplaceCore core,
        MarketplaceBids bids,
        address deployer,
        address launchpadAddr,
        Wiring memory wiring
    ) internal view returns (Plan memory plan) {
        plan.needsRouterAccept = router.owner() != deployer;
        plan.needsCoreTransfer = core.owner() == deployer;
        plan.needsBidsTransfer = bids.owner() == deployer;
        plan.needsComponentAccept = plan.needsCoreTransfer || plan.needsBidsTransfer
            || core.pendingOwner() == address(router) || bids.pendingOwner() == address(router);
        plan.needsConfigure = !wiring.allCorrect;
        plan.needsAuthorize = launchpadAddr != address(0) && !core.authorizedLaunchpads(launchpadAddr);

        plan.needsTx = plan.needsRouterAccept || plan.needsComponentAccept || plan.needsConfigure
            || plan.needsAuthorize;
    }

    function _apply(
        Marketplace router,
        MarketplaceCore core,
        MarketplaceBids bids,
        address launchpadAddr,
        Plan memory plan
    ) internal {
        if (plan.needsRouterAccept) router.acceptOwnership();
        if (plan.needsCoreTransfer) core.transferOwnership(address(router));
        if (plan.needsBidsTransfer) bids.transferOwnership(address(router));
        if (core.pendingOwner() == address(router) || bids.pendingOwner() == address(router)) {
            router.acceptComponentOwnership();
        }
        if (plan.needsConfigure) router.configureBidsMarketplace();
        if (plan.needsAuthorize) router.setAuthorizedLaunchpad(launchpadAddr, true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    function _logHeader(NetworkConfig memory net, address deployer, Addresses memory addrs) internal view {
        console.log("=================================");
        console.log("MARKETPLACE CONFIGURATION (step 2/3)");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Core:", addrs.core);
        console.log("Bids:", addrs.bids);
        console.log("Router:", addrs.marketplace);
        if (addrs.launchpad != address(0)) console.log("LaunchPad:", addrs.launchpad);
    }

    function _reportPlan(Plan memory plan) internal pure {
        console.log("");
        console.log("Actions required:");
        if (!plan.needsTx) {
            console.log("  none - already configured");
            return;
        }
        if (plan.needsRouterAccept) console.log("  router.acceptOwnership()");
        if (plan.needsCoreTransfer) console.log("  core.transferOwnership(router)");
        if (plan.needsBidsTransfer) console.log("  bids.transferOwnership(router)");
        if (plan.needsComponentAccept) console.log("  router.acceptComponentOwnership()");
        if (plan.needsConfigure) console.log("  router.configureBidsMarketplace()");
        if (plan.needsAuthorize) console.log("  router.setAuthorizedLaunchpad(launchpad, true)");
    }

    function _logFooter(NetworkConfig memory net) internal view {
        console.log("");
        if (!_isLive()) {
            console.log("Dry run complete. Nothing was sent.");
            return;
        }
        console.log("Configuration transactions sent.");
        console.log("This deployment is still NOT verified. Run step 3 to confirm on-chain state:");
        console.log(
            string.concat(
                "  NETWORK=", net.name, " forge script VerifyDeployment --sig \"run()\" --rpc-url ", net.name
            )
        );
    }
}
