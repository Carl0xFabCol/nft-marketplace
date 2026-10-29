// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import "./MockMalformedReturn.sol";

/// @notice L-N2: malformed return data from untrusted collections must not be
///         decoded as valid, and must not grief legitimate flows.
contract AuditLN2Test is TestSetup {
    MockMalformedNFT internal malformed;
    MockMalformedFactory internal factory;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        factory = new MockMalformedFactory();
    }

    function _registerMalformed() internal {
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function _listMalformedToken() internal {
        _registerMalformed();
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

    function testLN2_MalformedSupportsInterfaceRejected() public {
        malformed.setMalformedSupportsInterface(true);

        vm.prank(owner);
        vm.expectRevert(MarketplaceCore.InvalidCollection.selector);
        marketplace.registerCollection(
            address(malformed),
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr
        );
    }

    function testLN2_MalformedOwnerOfTreatedAsStale() public {
        _listMalformedToken();

        malformed.setMalformedOwnerOf(true, (uint256(1) << 160) | 1);

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);
    }

    function testLN2_MalformedGetApprovedTreatedAsNotApproved() public {
        _registerMalformed();
        malformed.mint(seller, 1);
        malformed.setMalformedGetApproved(true);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function testLN2_MalformedIsApprovedForAllTreatedAsNotApproved() public {
        _registerMalformed();
        malformed.mint(seller, 1);
        malformed.setMalformedIsApprovedForAll(true);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
    }

    function testLN2_MalformedCollectionOwnerRejected() public {
        _registerMalformed();
        malformed.setMalformedOwner(true);

        vm.expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        marketplace.updateCollectionRoyalty(
            address(malformed),
            royaltyReceiverAddr,
            uint16(ROYALTY_FEE)
        );
    }

    function testLN2_MalformedRoyaltyInfoFallsBackToCollectionRoyalty() public {
        address tokenRoyaltyReceiver = address(0xB0B);
        malformed.setTokenRoyalty(1, tokenRoyaltyReceiver, uint96(ROYALTY_FEE));
        _listMalformedToken();

        malformed.setMalformedRoyaltyInfo(true);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(tokenRoyaltyReceiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testLN2_MalformedFactoryCheckRejected() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(factory), true);

        factory.setMalformedIsCollection(true);

        vm.expectRevert(MarketplaceCore.InvalidCollection.selector);
        factory.register(
            address(core),
            address(malformed),
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr,
            address(this)
        );
    }

    function testLN2_MalformedOwnerOfDoesNotBlockBid() public {
        _registerMalformed();
        malformed.mint(seller, 1);

        malformed.setMalformedOwnerOf(
            true,
            (uint256(1) << 160) | uint160(bidder)
        );

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            0
        );

        assertEq(bids.totalBidEscrow(), SALE_PRICE);
    }
}
