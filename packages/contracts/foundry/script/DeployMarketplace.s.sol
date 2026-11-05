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
 * @title DeployMarketplace
 * @notice Fresh deployment of the complete marketplace stack on an explicitly
 *         selected testnet. This script is the only one that deploys the core
 *         marketplace contracts.
 *
 * Required environment:
 *   NETWORK                  elysium | sepolia
 *   PRIVATE_KEY              deployer key (never printed)
 *
 * Optional environment:
 *   FEE_RECEIVER             defaults to the deployer
 *   MARKETPLACE_FEE          basis points, default 100 (1%), max 1000
 *   LAUNCH_FEE               wei, default 0, applied after LaunchPad deployment
 *   ALLOW_REDEPLOY           must be true to broadcast over an existing record
 */
contract DeployMarketplace is DeploymentConfig {
    uint256 internal constant MAX_MARKETPLACE_FEE = 1_000;

    struct Deployment {
        address core;
        address bids;
        address marketplace;
        address launchpad;
        address feeReceiver;
        address deployer;
        uint256 marketplaceFee;
        uint256 launchFee;
    }

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        address feeReceiver = vm.envOr("FEE_RECEIVER", deployer);
        require(feeReceiver != address(0), "FEE_RECEIVER must be non-zero");

        uint256 marketplaceFee = vm.envOr("MARKETPLACE_FEE", uint256(100));
        require(marketplaceFee <= MAX_MARKETPLACE_FEE, "MARKETPLACE_FEE exceeds 1000 bps");

        uint256 launchFee = vm.envOr("LAUNCH_FEE", uint256(0));
        bool broadcasting = _isBroadcast();
        bool allowRedeploy = vm.envOr("ALLOW_REDEPLOY", false);

        if (broadcasting && !allowRedeploy) {
            require(
                !vm.exists(_deploymentPath(net.name)),
                "Deployment record already exists; set ALLOW_REDEPLOY=true to replace it"
            );
            require(
                !_latestDeploymentMatches(net),
                "deployments/latest.json already describes this network; set ALLOW_REDEPLOY=true"
            );
        }

        console.log("=================================");
        console.log("MARKETPLACE DEPLOYMENT");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Fee receiver:", feeReceiver);
        console.log("Marketplace fee (bps):", marketplaceFee);
        console.log("Launch fee (wei):", launchFee);
        if (!broadcasting) {
            console.log("");
            console.log("DRY RUN: no transactions are broadcast. Pass --broadcast to execute.");
        }

        vm.startBroadcast(privateKey);

        MarketplaceCore core = new MarketplaceCore(uint16(marketplaceFee), feeReceiver);
        MarketplaceBids bids = new MarketplaceBids(address(core));
        Marketplace router = new Marketplace(address(core), address(bids));
        LaunchPad launchpad = new LaunchPad(address(core));

        // LaunchPad's constructor defaults to 10 ether; always apply the explicit fee.
        launchpad.setLaunchFee(launchFee);

        vm.stopBroadcast();

        Deployment memory record = Deployment({
            core: address(core),
            bids: address(bids),
            marketplace: address(router),
            launchpad: address(launchpad),
            feeReceiver: feeReceiver,
            deployer: deployer,
            marketplaceFee: marketplaceFee,
            launchFee: launchFee
        });

        // Record the deployed addresses before touching ownership/wiring, so an
        // interrupted configuration can be resumed instead of redeployed.
        if (broadcasting) {
            _writeDeployment(net, record, false);
        }

        vm.startBroadcast(privateKey);

        // Move component ownership to the router (Ownable2Step), then let the
        // router accept and perform the one-time wiring.
        core.transferOwnership(address(router));
        bids.transferOwnership(address(router));
        router.acceptComponentOwnership();
        router.configureBidsMarketplace();

        // Register the factory as an authorized immediate-registration source.
        router.setAuthorizedLaunchpad(address(launchpad), true);

        vm.stopBroadcast();

        _verify(core, bids, router, launchpad, deployer, feeReceiver, uint16(marketplaceFee), launchFee);

        if (broadcasting) {
            _writeDeployment(net, record, true);
        }

        console.log("");
        console.log("=================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("=================================");
        console.log("MarketplaceCore:", address(core));
        console.log("MarketplaceBids:", address(bids));
        console.log("Marketplace (router):", address(router));
        console.log("LaunchPad:", address(launchpad));
        console.log("Router owner (admin):", router.owner());
        console.log("Core owner:", core.owner());
        console.log("Bids owner:", bids.owner());
        console.log("Users interact with the router; NFT approvals target Core:", address(core));

        if (!broadcasting) {
            console.log("");
            console.log("Dry run only: deployment record was NOT written.");
        }
    }

    function _verify(
        MarketplaceCore core,
        MarketplaceBids bids,
        Marketplace router,
        LaunchPad launchpad,
        address deployer,
        address feeReceiver,
        uint16 marketplaceFee,
        uint256 launchFee
    ) internal {
        VerifyDeployment verifier = new VerifyDeployment();
        verifier.run(address(core), address(bids), address(router), address(launchpad), false);

        require(router.owner() == deployer, "Router owner is not deployer");
        require(launchpad.owner() == deployer, "LaunchPad owner is not deployer");
        require(core.feeReceiver() == feeReceiver, "Fee receiver mismatch");
        require(core.marketplaceFee() == marketplaceFee, "Marketplace fee mismatch");
        require(launchpad.launchFee() == launchFee, "Launch fee mismatch");
        require(core.authorizedLaunchpads(address(launchpad)), "LaunchPad not authorized");
    }

    function _writeDeployment(NetworkConfig memory net, Deployment memory record, bool configured) internal {
        string memory obj = "deployment";
        vm.serializeAddress(obj, "core", record.core);
        vm.serializeAddress(obj, "bids", record.bids);
        vm.serializeAddress(obj, "marketplace", record.marketplace);
        vm.serializeAddress(obj, "launchpad", record.launchpad);
        vm.serializeAddress(obj, "feeReceiver", record.feeReceiver);
        vm.serializeAddress(obj, "deployer", record.deployer);
        vm.serializeUint(obj, "marketplaceFee", record.marketplaceFee);
        vm.serializeUint(obj, "launchFee", record.launchFee);
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployedAt", block.timestamp);
        vm.serializeBool(obj, "configured", configured);
        string memory json = vm.serializeString(obj, "network", net.name);

        string memory path = _deploymentPath(net.name);
        vm.writeJson(json, path);

        if (configured) {
            vm.writeJson(json, "deployments/latest.json");
            console.log("");
            console.log("Deployment record written to:", path);
            console.log("Latest deployment record updated.");
        } else {
            console.log("");
            console.log("Partial deployment record written to:", path);
            console.log("If a later step failed, run ConfigureMarketplace to finish the wiring.");
        }
    }
}
