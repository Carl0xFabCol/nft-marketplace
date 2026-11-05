// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";
import "./MockNFT.t.sol";
import "./MockNFTWithRoyalty.sol";
import "./MockNFTNonERC721.sol";
import "./MockRevertingNFT.sol";
import "./MockRevertingRoyaltyNFT.sol";
import "./MockMalformedReturn.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {LaunchPad, IMarketplaceCoreRegistry} from "../src/LaunchPad.sol";
import {Hyperc as MiColeccion} from "../src/MERC721.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {BoundedStaticCall} from "../src/BoundedStaticCall.sol";
import {VerifyDeployment} from "../script/VerifyDeployment.s.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

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
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp - 1)
        );
    }

    function testCancelCollectionBid_Valid_CreatesWithdrawalCredit() public {
        _setupCollectionBid();

        vm.prank(bidder);
        marketplace.cancelCollectionBid(address(nft));

        (address bidder_,,,) = bids.collectionBids(address(nft), bidder);

        assertEq(bidder_, address(0));
        assertEq(bids.pendingWithdrawals(bidder), SALE_PRICE);
    }

    function testCancelCollectionBid_AllowsExpiredBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, uint64(block.timestamp + 1)
        );

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
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);
        (,, uint32 quantity,) = bids.collectionBids(address(nft), bidder);

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
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);

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
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);
    }

    function testAcceptCollectionBid_NotApproved() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        _expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);
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

    function testPlaceTokenBidBatch_FullReplacementAccounting() public {
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
        marketplace.placeTokenBidBatch{value: 3 ether}(address(nft), ids, prices, expiries);

        assertEq(bids.pendingWithdrawals(bidder), 1 ether);
        assertEq(marketplace.tokenBids(address(nft), 1, bidder).price, 2 ether);
        assertEq(marketplace.tokenBids(address(nft), 2, bidder).price, 1 ether);
    }

    function testAcceptTokenBid_Valid() public {
        _setupTokenBid();

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);
        (, uint128 price_,) = bids.tokenBids(address(nft), 1, bidder);

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
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);
    }

    function testAcceptTokenBid_NotApproved() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);
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

    function testC01_PlaceTokenBidBatchRequiresFullValueOnReplacement() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: 1 ether}(address(nft), 1, 1 ether, 0);

        uint256[] memory ids = new uint256[](1);
        uint128[] memory prices = new uint128[](1);
        uint64[] memory expiries = new uint64[](1);
        ids[0] = 1;
        prices[0] = 1 ether;

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.InsufficientValue.selector);
        marketplace.placeTokenBidBatch{value: 0}(address(nft), ids, prices, expiries);
    }

    function testCollectionBid_UsesActualBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        assertEq(marketplace.collectionBids(address(nft), bidder).bidder, bidder);
    }

    function testTokenBid_UsesActualBidder() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        assertEq(marketplace.tokenBids(address(nft), 1, bidder).bidder, bidder);
    }

    function testAcceptCollectionBid_UsesActualSeller() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testAcceptTokenBid_UsesActualSeller() public {
        _setupTokenBid();

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testL04_TokenBidExpiresAtExactTimestamp() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint64 expiry = uint64(block.timestamp + 1);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), expiry);

        vm.warp(expiry);

        vm.prank(seller);
        _expectRevert(MarketplaceBids.BidExpired.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);
    }

    function testBidsStillAllowZeroExpiry() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        (address bidder_, uint128 price, uint64 expiresAt) = bids.tokenBids(address(nft), 1, bidder);
        assertEq(bidder_, bidder);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, 0);
    }

    function testH03_TokenBidCannotBeReplacedBelowSellerMinimum() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.startPrank(bidder);
        marketplace.placeTokenBid{value: 10 ether}(address(nft), 1, 10 ether, 0);
        marketplace.placeTokenBid{value: 1 wei}(address(nft), 1, 1 wei, 0);
        vm.stopPrank();

        vm.prank(seller);
        _expectRevert(MarketplaceBids.PriceTooLow.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 10 ether, 0);
    }

    function testH03_CollectionBidCannotBeReplacedBelowSellerMinimum() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.startPrank(bidder);
        marketplace.placeCollectionBid{value: 10 ether}(address(nft), 10 ether, 1, 0);
        marketplace.placeCollectionBid{value: 1 wei}(address(nft), 1 wei, 1, 0);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        _expectRevert(MarketplaceBids.PriceTooLow.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 10 ether, 0);
    }

    function testH03_AcceptStillWorksAtMinimum() public {
        _setupTokenBid();

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, uint128(SALE_PRICE), 0);

        assertEq(nft.ownerOf(1), bidder);
    }

    function testM03_TokenBidMinSellerProceedsProtectsSeller() public {
        _setupTokenBid();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        vm.prank(seller);
        _expectRevert(MarketplaceBids.SellerProceedsTooLow.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0.9 ether);
    }

    function testM03_CollectionBidMinSellerProceedsProtectsSeller() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        _expectRevert(MarketplaceBids.SellerProceedsTooLow.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0.9 ether);
    }

    function testG03_BidAcceptanceDelegatesOwnershipCheckToCore() public {
        _setupCollectionBid();
        nft.mint(seller, 1);
        vm.prank(seller);
        nft.transferFrom(seller, unauthorized, 1);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds, 0, 0);
    }

    function testG03_AcceptCollectionBidGasBounded() public {
        _setupCollectionBid();
        nft.mint(seller, 1);
        _approveOnCore(address(nft), seller);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(nft.ownerOf(1), bidder);
        assertLt(gasUsed, 500_000);
    }

    function testG07_BidsUseRegistryAndCachedFeeReceiver() public {
        MockNFT unregistered = new MockNFT();

        vm.prank(bidder);
        vm.expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(unregistered), 1, uint128(SALE_PRICE), 0);

        _setupTokenBid();

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        assertEq(nft.ownerOf(1), bidder);
        assertEq(bids.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertLt(gasUsed, 500_000);
    }

    function testG05_TokenBidBatchRejectsTooManyTokens() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        uint256[] memory ids = new uint256[](51);
        uint128[] memory prices = new uint128[](51);
        uint64[] memory expiries = new uint64[](51);
        for (uint256 i; i < 51; ++i) {
            ids[i] = i + 1;
            prices[i] = 1 wei;
        }

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.BatchTooLarge.selector);
        marketplace.placeTokenBidBatch{value: 51 wei}(address(nft), ids, prices, expiries);
    }

    function testExecuteSaleFromBidEmitsSaleEventForTokenBid() public {
        // Setup: mint NFT, register collection, approve
        vm.prank(owner);
        nft.mint(seller, 1);
        vm.prank(seller);
        nft.setApprovalForAll(address(core), true);

        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Place token bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        // Accept token bid and check Sale event
        vm.expectEmit(true, true, true, true);
        emit MarketplaceCore.Sale(
            address(nft),
            1,
            seller,
            bidder,
            uint128(SALE_PRICE),
            uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000),
            uint128((SALE_PRICE * ROYALTY_FEE) / 10000)
        );

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, uint128(SALE_PRICE), 0);
    }

    function testExecuteSaleFromBidEmitsSaleEventForCollectionBid() public {
        // Setup: mint 2 NFTs, register collection, approve
        vm.prank(owner);
        nft.mint(seller, 1);
        vm.prank(owner);
        nft.mint(seller, 2);
        vm.prank(seller);
        nft.setApprovalForAll(address(core), true);

        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Place collection bid
        vm.deal(bidder, SALE_PRICE * 2);
        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE * 2}(address(nft), uint128(SALE_PRICE), 2, 0);

        // Accept collection bid and check Sale events
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;

        // Expect two Sale events
        for (uint256 i = 0; i < 2; i++) {
            vm.expectEmit(true, true, true, true);
            emit MarketplaceCore.Sale(
                address(nft),
                tokenIds[i],
                seller,
                bidder,
                uint128(SALE_PRICE),
                uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000),
                uint128((SALE_PRICE * ROYALTY_FEE) / 10000)
            );
        }

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, tokenIds, uint128(SALE_PRICE), 0);
    }

    function testSaleEventValuesMatchCalculatedValues() public {
        // Setup
        vm.prank(owner);
        nft.mint(seller, 1);
        vm.prank(seller);
        nft.setApprovalForAll(address(core), true);

        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Place and accept bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        // Calculate expected values
        uint128 expectedMarketplaceFee = uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000);
        uint128 expectedRoyalty = uint128((SALE_PRICE * ROYALTY_FEE) / 10000);

        // Check event
        vm.expectEmit(true, true, true, true);
        emit MarketplaceCore.Sale(
            address(nft), 1, seller, bidder, uint128(SALE_PRICE), expectedMarketplaceFee, expectedRoyalty
        );

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, uint128(SALE_PRICE), 0);

        // Verify the event was emitted with correct values by checking logs
        vm.recordLogs();
        // We already checked with expectEmit, but we can also verify after
    }

    function testM05_CannotBidOnOwnToken() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        nft.mint(bidder, 1);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.SelfBid.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testM05_CannotBatchBidOnOwnToken() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        nft.mint(bidder, 1);

        uint256[] memory ids = new uint256[](1);
        uint128[] memory prices = new uint128[](1);
        uint64[] memory expiries = new uint64[](1);
        ids[0] = 1;
        prices[0] = uint128(SALE_PRICE);

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.SelfBid.selector);
        marketplace.placeTokenBidBatch{value: SALE_PRICE}(address(nft), ids, prices, expiries);
    }

    function testM05_CoreRejectsSelfSaleFromBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(bidder, 1);
        _approveOnCore(address(nft), bidder);

        vm.prank(address(bids));
        _expectRevert(MarketplaceCore.SelfPurchase.selector);
        core.executeSaleFromBid(address(nft), 1, bidder, bidder, uint128(SALE_PRICE));
    }

    function testL06_PerTokenApprovalAllowsBidAcceptance() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(seller);
        nft.approve(address(core), 1);

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0);

        assertEq(nft.ownerOf(1), bidder);
    }
}

