// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";
import {VerifyDeployment} from "./VerifyDeployment.s.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {LaunchPad} from "../src/LaunchPad.sol";

/**
 * @title ConfigureMarketplace
 * @notice Idempotent configuration/resume step for an existing deployment.
 *         It never deploys contracts and never changes marketplace fees.
 *
 * Address source (one of):
 *   - deployments/<NETWORK>.json (default, written by DeployMarketplace)
 *   - USE_ENV_ADDRESSES=true with CORE_ADDRESS, BIDS_ADDRESS,
 *     MARKETPLACE_ADDRESS and optional LAUNCHPAD_ADDRESS
 *
 * Required environment:
 *   NETWORK, PRIVATE_KEY
 */
contract ConfigureMarketplace is DeploymentConfig {
    struct Plan {
        bool wiringCorrect;
        bool needsRouterAccept;
        bool needsCoreTransfer;
        bool needsBidsTransfer;
        bool needsConfigure;
        bool needsAuthorize;
        bool needsTx;
    }

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        (address coreAddr, address bidsAddr, address routerAddr, address launchpadAddr) = _loadAddresses(net);

        _requireContract(coreAddr, "CORE");
        _requireContract(bidsAddr, "BIDS");
        _requireContract(routerAddr, "MARKETPLACE");
        if (launchpadAddr != address(0)) _requireContract(launchpadAddr, "LAUNCHPAD");

        MarketplaceCore core = MarketplaceCore(payable(coreAddr));
        MarketplaceBids bids = MarketplaceBids(payable(bidsAddr));
        Marketplace router = Marketplace(routerAddr);

        _validateStaticLinks(router, bids, launchpadAddr, coreAddr, bidsAddr);
        _validateOwnership(router, core, bids, deployer);

        Plan memory plan = _buildPlan(router, core, bids, deployer, launchpadAddr);

        _logHeader(net, deployer, coreAddr, bidsAddr, routerAddr, launchpadAddr);

        if (plan.needsTx) {
            if (!_isBroadcast()) {
                console.log("");
                console.log("DRY RUN: no transactions are broadcast. Pass --broadcast to execute.");
            }

            vm.startBroadcast(privateKey);
            _apply(router, core, bids, launchpadAddr, plan);
            vm.stopBroadcast();
        } else {
            console.log("");
            console.log("Already configured: no transactions required.");
        }

        _verify(core, bids, router, launchpadAddr);
        _verifyExpectedValues(core, router, launchpadAddr);

        console.log("");
        console.log("Configuration verified.");
    }

    function _validateStaticLinks(
        Marketplace router,
        MarketplaceBids bids,
        address launchpadAddr,
        address coreAddr,
        address bidsAddr
    ) internal view {
        require(address(router.core()) == coreAddr, "Router.core does not match CORE_ADDRESS");
        require(address(router.bids()) == bidsAddr, "Router.bids does not match BIDS_ADDRESS");
        require(address(bids.core()) == coreAddr, "Bids.core does not match CORE_ADDRESS");

        if (launchpadAddr != address(0)) {
            require(address(LaunchPad(launchpadAddr).core()) == coreAddr, "LaunchPad.core does not match CORE_ADDRESS");
        }
    }

    function _buildPlan(
        Marketplace router,
        MarketplaceCore core,
        MarketplaceBids bids,
        address deployer,
        address launchpadAddr
    ) internal view returns (Plan memory plan) {
        address coreRouter = core.router();
        address coreBids = core.bidsContract();
        address bidsMarketplace = bids.marketplace();

        bool wiringUnset = coreRouter == address(0) && coreBids == address(0) && bidsMarketplace == address(0);
        plan.wiringCorrect =
            coreRouter == address(router) && coreBids == address(bids) && bidsMarketplace == address(router);

        require(
            wiringUnset || plan.wiringCorrect,
            "Partial or mismatched Core/Bids wiring detected; manual recovery is required"
        );

        plan.needsRouterAccept = router.owner() != deployer;
        plan.needsCoreTransfer = core.owner() == deployer;
        plan.needsBidsTransfer = bids.owner() == deployer;
        plan.needsConfigure = !plan.wiringCorrect;
        plan.needsAuthorize = launchpadAddr != address(0) && !core.authorizedLaunchpads(launchpadAddr);

        plan.needsTx = plan.needsRouterAccept || plan.needsCoreTransfer || plan.needsBidsTransfer || plan.needsConfigure
            || plan.needsAuthorize || core.pendingOwner() == address(router) || bids.pendingOwner() == address(router);
    }

    function _apply(
        Marketplace router,
        MarketplaceCore core,
        MarketplaceBids bids,
        address launchpadAddr,
        Plan memory plan
    ) internal {
        if (plan.needsRouterAccept) {
            router.acceptOwnership();
        }
        if (plan.needsCoreTransfer) {
            core.transferOwnership(address(router));
        }
        if (plan.needsBidsTransfer) {
            bids.transferOwnership(address(router));
        }
        if (core.pendingOwner() == address(router) || bids.pendingOwner() == address(router)) {
            router.acceptComponentOwnership();
        }
        if (plan.needsConfigure) {
            router.configureBidsMarketplace();
        }
        if (plan.needsAuthorize) {
            router.setAuthorizedLaunchpad(launchpadAddr, true);
        }
    }

    function _logHeader(
        NetworkConfig memory net,
        address deployer,
        address coreAddr,
        address bidsAddr,
        address routerAddr,
        address launchpadAddr
    ) internal view {
        console.log("=================================");
        console.log("MARKETPLACE CONFIGURATION");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Core:", coreAddr);
        console.log("Bids:", bidsAddr);
        console.log("Router:", routerAddr);
        if (launchpadAddr != address(0)) console.log("LaunchPad:", launchpadAddr);
    }

    function _loadAddresses(NetworkConfig memory net)
        internal
        view
        returns (address coreAddr, address bidsAddr, address routerAddr, address launchpadAddr)
    {
        bool useEnv = vm.envOr("USE_ENV_ADDRESSES", false);
        if (useEnv) {
            coreAddr = _requiredEnvAddress("CORE_ADDRESS");
            bidsAddr = _requiredEnvAddress("BIDS_ADDRESS");
            routerAddr = _requiredEnvAddress("MARKETPLACE_ADDRESS");
            launchpadAddr = vm.envOr("LAUNCHPAD_ADDRESS", address(0));
            return (coreAddr, bidsAddr, routerAddr, launchpadAddr);
        }

        string memory path = _deploymentPath(net.name);
        require(
            vm.exists(path),
            string.concat(
                "Missing deployment file ", path, "; set USE_ENV_ADDRESSES=true to configure explicit addresses"
            )
        );

        string memory json = vm.readFile(path);
        coreAddr = _jsonAddress(json, ".core", "core");
        bidsAddr = _jsonAddress(json, ".bids", "bids");
        routerAddr = _jsonAddress(json, ".marketplace", "marketplace");
        if (vm.keyExistsJson(json, ".launchpad")) {
            launchpadAddr = vm.parseJsonAddress(json, ".launchpad");
        }
    }

    function _jsonAddress(string memory json, string memory key, string memory label)
        internal
        view
        returns (address value)
    {
        require(vm.keyExistsJson(json, key), string.concat("Deployment file is missing ", label));
        value = vm.parseJsonAddress(json, key);
        require(value != address(0), string.concat("Deployment file has a zero ", label));
    }

    function _requiredEnvAddress(string memory name) internal view returns (address value) {
        value = vm.envOr(name, address(0));
        require(value != address(0), string.concat(name, " is required when USE_ENV_ADDRESSES=true"));
    }

    function _validateOwnership(Marketplace router, MarketplaceCore core, MarketplaceBids bids, address deployer)
        internal
        view
    {
        if (router.owner() != deployer) {
            require(router.pendingOwner() == deployer, "Deployer is not the router owner or pending owner");
        }

        if (core.owner() == deployer) {
            // transferOwnership will overwrite any pending owner.
        } else {
            require(core.owner() == address(router), "Core is owned by an unexpected address");
            require(core.pendingOwner() == address(0), "Core has an unexpected pending owner");
        }

        if (bids.owner() == deployer) {
            // transferOwnership will overwrite any pending owner.
        } else {
            require(bids.owner() == address(router), "Bids is owned by an unexpected address");
            require(bids.pendingOwner() == address(0), "Bids has an unexpected pending owner");
        }
    }

    function _verify(MarketplaceCore core, MarketplaceBids bids, Marketplace router, address launchpadAddr) internal {
        VerifyDeployment verifier = new VerifyDeployment();
        verifier.run(address(core), address(bids), address(router), launchpadAddr, false);
    }

    function _verifyExpectedValues(MarketplaceCore core, Marketplace router, address launchpadAddr) internal view {
        uint256 expectedFee = vm.envOr("EXPECTED_MARKETPLACE_FEE", type(uint256).max);
        if (expectedFee != type(uint256).max) {
            require(expectedFee <= 1_000, "Expected marketplace fee above maximum");
            require(core.marketplaceFee() == uint16(expectedFee), "Expected marketplace fee does not match");
        }

        address expectedFeeReceiver = vm.envOr("EXPECTED_FEE_RECEIVER", address(0));
        if (expectedFeeReceiver != address(0)) {
            require(core.feeReceiver() == expectedFeeReceiver, "Expected fee receiver does not match");
        }

        address expectedRouterOwner = vm.envOr("EXPECTED_ROUTER_OWNER", address(0));
        if (expectedRouterOwner != address(0)) {
            require(router.owner() == expectedRouterOwner, "Expected router owner does not match");
        }

        if (launchpadAddr != address(0)) {
            uint256 expectedLaunchFee = vm.envOr("EXPECTED_LAUNCH_FEE", type(uint256).max);
            if (expectedLaunchFee != type(uint256).max) {
                require(LaunchPad(launchpadAddr).launchFee() == expectedLaunchFee, "Expected launch fee does not match");
            }
        }
    }
}
