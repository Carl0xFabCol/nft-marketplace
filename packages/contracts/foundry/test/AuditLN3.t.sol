// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-N3: listings must have a non-zero expiry within 30 days.
contract LN3_ListingDurationTest is TestSetup {
    function _prepareToken() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
    }

    function testListingZeroExpiryReverts() public {
        _prepareToken();

        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testListingBeyondMaxDurationReverts() public {
        _prepareToken();

        uint64 tooLong = uint64(block.timestamp + 30 days + 1);

        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), tooLong);
    }

    function testListingResurrectionAfterExpiryFails() public {
        _prepareToken();

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiry);

        vm.warp(expiry + 1);

        // A -> B -> A: the token moves away and back, so the old listing would
        // otherwise become "live" again. It must stay expired.
        vm.prank(seller);
        nft.transferFrom(seller, buyer, 1);
        vm.prank(buyer);
        nft.transferFrom(buyer, seller, 1);

        vm.expectRevert(MarketplaceCore.ListingExpired.selector);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // It also cannot be resurrected as a never-expiring listing.
        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testBidsStillAllowZeroExpiry() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(nft), 1, uint128(SALE_PRICE), 0
        );

        (address bidder_, uint128 price, uint64 expiresAt) =
            bids.tokenBids(address(nft), 1, bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, 0);
    }
}