contract ReentrantBidder is IERC721Receiver {
    enum Action {
        None,
        PlaceTokenBid,
        CancelTokenBid
    }

    Marketplace public immutable router;
    address public immutable collection;
    uint256 public immutable tokenId;

    Action public action;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    constructor(Marketplace _router, address _collection, uint256 _tokenId) {
        router = _router;
        collection = _collection;
        tokenId = _tokenId;
    }

    function setAction(Action newAction) external {
        action = newAction;
        reentrySucceeded = false;
        reentryError = bytes4(0);
    }

    function placeBid(uint128 price) external payable {
        router.placeTokenBid{value: msg.value}(collection, tokenId, price, 0);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        Action currentAction = action;

        if (currentAction == Action.PlaceTokenBid) {
            (bool success, bytes memory returnData) = address(router).call{value: 1}(
                abi.encodeWithSelector(
                    Marketplace.placeTokenBid.selector, collection, tokenId + 1, uint128(1), uint64(0)
                )
            );
            _record(success, returnData);
        } else if (currentAction == Action.CancelTokenBid) {
            (bool success, bytes memory returnData) =
                address(router).call(abi.encodeWithSelector(Marketplace.cancelTokenBid.selector, collection, tokenId));
            _record(success, returnData);
        }

        return IERC721Receiver.onERC721Received.selector;
    }

    function _record(bool success, bytes memory returnData) internal {
        reentrySucceeded = success;
        if (!success && returnData.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(returnData, 0x20))
            }
            reentryError = selector;
        }
    }
}

