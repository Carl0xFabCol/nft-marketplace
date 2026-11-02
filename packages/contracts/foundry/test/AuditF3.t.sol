// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {MockMalformedNFT} from "./MockMalformedReturn.sol";

/// @notice F-3: every ownership read of an untrusted NFT must go through the
///         bounded _tryOwnerOf helper instead of a direct ownerOf call.
contract AuditF3Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);
    }

    function _listToken() internal {
        vm.prank(seller);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function testF3_CreateListingMalformedOwnerOfRevertsNotTokenOwner() public {
        malformed.setMalformedOwnerOfMode(true, uint256(uint160(seller)), 1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function testF3_CreateListingRevertingOwnerOfRevertsNotTokenOwner() public {
        malformed.setOwnerOfRevertMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function testF3_ExecuteSaleFromBidMalformedOwnerOfRevertsNotTokenOwner() public {
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(malformed), 1, uint128(SALE_PRICE), 0
        );

        malformed.setMalformedOwnerOfMode(true, uint256(uint160(seller)), 1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptTokenBid(address(malformed), 1, bidder, 0, 0);
    }

    function testF3_ExecuteSaleFromBidRevertingOwnerOfRevertsNotTokenOwner() public {
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(malformed), 1, uint128(SALE_PRICE), 0
        );

        malformed.setOwnerOfRevertMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptTokenBid(address(malformed), 1, bidder, 0, 0);
    }
}
