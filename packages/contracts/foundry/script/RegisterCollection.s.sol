// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";
import {Marketplace} from "../src/Marketplace.sol";

/**
 * @title RegisterCollection
 * @notice Registers an externally deployed ERC721 collection immediately.
 *         Safe to re-run: an already registered collection is only verified.
 *
 * Required environment:
 *   NETWORK, PRIVATE_KEY
 *   COLLECTION_ADDRESS
 *   ROYALTY_FEE             basis points, 0..2000
 *   ROYALTY_RECEIVER        non-zero receiver
 *   MARKETPLACE_ADDRESS or deployments/<NETWORK>.json
 *
 * Optional environment:
 *   USE_ENV_ADDRESSES       force MARKETPLACE_ADDRESS instead of the file
 */
contract RegisterCollection is DeploymentConfig {
    uint256 internal constant MAX_ROYALTY_FEE = 2_000;

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        address marketplaceAddr = _resolveMarketplace(net);
        _requireContract(marketplaceAddr, "MARKETPLACE_ADDRESS");

        address collection = vm.envOr("COLLECTION_ADDRESS", address(0));
        _requireContract(collection, "COLLECTION_ADDRESS");

        uint256 royaltyFee = vm.envOr("ROYALTY_FEE", type(uint256).max);
        require(royaltyFee != type(uint256).max, "ROYALTY_FEE is required");
        require(royaltyFee <= MAX_ROYALTY_FEE, "ROYALTY_FEE exceeds 2000 bps");

        address royaltyReceiver = vm.envOr("ROYALTY_RECEIVER", address(0));
        require(royaltyReceiver != address(0), "ROYALTY_RECEIVER must be non-zero");

        Marketplace marketplace = Marketplace(marketplaceAddr);
        require(marketplace.owner() == deployer, "Deployer is not the marketplace/router owner");

        Marketplace.CollectionInfo memory info = marketplace.collections(collection);

        console.log("=================================");
        console.log("COLLECTION REGISTRATION");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Marketplace:", marketplaceAddr);
        console.log("Collection:", collection);
        console.log("Royalty fee (bps):", royaltyFee);
        console.log("Royalty receiver:", royaltyReceiver);

        if (info.exists) {
            require(info.royaltyFee == uint16(royaltyFee), "Collection already registered with another fee");
            require(info.royaltyReceiver == royaltyReceiver, "Collection already registered with another receiver");
            console.log("");
            console.log("Already registered with the requested configuration; no transaction required.");
        } else {
            if (!_isBroadcast()) {
                console.log("");
                console.log("DRY RUN: no transactions are broadcast. Pass --broadcast to execute.");
            }

            vm.startBroadcast(privateKey);
            marketplace.registerCollection(collection, uint16(royaltyFee), royaltyReceiver);
            vm.stopBroadcast();

            console.log("");
            console.log("Collection registered immediately.");
        }

        info = marketplace.collections(collection);
        require(info.exists, "Registration verification failed");
        require(info.royaltyFee == uint16(royaltyFee), "Registered royalty fee mismatch");
        require(info.royaltyReceiver == royaltyReceiver, "Registered royalty receiver mismatch");

        console.log("Registration verified.");
    }

    function _resolveMarketplace(NetworkConfig memory net) internal view returns (address) {
        if (!vm.envOr("USE_ENV_ADDRESSES", false)) {
            address fromFile = _deploymentAddressIfPresent(net.name, ".marketplace");
            if (fromFile != address(0)) return fromFile;
        }

        address fromEnv = vm.envOr("MARKETPLACE_ADDRESS", address(0));
        require(fromEnv != address(0), "MARKETPLACE_ADDRESS is required (or provide deployments/<NETWORK>.json)");
        return fromEnv;
    }
}