contract AuditR4Test is TestSetup {
    ReentrantBidder internal attacker;

    function setUp() public override {
        super.setUp();
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        nft.mint(seller, 1);
        _approveOnCore(address(nft), seller);

        attacker = new ReentrantBidder(marketplace, address(nft), 1);
        vm.deal(address(attacker), SALE_PRICE + 1);

        attacker.placeBid{value: SALE_PRICE}(uint128(SALE_PRICE));
        assertEq(bids.totalBidEscrow(), SALE_PRICE);
    }

    function _acceptTokenBid() internal {
        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, address(attacker), 0, 0);
    }

    function _assertAccounting() internal view {
        assertEq(bids.totalBidEscrow(), 0);
        assertEq(bids.totalPendingWithdrawals(), SALE_PRICE);
        assertGe(address(bids).balance, bids.totalPendingWithdrawals() + bids.totalBidEscrow());
        assertEq(nft.ownerOf(1), address(attacker));
    }

    function testR4_PlaceBidReentryBlocked() public {
        attacker.setAction(ReentrantBidder.Action.PlaceTokenBid);

        _acceptTokenBid();

        assertFalse(attacker.reentrySucceeded());
        assertEq(attacker.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _assertAccounting();
    }

    function testR4_CancelBidReentryBlocked() public {
        attacker.setAction(ReentrantBidder.Action.CancelTokenBid);

        _acceptTokenBid();

        assertFalse(attacker.reentrySucceeded());
        assertEq(attacker.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _assertAccounting();
    }
}
