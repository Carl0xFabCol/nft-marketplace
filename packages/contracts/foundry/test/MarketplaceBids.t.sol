// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceBidsTest is TestSetup {
    // ═══════════════════════════════════════════════════════════════════
    // 4.1 COLLECTION BIDS
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        (address bidder_, uint128 price, uint32 qty, ) = bids.collectionBids(address(nft), bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE);
        assertEq(qty, 1);
    }

    function testPlaceCollectionBid_InsufficientETH() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        bids.placeCollectionBid{value: uint128(SALE_PRICE - 1)}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testPlaceCollectionBid_InvalidPrice() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidPrice.selector);
        bids.placeCollectionBid{value: 0}(address(nft), 0, 1, 0, bidder);
    }

    function testPlaceCollectionBid_InvalidQuantity() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidQuantity.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 0, 0, bidder);
    }

    function testPlaceCollectionBid_UnregisteredCollection() public {
        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testPlaceCollectionBid_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp) + 1, bidder);

        vm.warp(block.timestamp + 2);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.BidExpired.selector);
        bids.cancelCollectionBid(address(nft), bidder);
    }

    function testPlaceCollectionBid_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        bids.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testPlaceCollectionBid_CorePaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        core.pause();

        vm.prank(bidder);
        vm.expectRevert("Core paused");
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testPlaceCollectionBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testAcceptCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);

        assertEq(nft.ownerOf(1), bidder);
        vm.stopPrank();
    }

    function testAcceptCollectionBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.NotBidder.selector);
        bids.acceptCollectionBid(address(nft), unauthorized, tokenIds, seller);
        vm.stopPrank();
    }

    function testAcceptCollectionBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.BidNotFound.selector);
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);
        vm.stopPrank();
    }

    function testAcceptCollectionBid_InsufficientValue() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE - 1}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);
        vm.stopPrank();
    }

    function testAcceptCollectionBid_ArrayLengthMismatch() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.ArrayLengthMismatch.selector);
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);
        vm.stopPrank();
    }

    function testCancelCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.startPrank(address(marketplace));
        bids.cancelCollectionBid(address(nft), bidder);
        vm.stopPrank();

        (address bidder_, , , ) = bids.collectionBids(address(nft), bidder);
        assertEq(bidder_, address(0));
    }

    function testCancelCollectionBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.NotBidder.selector);
        bids.cancelCollectionBid(address(nft), unauthorized);
        vm.stopPrank();
    }

    function testCancelCollectionBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.BidNotFound.selector);
        bids.cancelCollectionBid(address(nft), bidder);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.2 TOKEN BIDS
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        (address bidder_, uint128 price, ) = bids.tokenBids(address(nft), 1, bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE);
    }

    function testPlaceTokenBid_InsufficientETH() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        bids.placeTokenBid{value: SALE_PRICE - 1}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);
    }

    function testPlaceTokenBid_InvalidPrice() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidPrice.selector);
        bids.placeTokenBid{value: 0}(address(nft), 1, 0, 0, bidder);
    }

    function testPlaceTokenBid_UnregisteredCollection() public {
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);
    }

    function testPlaceTokenBid_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        bids.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);
    }

    function testPlaceTokenBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);
    }

    function testAcceptTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.startPrank(address(marketplace));
        bids.acceptTokenBid(address(nft), 1, bidder, seller);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAcceptTokenBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.NotBidder.selector);
        bids.acceptTokenBid(address(nft), 1, unauthorized, seller);
        vm.stopPrank();
    }

    function testAcceptTokenBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.BidNotFound.selector);
        bids.acceptTokenBid(address(nft), 1, bidder, seller);
        vm.stopPrank();
    }

    function testAcceptTokenBid_InsufficientValue() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE - 1}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        bids.acceptTokenBid(address(nft), 1, bidder, seller);
    }

    function testCancelTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.startPrank(address(marketplace));
        bids.cancelTokenBid(address(nft), 1, bidder);

        (address bidder_, , ) = bids.tokenBids(address(nft), 1, bidder);
        assertEq(bidder_, address(0));
    }

    function testCancelTokenBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.NotBidder.selector);
        bids.cancelTokenBid(address(nft), 1, unauthorized);
    }

    function testCancelTokenBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.startPrank(address(marketplace));
        _expectRevert(MarketplaceBids.BidNotFound.selector);
        bids.cancelTokenBid(address(nft), 1, bidder);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.3 FEES & ROYALTIES
    // ═══════════════════════════════════════════════════════════════════

    function testAcceptCollectionBid_FeeCalculation() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(feeReceiverAddr.balance - feeBefore, expectedFee);
        assertEq(royaltyReceiverAddr.balance - royaltyBefore, expectedRoyalty);
        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function testAcceptTokenBid_FeeCalculation() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.startPrank(address(marketplace));
        bids.acceptTokenBid(address(nft), 1, bidder, seller);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(feeReceiverAddr.balance - feeBefore, expectedFee);
        assertEq(royaltyReceiverAddr.balance - royaltyBefore, expectedRoyalty);
        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function testAcceptCollectionBid_RoyaltyReceiverGetsRoyalty() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
    }

    function testAcceptTokenBid_RoyaltyReceiverGetsRoyalty() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        vm.startPrank(address(marketplace));
        bids.acceptTokenBid(address(nft), 1, bidder, seller);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
    }

    function testAcceptCollectionBid_SellerProceeds() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256 sellerBefore = seller.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function testAcceptTokenBid_SellerProceeds() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        uint256 sellerBefore = seller.balance;

        vm.startPrank(address(marketplace));
        bids.acceptTokenBid(address(nft), 1, bidder, seller);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.4 ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════

    function testAcceptCollectionBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);
    }

    function testAcceptTokenBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.acceptTokenBid(address(nft), 1, bidder, seller);
    }

    function testCancelCollectionBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.cancelCollectionBid(address(nft), bidder);
    }

    function testCancelTokenBid_OnlyMarketplace() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.cancelTokenBid(address(nft), 1, bidder);
    }

    function testPause_OnlyOwner() public {
        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyOwner.selector);
        bids.pause();
    }

    function testUnpause_OnlyOwner() public {
        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyOwner.selector);
        bids.unpause();
    }

    function testTransferOwnership_ByOwner() public {
        vm.prank(owner);
        bids.transferOwnership(newOwner);

        assertEq(bids.owner(), newOwner);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.5 PAUSABILITY
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        bids.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testPlaceTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        bids.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);
    }

    function testAcceptCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.prank(owner);
        bids.pause();

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.startPrank(address(marketplace));
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.acceptCollectionBid(address(nft), bidder, tokenIds, seller);
    }

    function testAcceptTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.prank(owner);
        bids.pause();

        vm.startPrank(address(marketplace));
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.acceptTokenBid(address(nft), 1, bidder, seller);
    }

    function testCancelCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.prank(owner);
        bids.pause();

        vm.startPrank(address(marketplace));
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.cancelCollectionBid(address(nft), bidder);
    }

    function testCancelTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.prank(owner);
        bids.pause();

        vm.startPrank(address(marketplace));
        _expectRevert(Pausable.EnforcedPause.selector);
        bids.cancelTokenBid(address(nft), 1, bidder);
    }

    function testPaused_TrueAfterPause() public {
        vm.prank(owner);
        bids.pause();

        assertTrue(bids.paused());
    }

    function testPaused_FalseAfterUnpause() public {
        vm.prank(owner);
        bids.pause();

        vm.prank(owner);
        bids.unpause();

        assertFalse(bids.paused());
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.6 EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_ReplacesExisting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);

        vm.prank(bidder);
        bids.placeCollectionBid{value: SALE_PRICE * 2}(address(nft), uint128(SALE_PRICE) * 2, 1, 0, bidder);

        (address bidder_, uint128 price, , ) = bids.collectionBids(address(nft), bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE * 2);
    }

    function testPlaceTokenBid_ReplacesExisting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0, bidder);

        vm.prank(bidder);
        bids.placeTokenBid{value: SALE_PRICE * 2}(address(nft), 1, uint128(SALE_PRICE) * 2, 0, bidder);

        (address bidder_, uint128 price, ) = bids.tokenBids(address(nft), 1, bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE * 2);
    }

    function testPlaceCollectionBid_SelfBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Self-bid should work (bidder == seller is not checked at placement)
        vm.prank(seller);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, seller);

        (address bidder_, , , ) = bids.collectionBids(address(nft), seller);
        assertEq(bidder_, seller);
    }
}
