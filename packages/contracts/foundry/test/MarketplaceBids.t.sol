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
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), bidder);
        assertEq(bid.bidder, bidder);
        assertEq(bid.pricePerItem, SALE_PRICE);
        assertEq(bid.quantity, 1);
    }

    function testPlaceCollectionBid_InsufficientETH() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.placeCollectionBid{value: uint128(SALE_PRICE - 1)}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testPlaceCollectionBid_InvalidPrice() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidPrice.selector);
        marketplace.placeCollectionBid{value: 0}(address(nft), 0, 1, 0);
    }

    function testPlaceCollectionBid_InvalidQuantity() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidQuantity.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 0, 0);
    }

    function testPlaceCollectionBid_UnregisteredCollection() public {
        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testPlaceCollectionBid_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp) + 1);

        vm.warp(block.timestamp + 2);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.BidExpired.selector);
        marketplace.cancelCollectionBid(address(nft));
    }

    function testPlaceCollectionBid_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testAcceptCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAcceptCollectionBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        _expectRevert(MarketplaceBids.NotBidder.selector);
        marketplace.acceptCollectionBid(address(nft), unauthorized, tokenIds);
    }

    function testAcceptCollectionBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        _expectRevert(MarketplaceBids.BidNotFound.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);
    }

    function testAcceptCollectionBid_InsufficientValue() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE - 1}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);
    }

    function testAcceptCollectionBid_ArrayLengthMismatch() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;

        _expectRevert(MarketplaceBids.ArrayLengthMismatch.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);
    }

    function testCancelCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        marketplace.cancelCollectionBid(address(nft));

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), bidder);
        assertEq(bid.bidder, address(0));
    }

    function testCancelCollectionBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        _expectRevert(MarketplaceBids.NotBidder.selector);
        marketplace.cancelCollectionBid(address(nft));
    }

    function testCancelCollectionBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        _expectRevert(MarketplaceBids.BidNotFound.selector);
        marketplace.cancelCollectionBid(address(nft));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.2 TOKEN BIDS
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        Marketplace.TokenBid memory bid = marketplace.tokenBids(address(nft), 1, bidder);
        assertEq(bid.bidder, bidder);
        assertEq(bid.price, SALE_PRICE);
    }

    function testPlaceTokenBid_InsufficientETH() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.placeTokenBid{value: SALE_PRICE - 1}(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testPlaceTokenBid_InvalidPrice() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InvalidPrice.selector);
        marketplace.placeTokenBid{value: 0}(address(nft), 1, 0, 0);
    }

    function testPlaceTokenBid_UnregisteredCollection() public {
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testPlaceTokenBid_WhenPaused() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testAcceptTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        marketplace.acceptTokenBid(address(nft), 1, bidder);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAcceptTokenBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        _expectRevert(MarketplaceBids.NotBidder.selector);
        marketplace.acceptTokenBid(address(nft), 1, unauthorized);
    }

    function testAcceptTokenBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        _expectRevert(MarketplaceBids.BidNotFound.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
    }

    function testAcceptTokenBid_InsufficientValue() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE - 1}(address(nft), 1, uint128(SALE_PRICE), 0);

        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
    }

    function testCancelTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        marketplace.cancelTokenBid(address(nft), 1);

        Marketplace.TokenBid memory bid = marketplace.tokenBids(address(nft), 1, bidder);
        assertEq(bid.bidder, address(0));
    }

    function testCancelTokenBid_NotBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        _expectRevert(MarketplaceBids.NotBidder.selector);
        marketplace.cancelTokenBid(address(nft), 1);
    }

    function testCancelTokenBid_BidNotFound() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        _expectRevert(MarketplaceBids.BidNotFound.selector);
        marketplace.cancelTokenBid(address(nft), 1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.3 FEES & ROYALTIES
    // ═══════════════════════════════════════════════════════════════════

    function testAcceptCollectionBid_FeeCalculation() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);

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
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        marketplace.acceptTokenBid(address(nft), 1, bidder);

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
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
    }

    function testAcceptTokenBid_RoyaltyReceiverGetsRoyalty() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        marketplace.acceptTokenBid(address(nft), 1, bidder);

        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
    }

    function testAcceptCollectionBid_SellerProceeds() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256 sellerBefore = seller.balance;

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);

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
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        uint256 sellerBefore = seller.balance;

        marketplace.acceptTokenBid(address(nft), 1, bidder);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.4 ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════

    function testPause_OnlyOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        marketplace.pause();
    }

    function testUnpause_OnlyOwner() public {
        vm.prank(unauthorized);
        _expectRevert(Ownable.OwnableUnauthorizedAccount.selector, unauthorized);
        marketplace.unpause();
    }

    function testTransferOwnership_ByOwner() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), newOwner);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.5 PAUSABILITY
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testPlaceTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testAcceptCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        vm.prank(owner);
        marketplace.pause();

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds);
    }

    function testAcceptTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(owner);
        marketplace.pause();

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
    }

    function testCancelCollectionBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        vm.prank(owner);
        marketplace.pause();

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.cancelCollectionBid(address(nft));
    }

    function testCancelTokenBid_WhenPaused_Reverts() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(owner);
        marketplace.pause();

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.cancelTokenBid(address(nft), 1);
    }

    function testPaused_TrueAfterPause() public {
        vm.prank(owner);
        marketplace.pause();

        assertTrue(marketplace.paused());
    }

    function testPaused_FalseAfterUnpause() public {
        vm.prank(owner);
        marketplace.pause();

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(marketplace.paused());
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4.6 EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function testPlaceCollectionBid_ReplacesExisting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE * 2}(address(nft), uint128(SALE_PRICE) * 2, 1, 0);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), bidder);
        assertEq(bid.bidder, bidder);
        assertEq(bid.pricePerItem, SALE_PRICE * 2);
    }

    function testPlaceTokenBid_ReplacesExisting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE * 2}(address(nft), 1, uint128(SALE_PRICE) * 2, 0);

        Marketplace.TokenBid memory bid = marketplace.tokenBids(address(nft), 1, bidder);
        assertEq(bid.bidder, bidder);
        assertEq(bid.price, SALE_PRICE * 2);
    }

    function testPlaceCollectionBid_SelfBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Self-bid should work (bidder == seller is not checked at placement)
        vm.prank(seller);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), seller);
        assertEq(bid.bidder, seller);
    }
}
