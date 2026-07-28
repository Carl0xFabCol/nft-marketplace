// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceTest is TestSetup {
    // ═══════════════════════════════════════════════════════════════════
    // 5.1 CONSTRUCTOR & DEPLOYMENT
    // ═══════════════════════════════════════════════════════════════════

    function testConstructor_DeploysCorrectly() public {
        assertEq(address(marketplace.core()), address(core));
        assertEq(address(marketplace.bids()), address(bids));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.2 VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testGetMarketplaceFee() public {
        assertEq(marketplace.marketplaceFee(), uint16(MARKETPLACE_FEE));
    }

    function testGetFeeReceiver() public {
        assertEq(marketplace.feeReceiver(), feeReceiverAddr);
    }

    function testVerifyCollection_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // verifyCollection is a setter (onlyOwner); check isVerified via collections mapping
        vm.prank(owner);
        marketplace.verifyCollection(address(nft));

        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertTrue(info.isVerified);
    }

    function testVerifyCollection_Invalid() public {
        // Unregistered collection should not be verified
        Marketplace.CollectionInfo memory info = marketplace.collections(address(nonERC721));
        assertFalse(info.isVerified);
    }

    function testVerifyCollection_Unregistered() public {
        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertFalse(info.isVerified);
    }

    function testGetCollectionInfo_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertEq(info.royaltyReceiver, royaltyReceiverAddr);
        assertEq(info.royaltyFee, uint16(ROYALTY_FEE));
        assertTrue(info.exists);
    }

    function testGetCollectionInfo_Unregistered() public {
        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertEq(info.royaltyReceiver, address(0));
        assertEq(info.royaltyFee, 0);
        assertFalse(info.exists);
    }

    function testGetListing_Valid() public {
        _setupListing();

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.seller, seller);
        assertEq(listing.price, uint128(SALE_PRICE));
    }

    function testGetListing_NotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.seller, address(0));
        assertEq(listing.price, 0);
    }

    function testGetCollectionStats_Valid() public {
        _setupListing();

        (uint256 vol, uint32 sales, bool isVerified, bool exists) = marketplace.getCollectionStats(address(nft));
        assertEq(vol, 0);
        assertEq(sales, 0);
        assertTrue(exists);
    }

    function testGetCollectionStats_Unregistered() public {
        (uint256 vol, uint32 sales, bool isVerified, bool exists) = marketplace.getCollectionStats(address(nft));
        assertEq(vol, 0);
        assertEq(sales, 0);
        assertFalse(exists);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.3 LISTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testCreateListing_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.seller, seller);
        assertEq(listing.price, uint128(SALE_PRICE));
    }

    function testCreateListing_PriceBelowMin() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        _expectRevert(MarketplaceCore.InvalidPrice.selector);
        marketplace.createListing(address(nft), 1, 0, 0);
    }

    function testCreateListing_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        core.pause();

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testUpdateListingPrice_Valid() public {
        _setupListing();

        marketplace.updateListingPrice(address(nft), 1, uint128(SALE_PRICE * 2));

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.price, uint128(SALE_PRICE * 2));
    }

    function testCancelListing_Valid() public {
        _setupListing();

        marketplace.cancelListing(address(nft), 1);

        Marketplace.Listing memory listing = marketplace.listings(address(nft), 1);
        assertEq(listing.price, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.4 BUYING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testBuy_Valid() public {
        _setupListing();

        uint256 sellerBefore = seller.balance;

        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
        assertTrue(seller.balance > sellerBefore);
    }

    function testBuy_InsufficientETH() public {
        _setupListing();

        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE - 1}(address(nft), 1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.5 COLLECTION BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), buyer);
        assertEq(bid.bidder, buyer);
    }

    function testCancelCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        marketplace.cancelCollectionBid(address(nft));

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), buyer);
        assertEq(bid.bidder, address(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.6 TOKEN BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        Marketplace.TokenBid memory bid = marketplace.tokenBids(address(nft), 1, buyer);
        assertEq(bid.bidder, buyer);
    }

    function testCancelTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        marketplace.cancelTokenBid(address(nft), 1);

        Marketplace.TokenBid memory bid = marketplace.tokenBids(address(nft), 1, buyer);
        assertEq(bid.bidder, address(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.7 COLLECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    function testRegisterCollection_Valid() public {
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertEq(info.royaltyReceiver, royaltyReceiverAddr);
        assertEq(info.royaltyFee, uint16(ROYALTY_FEE));
        assertTrue(info.exists);
    }

    function testRegisterCollection_NonERC721() public {
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        marketplace.registerCollection(address(nonERC721), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testUpdateCollectionRoyalty_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        marketplace.updateCollectionRoyalty(address(nft), newOwner, 1_000);

        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));
        assertEq(info.royaltyReceiver, newOwner);
        assertEq(info.royaltyFee, 1_000);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5.8 ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function testUpdateMarketplaceFee_Valid() public {
        vm.prank(owner);
        marketplace.updateMarketplaceFee(100);

        assertEq(marketplace.marketplaceFee(), 100);
    }

    function testUpdateMarketplaceFee_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        marketplace.updateMarketplaceFee(100);
    }

    function testUpdateFeeReceiver_Valid() public {
        vm.prank(owner);
        marketplace.updateFeeReceiver(newOwner);

        assertEq(marketplace.feeReceiver(), newOwner);
    }

    function testUpdateFeeReceiver_NonOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        marketplace.updateFeeReceiver(newOwner);
    }

    function testTransferOwnership_ByOwner() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), newOwner);
    }

    function testPause_ByOwner() public {
        vm.prank(owner);
        marketplace.pause();

        assertTrue(core.paused());
    }

    function testUnpause_ByOwner() public {
        vm.prank(owner);
        marketplace.pause();

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(core.paused());
    }

    // ═══════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function _setupListing() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }
}
