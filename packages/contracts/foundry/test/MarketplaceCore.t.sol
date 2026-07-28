// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceCoreTest is TestSetup {
    // ═══════════════════════════════════════════════════════════════════
    // 3.1 LISTING LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════

    function testCreateListing_ValidParams() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);

        (address s, uint128 price, , uint64 expiresAt) = core.listings(address(nft), 1);
        assertEq(s, seller);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, 0);
        assertEq(core.totalListings(), 1);
    }

    function testCreateListing_PriceBelowMin() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidPrice.selector);
        core.createListing(address(nft), 1, 0, 0, seller);
    }

    function testCreateListing_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 1, seller);
    }

    function testCreateListing_NoExpiry() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);

        (, , , uint64 expiresAt) = core.listings(address(nft), 1);
        assertEq(expiresAt, 0);
    }

    function testCreateListing_UnregisteredCollection() public {
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.CollectionNotRegistered.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testCreateListing_NotTokenOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, buyer);
    }

    function testCreateListing_NotApproved() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotApproved.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testCreateListing_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testCreateListing_Unauthorized() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testCreateListing_ReplaceExisting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
        assertEq(core.totalListings(), 1);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE) * 2, 0, seller);
        assertEq(core.totalListings(), 1);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, SALE_PRICE * 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.2 LISTING UPDATES & CANCELLATIONS
    // ═══════════════════════════════════════════════════════════════════

    function testUpdateListingPrice_Valid() public {
        _setupListing();

        vm.prank(owner);
        core.updateListingPrice(address(nft), 1, uint128(SALE_PRICE) * 2, seller);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, SALE_PRICE * 2);
    }

    function testUpdateListingPrice_NotSeller() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        core.updateListingPrice(address(nft), 1, uint128(SALE_PRICE) * 2, buyer);
    }

    function testUpdateListingPrice_NotTokenOwner() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        core.updateListingPrice(address(nft), 1, uint128(SALE_PRICE) * 2, buyer);
    }

    function testUpdateListingPrice_BelowMin() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidPrice.selector);
        core.updateListingPrice(address(nft), 1, 0, seller);
    }

    function testUpdateListingPrice_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        core.updateListingPrice(address(nft), 1, uint128(SALE_PRICE) * 2, seller);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, SALE_PRICE * 2);
    }

    function testCancelListing_Valid() public {
        _setupListing();

        vm.prank(owner);
        core.cancelListing(address(nft), 1, seller);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, 0);
        assertEq(core.totalListings(), 0);
    }

    function testCancelListing_NotSeller() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        core.cancelListing(address(nft), 1, buyer);
    }

    function testCancelListing_NotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.ListingNotFound.selector);
        core.cancelListing(address(nft), 1, seller);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.3 BUYING
    // ═══════════════════════════════════════════════════════════════════

    function testBuy_ExactETH() public {
        _setupListing();

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(feeReceiverAddr.balance - feeBefore, (SALE_PRICE * MARKETPLACE_FEE) / 10_000);
        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
        assertEq(core.totalVolume(), SALE_PRICE);
        assertEq(core.totalSales(), 1);
        assertEq(core.totalListings(), 0);
    }

    function testBuy_LessETH() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        core.buy{value: SALE_PRICE - 1}(address(nft), 1, buyer);
    }

    function testBuy_MoreETH() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        core.buy{value: SALE_PRICE + 1}(address(nft), 1, buyer);
    }

    function testBuy_ListingNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.ListingNotFound.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testBuy_ListingExpired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), uint64(block.timestamp) + 1, seller);

        vm.warp(block.timestamp + 2);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testBuy_SelfPurchase() public {
        _setupListing();

        vm.prank(owner);
        _expectRevert(MarketplaceCore.SelfPurchase.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, seller);
    }

    function testBuy_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testBuy_Unauthorized() public {
        _setupListing();

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testBuy_FeeCalculation() public {
        _setupListing();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(feeReceiverAddr.balance - feeBefore, expectedFee);
        assertEq(seller.balance - sellerBefore, expectedSeller);
        assertEq(royaltyReceiverAddr.balance - royaltyBefore, expectedRoyalty);
    }

    function testBuy_SellerProceeds() public {
        _setupListing();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        uint256 sellerBefore = seller.balance;

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function testBuy_TotalVolumeUpdated() public {
        _setupListing();

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(core.totalVolume(), SALE_PRICE);
    }

    function testBuy_TotalSalesIncremented() public {
        _setupListing();

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(core.totalSales(), 1);
    }

    function testBuy_CollectionStatsUpdated() public {
        _setupListing();

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        (uint256 colVol, uint32 colSales, , bool exists) = core.getCollectionStats(address(nft));
        assertEq(colVol, SALE_PRICE);
        assertEq(colSales, 1);
        assertTrue(exists);
    }

    function testBuy_ListingDeleted() public {
        _setupListing();

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        (, uint128 price, , ) = core.listings(address(nft), 1);
        assertEq(price, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.4 FEES & ROYALTIES
    // ═══════════════════════════════════════════════════════════════════

    function testRegisterCollection_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (address rr, uint16 rf, , , , bool exists) = core.collections(address(nft));
        assertEq(rr, royaltyReceiverAddr);
        assertEq(rf, ROYALTY_FEE);
        assertTrue(exists);
    }

    function testRegisterCollection_FeeTooHigh() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.FeeTooHigh.selector);
        core.registerCollection(address(nft), 2_001, royaltyReceiverAddr);
    }

    function testRegisterCollection_AddressZero() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        core.registerCollection(address(0), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testRegisterCollection_NonERC721() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        core.registerCollection(address(nonERC721), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testRegisterCollection_AlreadyRegistered() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.CollectionAlreadyRegistered.selector);
        core.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testUpdateCollectionRoyalty_NotCollectionOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        core.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, uint16(ROYALTY_FEE), buyer);
    }

    function testUpdateCollectionRoyalty_FeeTooHigh() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.FeeTooHigh.selector);
        core.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, uint16(2_001), owner);
    }

    function testUpdateCollectionRoyalty_Unregistered() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.CollectionNotRegistered.selector);
        core.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, uint16(ROYALTY_FEE), owner);
    }

    function testUpdateCollectionRoyalty_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        core.updateCollectionRoyalty(address(nft), newOwner, uint16(1_000), owner);

        (address rr, uint16 rf, , , , ) = core.collections(address(nft));
        assertEq(rr, newOwner);
        assertEq(rf, 1_000);
    }

    function testBuy_CollectionLevelRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, expectedRoyalty);
    }

    function testBuy_RoyaltyReceiverGetsRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.prank(owner);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, expectedRoyalty);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.5 ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════

    function testVerifyCollection_NonOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.verifyCollection(address(nft));
    }

    function testUpdateMarketplaceFee_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.updateMarketplaceFee(100);
    }

    function testUpdateFeeReceiver_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.updateFeeReceiver(newOwner);
    }

    function testSetAuthorizedContract_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.setAuthorizedContract(unauthorized, true);
    }

    function testPause_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.pause();
    }

    function testUnpause_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        core.unpause();
    }

    function testCreateListing_NonAuthorised() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testBuy_NonAuthorised() public {
        _setupListing();

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testRegisterCollection_NonAuthorised() public {
        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testExecuteSaleFromBid_NonAuthorised() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(address(nft), 1, seller, buyer, uint128(SALE_PRICE));
    }

    function testTransferOwnership_ByOwner() public {
        vm.prank(owner);
        core.transferOwnership(newOwner);

        assertEq(core.owner(), newOwner);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.6 PAUSABILITY
    // ═══════════════════════════════════════════════════════════════════

    function testCreateListing_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testBuy_WhenPaused_Reverts() public {
        _setupListing();

        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testCreateListingBatch_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.pause();

        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;
        uint128[] memory prices = new uint128[](1);
        prices[0] = uint128(SALE_PRICE);
        uint64[] memory expiresAts = new uint64[](1);
        expiresAts[0] = 0;

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.createListingBatch(collections, tokenIds, prices, expiresAts, seller);
    }

    function testBuyBatch_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        core.pause();

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.prank(owner);
        _expectRevert(Pausable.EnforcedPause.selector);
        core.buyBatch{value: SALE_PRICE}(address(nft), tokenIds, buyer);
    }

    function testPaused_TrueAfterPause() public {
        vm.prank(owner);
        core.pause();

        assertTrue(core.paused());
    }

    function testPaused_FalseAfterUnpause() public {
        vm.prank(owner);
        core.pause();

        vm.prank(owner);
        core.unpause();

        assertFalse(core.paused());
    }

    // ═══════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function _setupListing() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }
}
