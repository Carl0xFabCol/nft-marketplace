// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceTest is TestSetup {
    function testConstructor_DeploysCorrectly() public {
        assertEq(address(marketplace.core()), address(core));
        assertEq(address(marketplace.bids()), address(bids));
        assertEq(marketplace.owner(), owner);
    }

    function testViews() public {
        assertEq(marketplace.marketplaceFee(), uint16(MARKETPLACE_FEE));
        assertEq(marketplace.feeReceiver(), feeReceiverAddr);
        assertEq(marketplace.totalVolume(), 0);
        assertEq(marketplace.totalSales(), 0);
        assertEq(marketplace.totalListings(), 0);
    }

    function testRegisterCollection_ThroughRouter() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        Marketplace.CollectionInfo memory info =
            marketplace.collections(address(nft));

        assertEq(info.royaltyReceiver, royaltyReceiverAddr);
        assertEq(info.royaltyFee, ROYALTY_FEE);
        assertTrue(info.exists);
    }

    function testRegisterCollection_RejectsNonCollectionOwner() public {
        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testCreateListing_UsesActualSeller() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        assertEq(marketplace.listings(address(nft), 1).seller, seller);
    }

    function testCreateListing_CannotSpoofSeller() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testCancelListing_UsesActualSeller() public {
        _setupListing();

        vm.prank(seller);
        marketplace.cancelListing(address(nft), 1);

        assertEq(marketplace.listings(address(nft), 1).price, 0);
    }

    function testCancelListing_CannotBeCalledByOtherUser() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        marketplace.cancelListing(address(nft), 1);
    }

    function testBuy_UsesActualBuyer() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }

    function testBuy_CannotCauseReceiverIssueForEOA() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }

    function testCollectionBid_UsesActualBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, 0
        );

        assertEq(
            marketplace.collectionBids(address(nft), bidder).bidder,
            bidder
        );
    }

    function testTokenBid_UsesActualBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(nft), 1, uint128(SALE_PRICE), 0
        );

        assertEq(
            marketplace.tokenBids(address(nft), 1, bidder).bidder,
            bidder
        );
    }

    function testAcceptCollectionBid_UsesActualSeller() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAcceptTokenBid_UsesActualSeller() public {
        _setupTokenBid();

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAdminFunctions_OnlyMarketplaceOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.pause();

        vm.prank(owner);
        marketplace.pause();

        assertTrue(marketplace.paused());

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(marketplace.paused());
    }

    function testComponentOwnersAreRouter() public {
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
    }

    function testRouterOwnershipIsIndependent() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.pendingOwner(), newOwner);

        vm.prank(newOwner);
        marketplace.acceptOwnership();

        assertEq(marketplace.owner(), newOwner);
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
    }

    function testPendingWithdrawalsAggregatesBothComponents() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        (uint256 coreAmount, uint256 bidsAmount) =
            marketplace.pendingWithdrawals(seller);

        assertGt(coreAmount, 0);
        assertEq(bidsAmount, 0);
    }

    function testWithdrawThroughRouter() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expected =
            SALE_PRICE
            - (SALE_PRICE * MARKETPLACE_FEE) / 10_000
            - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        uint256 before = seller.balance;

        vm.prank(seller);
        marketplace.withdraw();

        assertEq(seller.balance - before, expected);
    }

    function testEmergencyRoyaltyRecoveryThroughRouter() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);

        Marketplace.CollectionInfo memory info =
            marketplace.collections(address(nft));

        assertEq(info.royaltyReceiver, newOwner);
        assertEq(info.royaltyFee, 1000);
    }

    function testSweepExcessETH_OnlyOwner() public {
        vm.deal(address(core), 1 ether);

        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.sweepExcessETH(payable(owner));
    }
}
