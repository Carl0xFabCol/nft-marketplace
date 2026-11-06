// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TestSetup.sol";
import {Vm} from "forge-std/Vm.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title RouterEmitsNoDomainEventsTest
 * @notice Test #4 (INTEGRATION_AUDIT §10): pins the architectural assumption
 *         the indexer relies on. The router (Marketplace.sol) is a pure
 *         forwarding facade, so the indexer only subscribes to Core and Bids.
 *         If the router ever started emitting a domain event (Sale, Listing*,
 *         *Bid*), those events would be silently missed.
 * @dev Drives every user-facing flow through the router while recording logs,
 *      then asserts the router emitted nothing outside its admin allowlist.
 */
contract RouterEmitsNoDomainEventsTest is TestSetup {
    function _allowedRouterTopic(bytes32 topic0) internal pure returns (bool) {
        return topic0 == Ownable.OwnershipTransferred.selector
            || topic0 == Ownable2Step.OwnershipTransferStarted.selector
            || topic0 == Marketplace.ComponentOwnershipTransferStarted.selector;
    }

    function _count(Vm.Log[] memory logs, address emitter, bytes32 topic0) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) n++;
        }
    }

    function test_RouterEmitsNoDomainEvents() public {
        vm.recordLogs();

        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        for (uint256 id = 1; id <= 4; id++) {
            _mintNFT(seller, id);
        }
        _approveOnCore(address(nft), seller);

        // Listing: create, update price, buy.
        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
        marketplace.updateListingPrice(address(nft), 1, uint128(SALE_PRICE * 2));
        vm.stopPrank();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE * 2}(address(nft), 1);

        // Listing: create, cancel.
        vm.startPrank(seller);
        marketplace.createListing(address(nft), 2, uint128(SALE_PRICE), _listingExpiry());
        marketplace.cancelListing(address(nft), 2);
        vm.stopPrank();

        // Token bid: place, accept (5-arg router signature with slippage bounds).
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 3, uint128(SALE_PRICE), 0);
        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 3, bidder, 0, 0);

        // Token bid: place, cancel.
        vm.startPrank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 4, uint128(SALE_PRICE), 0);
        marketplace.cancelTokenBid(address(nft), 4);
        vm.stopPrank();

        // Collection bid: place, accept.
        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 4;
        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);

        // Collection bid: place, cancel.
        vm.startPrank(buyer);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
        marketplace.cancelCollectionBid(address(nft));
        vm.stopPrank();

        // Admin: router ownership handshake (allowed router events).
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);
        vm.prank(newOwner);
        marketplace.acceptOwnership();

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // The assumption under test: nothing but admin events from the router.
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(marketplace)) continue;
            assertGt(logs[i].topics.length, 0, "router emitted an anonymous event");
            assertTrue(_allowedRouterTopic(logs[i].topics[0]), "router emitted a non-admin event");
        }

        // Sanity: the flows really ran and the domain events came from Core/Bids.
        assertEq(_count(logs, address(core), MarketplaceCore.CollectionRegistered.selector), 1, "Core.CollectionRegistered");
        assertEq(_count(logs, address(core), MarketplaceCore.ListingCreated.selector), 2, "Core.ListingCreated");
        assertEq(_count(logs, address(core), MarketplaceCore.ListingUpdated.selector), 1, "Core.ListingUpdated");
        assertGe(_count(logs, address(core), MarketplaceCore.ListingCancelled.selector), 1, "Core.ListingCancelled");
        assertEq(_count(logs, address(core), MarketplaceCore.Sale.selector), 3, "Core.Sale (buy + 2 bid acceptances)");
        assertEq(_count(logs, address(bids), MarketplaceBids.TokenBidPlaced.selector), 2, "Bids.TokenBidPlaced");
        assertEq(_count(logs, address(bids), MarketplaceBids.TokenBidAccepted.selector), 1, "Bids.TokenBidAccepted");
        assertEq(_count(logs, address(bids), MarketplaceBids.TokenBidCancelled.selector), 1, "Bids.TokenBidCancelled");
        assertEq(_count(logs, address(bids), MarketplaceBids.CollectionBidPlaced.selector), 2, "Bids.CollectionBidPlaced");
        assertEq(_count(logs, address(bids), MarketplaceBids.CollectionBidAccepted.selector), 1, "Bids.CollectionBidAccepted");
        assertEq(_count(logs, address(bids), MarketplaceBids.CollectionBidCancelled.selector), 1, "Bids.CollectionBidCancelled");
        assertEq(_count(logs, address(marketplace), Ownable.OwnershipTransferred.selector), 1, "router ownership handshake");
    }
}
