// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import "./MockMalformedReturn.sol";

/// @notice NB-1: malformed ownerOf data must never make a valid listing stale.
contract AuditNB1Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
    }

    function _listToken() internal {
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function _setOwnerOfMode(uint8 mode) internal {
        malformed.setMalformedOwnerOfMode(
            true,
            (uint256(1) << 160) | 1,
            mode
        );
    }

    function _assertListingSurvives() internal view {
        (address listingSeller, uint128 listingPrice, , , , ) =
            core.listings(address(malformed), 1);
        assertEq(listingSeller, seller);
        assertEq(listingPrice, SALE_PRICE);
        assertEq(core.totalListings(), 1);
    }

    function testNB1_CleanRejects64ByteOwnerOf() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_CleanRejectsDirtyAddressOwnerOf() public {
        _listToken();
        _setOwnerOfMode(0);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_CleanRejectsBoolStyleOwnerOf() public {
        _listToken();
        _setOwnerOfMode(2);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_BuyRejectsMalformedOwnerOfWithoutCleanup() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_BuyBatchRejectsMalformedOwnerOfWithoutCleanup() public {
        _listToken();
        _setOwnerOfMode(1);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buyBatch{value: SALE_PRICE}(address(malformed), tokenIds);

        _assertListingSurvives();
    }

    function testNB1_UpdateRejectsMalformedOwnerOfWithoutChange() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.updateListingPrice(address(malformed), 1, uint128(SALE_PRICE * 2));

        _assertListingSurvives();
    }
}
