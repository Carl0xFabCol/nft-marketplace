// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {MockMalformedNFT} from "./MockMalformedReturn.sol";

contract OwnerQueryHarness is MarketplaceCore {
    constructor() MarketplaceCore(0, address(this)) {}

    function tryOwnerOf(address collection, uint256 tokenId)
        external
        view
        returns (bool valid, bool reverted, address tokenOwner)
    {
        return _tryOwnerOf(collection, tokenId);
    }
}

/// @notice F-2 / NB-7: ownerOf is queried with an explicit gas budget and the
///         reverted/empty-returndata cases are distinguished.
contract AuditF2Test is TestSetup {
    MockMalformedNFT internal malformed;
    OwnerQueryHarness internal ownerHarness;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        ownerHarness = new OwnerQueryHarness();
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

    function _assertListingSurvives() internal view {
        (address listingSeller, uint128 listingPrice, , , , ) =
            core.listings(address(malformed), 1);
        assertEq(listingSeller, seller);
        assertEq(listingPrice, SALE_PRICE);
        assertEq(core.totalListings(), 1);
    }

    function testF2_GasBurningOwnerOfListingSurvivesClean() public {
        _listToken();
        malformed.setOwnerOfGasBurn(10_000);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testF2_CustomErrorOwnerOfIsCleaned() public {
        _listToken();
        malformed.setOwnerOfRevertMode(1);

        marketplace.cleanStaleListing(address(malformed), 1);

        (address listingSeller, uint128 listingPrice, , , , ) =
            core.listings(address(malformed), 1);
        assertEq(listingSeller, address(0));
        assertEq(listingPrice, 0);
        assertEq(core.totalListings(), 0);
    }

    function testF2_EmptyDataOwnerOfListingSurvives() public {
        _listToken();
        malformed.setOwnerOfRevertMode(2);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testF2_LowGasRevertsInsufficientGas() public {
        vm.expectRevert(MarketplaceCore.InsufficientGas.selector);
        ownerHarness.tryOwnerOf{gas: 10_000}(address(malformed), 1);
    }
}
