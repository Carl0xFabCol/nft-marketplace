// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";
import {Hyperc} from "../src/MERC721.sol";
import {Marketplace} from "../src/Marketplace.sol";

/**
 * @title CreateHypurr
 * @notice Deploys a standalone Hyperc collection and registers it immediately
 *         through the router. No delayed-registration API is used.
 *
 * Required environment:
 *   NETWORK, PRIVATE_KEY
 *   MARKETPLACE_ADDRESS or deployments/<NETWORK>.json
 *
 * Optional environment:
 *   HYPURR_OWNER               collection owner, defaults to the deployer
 *   CONFIRM_NEW_COLLECTION     must be true to deploy a brand new collection
 *   HYPURR_COLLECTION_ADDRESS  resume with an existing collection
 *   HYPURR_MINT_ONE            mint one token to HYPURR_OWNER (default false)
 *   USE_ENV_ADDRESSES          force MARKETPLACE_ADDRESS instead of the file
 */
contract CreateHypurr is DeploymentConfig {
    string internal constant NAME = "Hypurr Testnet";
    string internal constant SYMBOL = "Hypurr";
    string internal constant BASE_URI = "ipfs://bafybeigs5lojzzear4gyuizxgmdabdam7jftguarspv4rcxw665pkioxdy/";
    uint16 internal constant ROYALTY_FEE = 100;
    uint256 internal constant MAX_SUPPLY = 10_000;
    uint256 internal constant MINT_PRICE = 0.01 ether;

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        address marketplaceAddr = _resolveMarketplace(net);
        _requireContract(marketplaceAddr, "MARKETPLACE_ADDRESS");

        Marketplace marketplace = Marketplace(marketplaceAddr);
        require(marketplace.owner() == deployer, "Deployer is not the marketplace/router owner");

        address owner = vm.envOr("HYPURR_OWNER", deployer);
        require(owner != address(0), "HYPURR_OWNER must be non-zero");

        address existing = vm.envOr("HYPURR_COLLECTION_ADDRESS", address(0));
        bool mintOne = vm.envOr("HYPURR_MINT_ONE", false);
        bool broadcasting = _isBroadcast();

        console.log("=================================");
        console.log("HYPURR COLLECTION");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Marketplace:", marketplaceAddr);
        console.log("Collection owner:", owner);
        if (!broadcasting) {
            console.log("");
            console.log("DRY RUN: no transactions are broadcast. Pass --broadcast to execute.");
        }

        address collection;
        if (existing != address(0)) {
            _requireContract(existing, "HYPURR_COLLECTION_ADDRESS");
            collection = existing;
            console.log("Resuming with existing collection:", collection);

            vm.startBroadcast(privateKey);
            _registerIfNeeded(marketplace, collection, owner);
            if (mintOne) Hyperc(collection).mint{value: MINT_PRICE}(owner);
            vm.stopBroadcast();
        } else {
            require(
                vm.envOr("CONFIRM_NEW_COLLECTION", false),
                "Set CONFIRM_NEW_COLLECTION=true to deploy a new collection (or HYPURR_COLLECTION_ADDRESS to resume)"
            );

            vm.startBroadcast(privateKey);

            collection =
                address(new Hyperc(NAME, SYMBOL, owner, ROYALTY_FEE, owner, MAX_SUPPLY, BASE_URI, MINT_PRICE, 0));

            _registerIfNeeded(marketplace, collection, owner);
            if (mintOne) Hyperc(collection).mint{value: MINT_PRICE}(owner);

            vm.stopBroadcast();
        }

        _verify(marketplace, collection, owner);

        console.log("Collection:", collection);
        console.log("Owner:", Hyperc(collection).owner());
        console.log("Max supply:", Hyperc(collection).maxSupply());
        console.log("Mint price (wei):", Hyperc(collection).mintPrice());
        console.log("Next token id:", Hyperc(collection).getNextTokenId());
        console.log("Registered:", marketplace.collections(collection).exists);
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

    function _registerIfNeeded(Marketplace marketplace, address collection, address owner) internal {
        Marketplace.CollectionInfo memory info = marketplace.collections(collection);

        if (info.exists) {
            require(info.royaltyFee == ROYALTY_FEE, "Existing collection has a different royalty fee");
            require(info.royaltyReceiver == owner, "Existing collection has a different royalty receiver");
            console.log("Collection is already registered.");
            return;
        }

        // Immediate registration (the delayed flow no longer exists).
        marketplace.registerCollection(collection, ROYALTY_FEE, owner);
        console.log("Collection registered immediately.");
    }

    function _verify(Marketplace marketplace, address collectionAddr, address owner) internal view {
        Hyperc collection = Hyperc(collectionAddr);

        require(collection.owner() == owner, "Collection owner mismatch");
        require(collection.maxSupply() == MAX_SUPPLY, "Max supply mismatch");
        require(collection.mintPrice() == MINT_PRICE, "Mint price mismatch");
        require(keccak256(bytes(collection.baseURI())) == keccak256(bytes(BASE_URI)), "Base URI mismatch");

        Marketplace.CollectionInfo memory info = marketplace.collections(collectionAddr);
        require(info.exists, "Collection is not registered");
        require(info.royaltyFee == ROYALTY_FEE, "Registered royalty fee mismatch");
        require(info.royaltyReceiver == owner, "Registered royalty receiver mismatch");
    }
}
