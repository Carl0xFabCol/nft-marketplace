// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";

interface IVerifyCore {
    function router() external view returns (address);
    function bidsContract() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function paused() external view returns (bool);
    function authorizedLaunchpads(address launchpad) external view returns (bool);
    function feeReceiver() external view returns (address);
    function marketplaceFee() external view returns (uint16);
    function isRegistered(address collection) external view returns (bool);
    function MAX_MARKETPLACE_FEE() external view returns (uint256);
    function MAX_ROYALTY_FEE() external view returns (uint256);
}

interface IVerifyBids {
    function core() external view returns (address);
    function marketplace() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function paused() external view returns (bool);
}

interface IVerifyRouter {
    function core() external view returns (address);
    function bids() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

interface IVerifyLaunchPad {
    function core() external view returns (address);
    function owner() external view returns (address);
    function launchFee() external view returns (uint256);
}

/**
 * @title VerifyDeployment
 * @notice Independent, post-broadcast verification of a deployed stack.
 *
 * This script is the ONLY place a deployment is declared configured. It runs as
 * a separate process, reads real on-chain state over RPC (plain eth_calls, so it
 * needs no --broadcast and sends no transactions), and only then promotes
 * deployments/<network>.json from stage `partial` to stage `verified` and
 * refreshes deployments/latest.json.
 *
 * Verification performed during a deployment script's simulation pass proves
 * nothing about the chain, because cheatcodes and asserts run before any
 * transaction is sent (audit finding C-2). Nothing here runs inside a broadcast.
 *
 * Usage (single, unambiguous entrypoint):
 *   NETWORK=elysium forge script VerifyDeployment --sig "run()" --rpc-url elysium
 *
 * Required environment:
 *   NETWORK
 *
 * Optional environment:
 *   USE_ENV_ADDRESSES=true   with CORE_ADDRESS, BIDS_ADDRESS, MARKETPLACE_ADDRESS
 *                            (+ LAUNCHPAD_ADDRESS) to verify explicit addresses
 *   PROMOTE_RECORD=false     verify only; never write a record
 *   EXPECT_PAUSED=true       expect Core and Bids to be paused
 *   EXPECTED_MARKETPLACE_FEE, EXPECTED_FEE_RECEIVER, EXPECTED_ROUTER_OWNER,
 *   EXPECTED_LAUNCH_FEE, EXPECTED_LAUNCHPAD_OWNER, COLLECTION
 */
contract VerifyDeployment is DeploymentConfig {
    struct Report {
        address core;
        address bids;
        address router;
        address launchpad;
        address routerOwner;
        address feeReceiver;
        uint256 marketplaceFee;
        uint256 maxMarketplaceFee;
        uint256 launchFee;
        bool launchpadAuthorized;
    }

    /// @notice Sole entrypoint. Named `run()` with no overloads so that
    ///         `forge script VerifyDeployment --sig "run()"` always resolves.
    function run() external {
        NetworkConfig memory net = _validateNetwork();

        console.log("=================================");
        console.log("DEPLOYMENT VERIFICATION");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);

        Addresses memory addrs = _resolveValidatedAddresses(net);

        Report memory report = _verifyOnChain(
            addrs.core, addrs.bids, addrs.marketplace, addrs.launchpad, _envBool("EXPECT_PAUSED")
        );
        _verifyOptional(addrs.core, addrs.marketplace, addrs.launchpad);
        _verifyAgainstRecord(net, addrs, report);

        console.log("");
        console.log("Core:              ", report.core);
        console.log("Bids:              ", report.bids);
        console.log("Marketplace:       ", report.router);
        if (report.launchpad != address(0)) {
            console.log("LaunchPad:         ", report.launchpad);
            console.log("LaunchPad authorized:", report.launchpadAuthorized);
            console.log("Launch fee (wei):  ", report.launchFee);
        }
        console.log("Router owner:      ", report.routerOwner);
        console.log("Fee receiver:      ", report.feeReceiver);
        console.log("Marketplace fee:   ", report.marketplaceFee);
        console.log("Max allowed fee:   ", report.maxMarketplaceFee);

        console.log("");
        console.log("ALL ON-CHAIN CHECKS PASSED.");

        _promoteRecord(net, addrs, report);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REUSABLE VIEW CHECKS
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Named `verify` rather than `run` so the contract keeps exactly one `run`
    // and stays script-invocable. Used by the unit tests.

    function verify(address core, address bids, address router) external view {
        _verifyOnChain(core, bids, router, address(0), false);
    }

    function verify(address core, address bids, address router, bool expectPaused) external view {
        _verifyOnChain(core, bids, router, address(0), expectPaused);
    }

    function verify(address core, address bids, address router, address launchpad) external view {
        _verifyOnChain(core, bids, router, launchpad, false);
    }

    function verify(address core, address bids, address router, address launchpad, bool expectPaused) external view {
        _verifyOnChain(core, bids, router, launchpad, expectPaused);
    }

    /// @notice Interface/cohesion gate on its own, for callers that want the
    ///         "is this an old deployment?" answer without the full check set.
    function verifyCompatibility(address core, address bids, address router, address launchpad) external view {
        _requireCurrentInterfaces(core, bids, router, launchpad);
        _requireSameDeployment(core, bids, router, launchpad);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNALS
    // ═══════════════════════════════════════════════════════════════════════════

    function _verifyOnChain(
        address coreAddr,
        address bidsAddr,
        address routerAddr,
        address launchpadAddr,
        bool expectPaused
    ) internal view returns (Report memory report) {
        IVerifyCore core = IVerifyCore(coreAddr);
        IVerifyBids bids = IVerifyBids(bidsAddr);
        IVerifyRouter router = IVerifyRouter(routerAddr);

        // Code must exist before anything is read, so a missing contract gives a
        // precise error instead of an empty-return decode failure.
        _requireContract(coreAddr, "CORE");
        _requireContract(bidsAddr, "BIDS");
        _requireContract(routerAddr, "MARKETPLACE");
        if (launchpadAddr != address(0)) _requireContract(launchpadAddr, "LAUNCHPAD");

        // Wiring.
        require(core.router() == routerAddr, "R-5: core.router mismatch");
        require(core.bidsContract() == bidsAddr, "R-5: core.bidsContract mismatch");
        require(bids.marketplace() == routerAddr, "R-5: bids.marketplace mismatch");
        require(bids.core() == coreAddr, "R-5: bids.core mismatch");
        require(router.core() == coreAddr, "R-5: router.core mismatch");
        require(router.bids() == bidsAddr, "R-5: router.bids mismatch");

        // Ownership: components are owned by the router, with no dangling handshake.
        require(core.owner() == routerAddr, "R-5: core.owner is not the router");
        require(bids.owner() == routerAddr, "R-5: bids.owner is not the router");
        require(core.pendingOwner() == address(0), "R-5: core pending owner not cleared");
        require(bids.pendingOwner() == address(0), "R-5: bids pending owner not cleared");
        require(router.owner() != address(0), "R-5: router owner is zero");

        // Fees, read against the contract's own limit rather than a copied literal.
        uint256 maxFee = core.MAX_MARKETPLACE_FEE();
        require(core.feeReceiver() != address(0), "R-5: fee receiver is zero");
        require(core.marketplaceFee() <= maxFee, "R-5: marketplace fee above the contract maximum");

        report.core = coreAddr;
        report.bids = bidsAddr;
        report.router = routerAddr;
        report.launchpad = launchpadAddr;
        report.routerOwner = router.owner();
        report.feeReceiver = core.feeReceiver();
        report.marketplaceFee = core.marketplaceFee();
        report.maxMarketplaceFee = maxFee;

        if (launchpadAddr != address(0)) {
            IVerifyLaunchPad launchpad = IVerifyLaunchPad(launchpadAddr);
            require(launchpad.core() == coreAddr, "R-5: launchpad.core mismatch");
            require(core.authorizedLaunchpads(launchpadAddr), "R-5: launchpad not authorized in Core");
            require(launchpad.owner() != address(0), "R-5: launchpad owner is zero");
            report.launchpadAuthorized = true;
            report.launchFee = launchpad.launchFee();
        }

        if (expectPaused) {
            require(core.paused() && bids.paused(), "R-5: components not paused");
        } else {
            require(!core.paused(), "R-5: core is paused");
            require(!bids.paused(), "R-5: bids is paused");
        }
    }

    function _verifyOptional(address coreAddr, address routerAddr, address launchpadAddr) internal view {
        IVerifyCore core = IVerifyCore(coreAddr);
        IVerifyRouter router = IVerifyRouter(routerAddr);

        uint256 expectedFee = _envUintOr("EXPECTED_MARKETPLACE_FEE", type(uint256).max);
        if (expectedFee != type(uint256).max) {
            require(expectedFee <= core.MAX_MARKETPLACE_FEE(), "R-5: expected marketplace fee above the maximum");
            // casting to 'uint16' is safe because the line above bounds the value
            // by MAX_MARKETPLACE_FEE, which is far below type(uint16).max
            // forge-lint: disable-next-line(unsafe-typecast)
            require(core.marketplaceFee() == uint16(expectedFee), "R-5: marketplace fee mismatch");
        }

        address expectedFeeReceiver = _envAddressOr("EXPECTED_FEE_RECEIVER", address(0));
        if (expectedFeeReceiver != address(0)) {
            require(core.feeReceiver() == expectedFeeReceiver, "R-5: fee receiver mismatch");
        }

        address expectedRouterOwner = _envAddressOr("EXPECTED_ROUTER_OWNER", address(0));
        if (expectedRouterOwner != address(0)) {
            require(router.owner() == expectedRouterOwner, "R-5: router owner mismatch");
        }

        address collection = _envAddressOr("COLLECTION", address(0));
        if (collection != address(0)) {
            require(core.isRegistered(collection), "R-5: collection not registered");
        }

        if (launchpadAddr != address(0)) {
            IVerifyLaunchPad launchpad = IVerifyLaunchPad(launchpadAddr);

            uint256 expectedLaunchFee = _envUintOr("EXPECTED_LAUNCH_FEE", type(uint256).max);
            if (expectedLaunchFee != type(uint256).max) {
                require(launchpad.launchFee() == expectedLaunchFee, "R-5: launch fee mismatch");
            }

            address expectedLaunchpadOwner = _envAddressOr("EXPECTED_LAUNCHPAD_OWNER", address(0));
            if (expectedLaunchpadOwner != address(0)) {
                require(launchpad.owner() == expectedLaunchpadOwner, "R-5: launchpad owner mismatch");
            }
        }
    }

    /**
     * @notice Cross-checks live state against whatever the partial record claimed.
     * @dev Catches the case where a configuration transaction silently failed
     *      after the record was written, e.g. a launch fee that never landed.
     */
    function _verifyAgainstRecord(NetworkConfig memory net, Addresses memory addrs, Report memory report)
        internal
        view
    {
        if (_envBool("USE_ENV_ADDRESSES")) return;

        DeploymentRecord memory rec = _readRecord(net.name);
        if (!rec.exists) return;

        require(rec.core == addrs.core, "R-5: record core does not match the verified core");
        require(rec.bids == addrs.bids, "R-5: record bids does not match the verified bids");
        require(rec.marketplace == addrs.marketplace, "R-5: record marketplace does not match the verified router");
        require(rec.launchpad == addrs.launchpad, "R-5: record launchpad does not match the verified launchpad");

        if (rec.feeReceiver != address(0)) {
            require(
                rec.feeReceiver == report.feeReceiver,
                string.concat(
                    "R-5: on-chain fee receiver ",
                    vm.toString(report.feeReceiver),
                    " does not match the recorded ",
                    vm.toString(rec.feeReceiver)
                )
            );
        }

        require(
            rec.marketplaceFee == report.marketplaceFee,
            string.concat(
                "R-5: on-chain marketplace fee ",
                vm.toString(report.marketplaceFee),
                " does not match the recorded ",
                vm.toString(rec.marketplaceFee),
                " (a configuration transaction may not have landed)"
            )
        );

        if (addrs.launchpad != address(0)) {
            require(
                rec.launchFee == report.launchFee,
                string.concat(
                    "R-5: on-chain launch fee ",
                    vm.toString(report.launchFee),
                    " does not match the recorded ",
                    vm.toString(rec.launchFee),
                    " (setLaunchFee may not have landed)"
                )
            );
        }
    }

    function _promoteRecord(NetworkConfig memory net, Addresses memory addrs, Report memory report) internal {
        if (!_envBoolOr("PROMOTE_RECORD", true)) {
            console.log("");
            console.log("PROMOTE_RECORD=false: record left untouched.");
            return;
        }
        if (_envBool("USE_ENV_ADDRESSES")) {
            console.log("");
            console.log("USE_ENV_ADDRESSES=true: verification only, record left untouched.");
            return;
        }

        DeploymentRecord memory rec = _readRecord(net.name);
        require(rec.exists, "Cannot promote: no record to promote");

        rec.core = addrs.core;
        rec.bids = addrs.bids;
        rec.marketplace = addrs.marketplace;
        rec.launchpad = addrs.launchpad;
        rec.feeReceiver = report.feeReceiver;
        rec.marketplaceFee = report.marketplaceFee;
        rec.launchFee = report.launchFee;
        if (rec.deployer == address(0)) rec.deployer = report.routerOwner;

        _writeRecord(net, rec, STAGE_VERIFIED, true);
        console.log("Deployment promoted to stage=verified and latest.json refreshed.");
    }
}
