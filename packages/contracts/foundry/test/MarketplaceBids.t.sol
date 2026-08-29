// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract MarketplaceBidsTest is TestSetup {
    function testPlaceCollectionBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), bidder);

        assertEq(bid.bidder, bidder);
        assertEq(bid.pricePerItem, SALE_PRICE);
        assertEq(bid.quantity, 1);
    }

    function testPlaceCollectionBid_InsufficientValue() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE - 1}(address(nft), uint128(SALE_PRICE), 1, 0);
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

    function testPlaceCollectionBid_Unregistered() public {
        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testPlaceCollectionBid_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.warp(block.timestamp + 2);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.BidExpired.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp - 1));
    }

    function testCancelCollectionBid_Valid_CreatesWithdrawalCredit() public {
        _setupCollectionBid();

        vm.prank(bidder);
        marketplace.cancelCollectionBid(address(nft));

        (address bidder_, , , ) = bids.collectionBids(address(nft), bidder);

        assertEq(bidder_, address(0));
        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testCancelCollectionBid_AllowsExpiredBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp + 1));

        vm.warp(block.timestamp + 2);

        vm.prank(bidder);
        marketplace.cancelCollectionBid(address(nft));

        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testAcceptCollectionBid_Valid() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);
        (, , uint32 quantity, ) = bids.collectionBids(address(nft), bidder);

        assertEq(nft.ownerOf(1), bidder);
        assertEq(core.totalSales(), 1);
        assertEq(quantity, 0);
        assertGt(bids.pendingWithdrawals(seller), 0);
        assertGt(bids.pendingWithdrawals(feeReceiverAddr), 0);
        assertGt(bids.pendingWithdrawals(royaltyReceiverAddr), 0);
    }

    function testAcceptCollectionBid_PartialKeepsRemainingQuantity() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: 2 ether}(address(nft), uint128(1 ether), 2, 0);

        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);

        Marketplace.CollectionBid memory bid = marketplace.collectionBids(address(nft), bidder);

        assertEq(bid.quantity, 1);
        assertEq(bid.pricePerItem, 1 ether);
    }

    function testAcceptCollectionBid_NotOwner() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(buyer);
        _expectRevert(MarketplaceBids.NotApproved.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);
    }

    function testAcceptCollectionBid_NotApproved() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        _expectRevert(MarketplaceBids.NotApproved.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);
    }

    function testPlaceTokenBid_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        assertEq(marketplace.tokenBids(address(nft), 1, bidder).bidder, bidder);
    }

    function testPlaceTokenBid_ReplacesAndCreditsOldBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.startPrank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        marketplace.placeTokenBid{value: 2 ether}(address(nft), 1, uint128(2 ether), 0);
        vm.stopPrank();

        assertEq(marketplace.tokenBids(address(nft), 1, bidder).price, 2 ether);
        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testPlaceTokenBidBatch_RejectsDuplicateTokenIds() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        uint256[] memory ids = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);

        ids[0] = 1;
        ids[1] = 1;
        prices[0] = 1 ether;
        prices[1] = 1 ether;

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.DuplicateTokenId.selector);
        marketplace.placeTokenBidBatch{value: 2 ether}(address(nft), ids, prices, expiries);
    }

    function testPlaceTokenBidBatch_NetReplacementAccounting() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: 1 ether}(address(nft), 1, 1 ether, 0);

        uint256[] memory ids = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);

        ids[0] = 1;
        ids[1] = 2;
        prices[0] = 2 ether;
        prices[1] = 1 ether;

        vm.prank(bidder);
        marketplace.placeTokenBidBatch{value: 2 ether}(address(nft), ids, prices, expiries);

        assertEq(bids.pendingWithdrawals(bidder), 1 ether);
        assertEq(marketplace.tokenBids(address(nft), 1, bidder).price, 2 ether);
        assertEq(marketplace.tokenBids(address(nft), 2, bidder).price, 1 ether);
    }

    function testAcceptTokenBid_Valid() public {
        _setupTokenBid();

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
        (, uint128 price_, ) = bids.tokenBids(address(nft), 1, bidder);

        assertEq(nft.ownerOf(1), bidder);
        assertEq(core.totalSales(), 1);
        assertEq(price_, 0);
    }

    function testAcceptTokenBid_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), uint64(block.timestamp + 1));

        vm.warp(block.timestamp + 2);

        vm.prank(seller);
        _expectRevert(MarketplaceBids.BidExpired.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
    }

    function testAcceptTokenBid_NotApproved() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(seller);
        _expectRevert(MarketplaceBids.NotApproved.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder);
    }

    function testCancelTokenBid_Valid_CreatesWithdrawalCredit() public {
        _setupTokenBid();

        vm.prank(bidder);
        marketplace.cancelTokenBid(address(nft), 1);

        assertEq(marketplace.tokenBids(address(nft), 1, bidder).price, 0);
        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testCancelTokenBidBatch_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        uint256[] memory ids = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);

        ids[0] = 1;
        ids[1] = 2;
        prices[0] = 1 ether;
        prices[1] = 2 ether;

        vm.prank(bidder);
        marketplace.placeTokenBidBatch{value: 3 ether}(address(nft), ids, prices, expiries);

        address[] memory collections_ = new address[](2);
        collections_[0] = address(nft);
        collections_[1] = address(nft);

        vm.prank(bidder);
        marketplace.cancelTokenBidBatch(collections_, ids);

        assertEq(bids.pendingWithdrawals(bidder), 3 ether);
        assertEq(marketplace.tokenBids(address(nft), 1, bidder).price, 0);
        assertEq(marketplace.tokenBids(address(nft), 2, bidder).price, 0);
    }

    function testWithdraw_BidRefund() public {
        _setupTokenBid();

        vm.prank(bidder);
        marketplace.cancelTokenBid(address(nft), 1);

        uint256 before = bidder.balance;

        vm.prank(bidder);
        marketplace.withdraw();

        assertEq(bidder.balance - before, SALE_PRICE);
        assertEq(bids.pendingWithdrawals(bidder), 0);
    }

    function testPauseBlocksNewBids() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);
    }

    function testCancelBidStillWorksWhilePaused() public {
        _setupTokenBid();

        vm.prank(owner);
        marketplace.pause();

        vm.prank(bidder);
        marketplace.cancelTokenBid(address(nft), 1);

        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testOnlyRouterCanCallBidsDirectly() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceBids.OnlyMarketplace.selector);
        bids.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0, bidder);
    }

    function testBidsOwnershipArchitecture() public {
        assertEq(bids.owner(), address(marketplace));
        assertEq(bids.pendingOwner(), address(0));
        assertEq(bids.marketplace(), address(marketplace));
    }
}
