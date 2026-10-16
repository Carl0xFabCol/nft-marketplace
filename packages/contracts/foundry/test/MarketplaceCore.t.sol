// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceCoreTest is TestSetup {
    function testCreateListing_Valid() public {
        _setupListing();

        (address s, uint128 price, , uint64 expiresAt) =
            core.listings(address(nft), 1);

        assertEq(s, seller);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, 0);
        assertEq(core.totalListings(), 1);
    }

    function testCreateListing_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 1);
    }

    function testCreateListing_PriceBelowMin() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.InvalidPrice.selector);
        marketplace.createListing(address(nft), 1, 0, 0);
    }

    function testCreateListing_Unregistered() public {
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.CollectionNotRegistered.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testCreateListing_NotOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testCreateListing_NotApproved() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testCreateListing_ReplacesExisting() public {
        _setupListing();

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(2 ether), 0);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, 2 ether);
        assertEq(core.totalListings(), 1);
    }

    function testUpdateListingPrice_Valid() public {
        _setupListing();

        vm.prank(seller);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, 2 ether);
    }

    function testUpdateListingPrice_NotSeller() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));
    }

    function testUpdateListingPrice_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        marketplace.pause();

        vm.prank(seller);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));
    }

    function testCancelListing_Valid() public {
        _setupListing();

        vm.prank(seller);
        marketplace.cancelListing(address(nft), 1);

        (address s, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(s, address(0));
        assertEq(price, 0);
        assertEq(core.totalListings(), 0);
    }

    function testCancelListing_NotSeller() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        marketplace.cancelListing(address(nft), 1);
    }

    function testCancelListing_UnauthorizedDirectCore() public {
        _setupListing();

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.cancelListing(address(nft), 1, seller);
    }

    function testBuy_Valid_CreditsPullPayments() public {
        _setupListing();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.pendingWithdrawals(seller), expectedSeller);
        assertEq(core.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
        assertEq(core.totalSales(), 1);
        assertEq(core.totalVolume(), SALE_PRICE);
        assertEq(core.totalListings(), 0);
    }

    function testBuy_RequiresExactETH() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE - 1}(address(nft), 1);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE + 1}(address(nft), 1);
    }

    function testBuy_SelfPurchase() public {
        _setupListing();

        vm.prank(seller);
        _expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuy_ListingExpired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(
            address(nft), 1, uint128(SALE_PRICE), uint64(block.timestamp + 1)
        );

        vm.warp(block.timestamp + 2);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuy_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        marketplace.pause();

        vm.prank(buyer);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuyBatch_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _mintNFT(seller, 2);
        _approveOnCore(address(nft), seller);

        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
        marketplace.createListing(address(nft), 2, uint128(2 ether), 0);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.prank(buyer);
        marketplace.buyBatch{value: 3 ether}(address(nft), ids);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(core.totalSales(), 2);
        assertEq(core.totalVolume(), 3 ether);
        assertEq(core.totalListings(), 0);
    }

    function testExecuteSaleFromBid_NonAuthorized() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(
            address(nft), 1, seller, buyer, uint128(SALE_PRICE)
        );
    }

    function testRegisterCollection_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (address receiver, uint16 fee, , , , bool exists) =
            core.collections(address(nft));

        assertEq(receiver, royaltyReceiverAddr);
        assertEq(fee, ROYALTY_FEE);
        assertTrue(exists);
    }

    function testRegisterCollection_NonAdminReverts() public {
        vm.prank(buyer);
        _expectOwnableUnauthorized(buyer);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testRegisterCollection_ExternalCreatorAutoFilled() public {
        vm.prank(owner);
        vm.expectEmit(false, true, false, false);
        emit MarketplaceCore.CollectionRegistered(address(0), owner, uint16(ROYALTY_FEE), false);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (, , , , , bool exists) = core.collections(address(nft));
        assertTrue(exists);
    }

    function testSetAuthorizedLaunchpad_AdminOnly() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(0xBEEF), true);
        assertTrue(core.authorizedLaunchpads(address(0xBEEF)));

        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.setAuthorizedLaunchpad(address(0xBEEF), false);
    }

    function testRegisterCollection_NonERC721() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        marketplace.registerCollection(address(nonERC721), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testRegisterCollection_AlreadyRegistered() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.CollectionAlreadyRegistered.selector);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testUpdateCollectionRoyalty_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), newOwner, 1000);

        (address receiver, uint16 fee, , , , ) = core.collections(address(nft));
        assertEq(receiver, newOwner);
        assertEq(fee, 1000);
    }

    function testUpdateCollectionRoyalty_NonOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        marketplace.updateCollectionRoyalty(address(nft), newOwner, 1000);
    }

    function testEmergencyUpdateCollectionRoyalty_Admin() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);

        (address receiver, uint16 fee, , , , ) = core.collections(address(nft));
        assertEq(receiver, newOwner);
        assertEq(fee, 1000);
    }

    function testEmergencyUpdateCollectionRoyalty_NonOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);
    }

    function testVerifyCollection_AdminOnly() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.verifyCollection(address(nft));

        (, , , , bool verified, ) = core.collections(address(nft));
        assertTrue(verified);
    }

    function testVerifyCollection_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.verifyCollection(address(nft));
    }

    function testUpdateMarketplaceFee_AdminOnly() public {
        vm.prank(owner);
        marketplace.updateMarketplaceFee(100);

        assertEq(core.marketplaceFee(), 100);
    }

    function testUpdateMarketplaceFee_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.updateMarketplaceFee(100);
    }

    function testUpdateFeeReceiver_AdminOnly() public {
        vm.prank(owner);
        marketplace.updateFeeReceiver(newOwner);

        assertEq(core.feeReceiver(), newOwner);
    }

    function testUpdateFeeReceiver_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.updateFeeReceiver(newOwner);
    }

    function testPauseAndUnpause_Admin() public {
        vm.prank(owner);
        marketplace.pause();

        assertTrue(core.paused());
        assertTrue(bids.paused());

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(core.paused());
        assertFalse(bids.paused());
    }

    function testPause_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.pause();
    }

    function testOwnershipArchitecture() public {
        assertEq(marketplace.owner(), owner);
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
        assertEq(core.pendingOwner(), address(0));
        assertEq(bids.pendingOwner(), address(0));
        assertTrue(core.authorizedContracts(address(marketplace)));
        assertTrue(core.authorizedContracts(address(bids)));
    }

    function testMarketplaceOwnership_RequiresAcceptance() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.pendingOwner(), newOwner);

        vm.prank(newOwner);
        marketplace.acceptOwnership();

        assertEq(marketplace.owner(), newOwner);
    }

    function testWithdraw_SellerProceeds() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller =
            SALE_PRICE
            - (SALE_PRICE * MARKETPLACE_FEE) / 10_000
            - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);

        uint256 before = seller.balance;

        vm.prank(seller);
        marketplace.withdraw();

        assertEq(seller.balance - before, expectedSeller);
        assertEq(core.pendingWithdrawals(seller), 0);
    }

    function testWithdraw_NoWithdrawal() public {
        vm.prank(seller);
        _expectRevert(MarketplaceCore.NoWithdrawal.selector);
        core.withdraw();
    }

    function testSweepExcessETH_CannotTouchPending() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 pending = core.totalPendingWithdrawals();
        assertEq(address(core).balance, pending);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InsufficientExcess.selector);
        marketplace.sweepExcessETH(payable(owner));
    }

    function testSweepExcessETH_RecoversAccidentalETH() public {
        // Marketplace.sweepExcessETH delegates to both components, and both
        // components require actual excess ETH to sweep successfully.
        vm.deal(address(core), 1 ether);
        vm.deal(address(bids), 1 ether);

        uint256 before = owner.balance;

        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 2 ether);
        assertEq(address(core).balance, 0);
        assertEq(address(bids).balance, 0);
    }
}
