// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

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
 * @notice Read-only post-deployment invariant checks.
 *
 * With no arguments, addresses are read from:
 *   1. deployments/<NETWORK>.json when NETWORK is set and the file exists
 *      (set USE_ENV_ADDRESSES=true to force environment variables)
 *   2. CORE, BIDS, MARKETPLACE and optional LAUNCHPAD environment variables
 *
 * Optional assertions:
 *   EXPECTED_MARKETPLACE_FEE, EXPECTED_FEE_RECEIVER, EXPECTED_ROUTER_OWNER,
 *   EXPECTED_LAUNCH_FEE, EXPECTED_LAUNCHPAD_OWNER, COLLECTION, EXPECT_PAUSED
 */
contract VerifyDeployment is DeploymentConfig {
    function run() external view {
        string memory network = vm.envOr("NETWORK", string(""));
        bool useEnv = vm.envOr("USE_ENV_ADDRESSES", false);

        address coreAddr;
        address bidsAddr;
        address routerAddr;
        address launchpadAddr;

        if (!useEnv && bytes(network).length != 0) {
            NetworkConfig memory net = _validateNetwork();
            string memory path = _deploymentPath(net.name);
            if (vm.exists(path)) {
                string memory json = vm.readFile(path);
                if (vm.keyExistsJson(json, ".core")) coreAddr = vm.parseJsonAddress(json, ".core");
                if (vm.keyExistsJson(json, ".bids")) bidsAddr = vm.parseJsonAddress(json, ".bids");
                if (vm.keyExistsJson(json, ".marketplace")) {
                    routerAddr = vm.parseJsonAddress(json, ".marketplace");
                }
                if (vm.keyExistsJson(json, ".launchpad")) {
                    launchpadAddr = vm.parseJsonAddress(json, ".launchpad");
                }
            }
        }

        if (coreAddr == address(0)) coreAddr = vm.envOr("CORE", address(0));
        if (bidsAddr == address(0)) bidsAddr = vm.envOr("BIDS", address(0));
        if (routerAddr == address(0)) routerAddr = vm.envOr("MARKETPLACE", address(0));
        if (launchpadAddr == address(0)) launchpadAddr = vm.envOr("LAUNCHPAD", address(0));

        require(
            coreAddr != address(0) && bidsAddr != address(0) && routerAddr != address(0),
            "Set CORE, BIDS and MARKETPLACE (or NETWORK with a deployment file)"
        );

        bool expectPaused = vm.envOr("EXPECT_PAUSED", false);
        _verify(coreAddr, bidsAddr, routerAddr, launchpadAddr, expectPaused);
        _verifyOptional(coreAddr, routerAddr, launchpadAddr);
    }

    function run(address coreAddr, address bidsAddr, address routerAddr) external view {
        _verify(coreAddr, bidsAddr, routerAddr, address(0), false);
    }

    function run(address coreAddr, address bidsAddr, address routerAddr, bool expectPaused) external view {
        _verify(coreAddr, bidsAddr, routerAddr, address(0), expectPaused);
    }

    function run(address coreAddr, address bidsAddr, address routerAddr, address launchpadAddr) external view {
        _verify(coreAddr, bidsAddr, routerAddr, launchpadAddr, false);
    }

    function run(address coreAddr, address bidsAddr, address routerAddr, address launchpadAddr, bool expectPaused)
        external
        view
    {
        _verify(coreAddr, bidsAddr, routerAddr, launchpadAddr, expectPaused);
    }

    function _verify(address coreAddr, address bidsAddr, address routerAddr, address launchpadAddr, bool expectPaused)
        internal
        view
    {
        IVerifyCore core = IVerifyCore(coreAddr);
        IVerifyBids bids = IVerifyBids(bidsAddr);
        IVerifyRouter router = IVerifyRouter(routerAddr);

        require(core.router() == routerAddr, "R-5: core.router mismatch");
        require(core.bidsContract() == bidsAddr, "R-5: core.bidsContract mismatch");
        require(bids.marketplace() == routerAddr, "R-5: bids.marketplace mismatch");
        require(bids.core() == coreAddr, "R-5: bids.core mismatch");
        require(core.owner() == routerAddr, "R-5: core.owner mismatch");
        require(bids.owner() == routerAddr, "R-5: bids.owner mismatch");
        require(router.core() == coreAddr, "R-5: router.core mismatch");
        require(router.bids() == bidsAddr, "R-5: router.bids mismatch");
        require(core.pendingOwner() == address(0), "R-5: core pending owner not cleared");
        require(bids.pendingOwner() == address(0), "R-5: bids pending owner not cleared");
        require(core.feeReceiver() != address(0), "R-5: fee receiver is zero");
        require(core.marketplaceFee() <= 1_000, "R-5: marketplace fee above maximum");

        if (launchpadAddr != address(0)) {
            require(core.authorizedLaunchpads(launchpadAddr), "R-5: launchpad not authorized");
            require(IVerifyLaunchPad(launchpadAddr).core() == coreAddr, "R-5: launchpad.core mismatch");
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

        uint256 expectedFee = vm.envOr("EXPECTED_MARKETPLACE_FEE", type(uint256).max);
        if (expectedFee != type(uint256).max) {
            require(expectedFee <= 1_000, "R-5: expected marketplace fee above maximum");
            require(core.marketplaceFee() == uint16(expectedFee), "R-5: marketplace fee mismatch");
        }

        address expectedFeeReceiver = vm.envOr("EXPECTED_FEE_RECEIVER", address(0));
        if (expectedFeeReceiver != address(0)) {
            require(core.feeReceiver() == expectedFeeReceiver, "R-5: fee receiver mismatch");
        }

        address expectedRouterOwner = vm.envOr("EXPECTED_ROUTER_OWNER", address(0));
        if (expectedRouterOwner != address(0)) {
            require(router.owner() == expectedRouterOwner, "R-5: router owner mismatch");
        }

        address collection = vm.envOr("COLLECTION", address(0));
        if (collection != address(0)) {
            require(core.isRegistered(collection), "R-5: collection not registered");
        }

        if (launchpadAddr != address(0)) {
            IVerifyLaunchPad launchpad = IVerifyLaunchPad(launchpadAddr);

            uint256 expectedLaunchFee = vm.envOr("EXPECTED_LAUNCH_FEE", type(uint256).max);
            if (expectedLaunchFee != type(uint256).max) {
                require(launchpad.launchFee() == expectedLaunchFee, "R-5: launch fee mismatch");
            }

            address expectedLaunchpadOwner = vm.envOr("EXPECTED_LAUNCHPAD_OWNER", address(0));
            if (expectedLaunchpadOwner != address(0)) {
                require(launchpad.owner() == expectedLaunchpadOwner, "R-5: launchpad owner mismatch");
            }
        }
    }
}
