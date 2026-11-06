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
 * ROYALTY SEMANTICS - read before choosing ROYALTY_FEE.
 *
 *   The royalty registered here is a FALLBACK, not an enforced override.
 *   MarketplaceCore.registerCollectionFromRouter stores the value but does not
 *   set `royaltyOverridden`, and MarketplaceCore._getRoyalty prefers a
 *   collection's own ERC-2981 `royaltyInfo` whenever the collection implements
 *   it. The registered fee and receiver are used only when the collection does
 *   not answer ERC-2981, or answers with a zero receiver or an amount above
 *   MAX_ROYALTY_FEE.
 *
 *   To make the marketplace-side values authoritative, the collection owner must
 *   call Marketplace.updateCollectionRoyalty afterwards; that is the only path
 *   that sets `royaltyOverridden` and makes Core's values win. The script prints
 *   which source will actually be used so the two cannot be confused.
 *
 * Address source, chosen explicitly and never inferred:
 *   - default:               deployments/<NETWORK>.json (must exist)
 *   - USE_ENV_ADDRESSES=true CORE_ADDRESS, BIDS_ADDRESS, MARKETPLACE_ADDRESS
 *
 * Required environment:
 *   NETWORK, PRIVATE_KEY
 *   COLLECTION_ADDRESS
 *   ROYALTY_FEE             basis points, 0..Marketplace.MAX_ROYALTY_FEE
 *   ROYALTY_RECEIVER        non-zero receiver
 */
contract RegisterCollection is DeploymentConfig {
    /// @dev ERC-2981 interface id.
    bytes4 internal constant ERC2981_INTERFACE_ID = 0x2a55205a;

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        address marketplaceAddr = _resolveRouter(net);
        Marketplace marketplace = Marketplace(marketplaceAddr);

        address collection = _envAddressOr("COLLECTION_ADDRESS", address(0));
        _requireContract(collection, "COLLECTION_ADDRESS");

        // Limit read from the contract rather than copied into the script.
        uint256 maxRoyalty = marketplace.MAX_ROYALTY_FEE();

        (bool royaltyFeeSet, uint256 royaltyFee) = _envUintOpt("ROYALTY_FEE");
        require(royaltyFeeSet, "ROYALTY_FEE is required");
        require(
            royaltyFee <= maxRoyalty,
            string.concat(
                "ROYALTY_FEE ",
                vm.toString(royaltyFee),
                " exceeds Marketplace.MAX_ROYALTY_FEE (",
                vm.toString(maxRoyalty),
                ")"
            )
        );

        // Narrowed once, immediately after the bound check above, so the rest of
        // the script works with the same width the contracts use.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 royaltyFeeBps = uint16(royaltyFee);

        address royaltyReceiver = _envAddressOr("ROYALTY_RECEIVER", address(0));
        require(royaltyReceiver != address(0), "ROYALTY_RECEIVER must be non-zero");

        require(
            marketplace.owner() == deployer,
            string.concat(
                "Deployer ",
                vm.toString(deployer),
                " is not the router owner (",
                vm.toString(marketplace.owner()),
                ")"
            )
        );

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
        console.log("Max royalty (bps):", maxRoyalty);
        _logRoyaltySource(collection);

        Marketplace.CollectionInfo memory info = marketplace.collections(collection);

        if (info.exists) {
            require(
                info.royaltyFee == royaltyFeeBps,
                string.concat(
                    "Collection is already registered with royalty fee ",
                    vm.toString(uint256(info.royaltyFee)),
                    ", not ",
                    vm.toString(royaltyFee)
                )
            );
            require(
                info.royaltyReceiver == royaltyReceiver,
                string.concat(
                    "Collection is already registered with receiver ",
                    vm.toString(info.royaltyReceiver),
                    ", not ",
                    vm.toString(royaltyReceiver)
                )
            );
            console.log("");
            console.log("Already registered with the requested configuration; no transaction required.");
        } else {
            _logDryRunNotice();

            vm.startBroadcast(privateKey);
            marketplace.registerCollection(collection, royaltyFeeBps, royaltyReceiver);
            vm.stopBroadcast();

            console.log("");
            console.log("Collection registered.");
        }

        info = marketplace.collections(collection);
        require(info.exists, "Registration verification failed");
        require(info.royaltyFee == royaltyFeeBps, "Registered royalty fee mismatch");
        require(info.royaltyReceiver == royaltyReceiver, "Registered royalty receiver mismatch");

        console.log("Stored registry values confirmed.");
        if (!_isLive()) {
            console.log("NOTE: dry run. The confirmation above reflects simulated state only.");
        }
    }

    /**
     * @notice Prints whether the registered royalty will actually be used.
     * @dev Prevents the misreading that a successful registration means the
     *      requested fee is what a sale will pay out.
     */
    function _logRoyaltySource(address collection) internal view {
        (bool ok, bytes32 word) =
            _probe(collection, abi.encodeWithSignature("supportsInterface(bytes4)", ERC2981_INTERFACE_ID));
        bool supports2981 = ok && uint256(word) == 1;

        console.log("");
        if (supports2981) {
            console.log("Royalty source: the collection implements ERC-2981.");
            console.log("  Sales will use the collection's own royaltyInfo(), NOT the fee registered here.");
            console.log("  The registered value is only a fallback (zero receiver, or above the maximum).");
            console.log("  To make marketplace values authoritative, the collection owner must call");
            console.log("  Marketplace.updateCollectionRoyalty, which sets royaltyOverridden.");
        } else {
            console.log("Royalty source: the collection does not answer ERC-2981.");
            console.log("  Sales will use the fee and receiver registered here.");
        }
    }
}
