// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-01: listings whose seller no longer owns the token are stale.
contract AuditStaleListingsTest is TestSetup {
    function _staleListing() internal {
        _setupListing();
        vm.prank(seller);
        nft.transferFrom(seller, buyer, 1);
    }

    function testM01_CreateListingOverwritesStaleListing() public {
        _staleListing();

        _approveOnCore(address(nft), buyer);
        vm.prank(buyer);
        marketplace.createListing(address(nft), 1, uint128(2 ether), 0);

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.seller, buyer);
        assertEq(listing.price, 2 ether);
        assertEq(core.totalListings(), 1);
    }

    function testM01_BuyRejectsStaleListing() public {
        _staleListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testM01_UpdateRejectsStaleListing() public {
        _staleListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.updateListingPrice(address(nft), 1, 2 ether);
    }
}
