// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice O-2: permissionless cleanup also removes expired listings.
contract O2_ExpiredCleanupTest is TestSetup {
    function testExpiredListingIsCleaned() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _mintNFT(seller, 2);
        _approveOnCore(address(nft), seller);

        uint64 shortExpiry = uint64(block.timestamp + 1);
        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), shortExpiry);
        marketplace.createListing(address(nft), 2, uint128(SALE_PRICE), _listingExpiry());
        vm.stopPrank();

        assertEq(core.totalListings(), 2);

        vm.warp(shortExpiry + 1);

        marketplace.cleanStaleListing(address(nft), 1);

        (address cleanedSeller, uint128 cleanedPrice, , , , ) =
            core.listings(address(nft), 1);
        assertEq(cleanedSeller, address(0));
        assertEq(cleanedPrice, 0);
        assertEq(core.totalListings(), 1, "exactly one listing must be removed");

        // The live listing is untouched.
        (address liveSeller, uint128 livePrice, , , , ) =
            core.listings(address(nft), 2);
        assertEq(liveSeller, seller);
        assertEq(livePrice, SALE_PRICE);
    }

    function testLiveListingStillReverts() public {
        _setupListing();

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(nft), 1);
    }
}
