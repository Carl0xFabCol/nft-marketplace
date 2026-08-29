// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract IntegrationTest is TestSetup {
    function testEndToEnd_ListAndBuy() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.totalSales(), 1);

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);
        assertEq(core.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testEndToEnd_CollectionBidAndAccept() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, 0
        );

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nft), bidder, ids);

        assertEq(nft.ownerOf(1), bidder);
        assertEq(core.totalSales(), 1);
        // Bid proceeds are credited by MarketplaceBids.
        assertGt(bids.pendingWithdrawals(seller), 0);
    }

    function testEndToEnd_TokenBidAndAccept() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(nft), 1, uint128(SALE_PRICE), 0
        );

        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder);

        assertEq(nft.ownerOf(1), bidder);
        assertEq(core.totalSales(), 1);
        assertGt(bids.pendingWithdrawals(seller), 0);
    }

    function testEndToEnd_PauseBlocksMarketplaceOperations() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(owner);
        marketplace.pause();

        vm.prank(buyer);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        vm.prank(seller);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testEndToEnd_RoyaltyERC2981UsesPendingWithdrawal() public {
        _registerCollection(
            address(nftWithRoyalty),
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr
        );

        nftWithRoyalty.setTokenRoyalty(
            1,
            royaltyReceiverAddr,
            uint96(ROYALTY_FEE)
        );

        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);

        vm.prank(seller);
        marketplace.createListing(
            address(nftWithRoyalty), 1, uint128(SALE_PRICE), 0
        );

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(
            address(nftWithRoyalty), 1
        );

        assertEq(nftWithRoyalty.ownerOf(1), buyer);
        assertEq(
            core.pendingWithdrawals(royaltyReceiverAddr),
            (SALE_PRICE * ROYALTY_FEE) / 10_000
        );
    }

    function testEndToEnd_BidCancellationAndWithdrawal() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, 0
        );

        vm.prank(bidder);
        marketplace.cancelCollectionBid(address(nft));

        uint256 before = bidder.balance;

        vm.prank(bidder);
        marketplace.withdraw();

        assertEq(bidder.balance - before, SALE_PRICE);
        assertEq(bids.pendingWithdrawals(bidder), 0);
    }
}
