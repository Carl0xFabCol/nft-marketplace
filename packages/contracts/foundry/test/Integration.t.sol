// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

contract IntegrationTest is TestSetup {
    // ═══════════════════════════════════════════════════════════════════
    // 6.0 CROSS-CONTRACT INTEGRATION
    // ═══════════════════════════════════════════════════════════════════

    function testEndToEnd_ListAndBuy() public {
        // Register → mint → approve → list → buy → verify ownership
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeReceiverAddr.balance;
        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.totalSales(), 1);
        assertEq(core.totalVolume(), SALE_PRICE);
        assertTrue(seller.balance > sellerBefore);
        assertTrue(feeReceiverAddr.balance > feeBefore);
        assertTrue(royaltyReceiverAddr.balance > royaltyBefore);
    }

    function testEndToEnd_CollectionBidAndAccept() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;
        marketplace.acceptCollectionBid(address(nft), buyer, tokenIds);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.totalSales(), 1);
    }

    function testEndToEnd_TokenBidAndAccept() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        marketplace.acceptTokenBid(address(nft), 1, buyer);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.totalSales(), 1);
    }

    function testEndToEnd_PauseBlocksAllOperations() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(owner);
        marketplace.pause();

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testEndToEnd_BidThenCancel() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        marketplace.placeCollectionBid{value: SALE_PRICE}(address(nft), uint128(SALE_PRICE), 1, 0);

        marketplace.cancelCollectionBid(address(nft));

        // collectionBids is a public mapping returning (address, uint128, uint32, uint64)
        // After cancellation, the bid should be deleted (bidder == address(0))
        (address bidder_, , , ) = bids.collectionBids(address(nft), buyer);
        assertEq(bidder_, address(0));
    }

    function testEndToEnd_CollectionRoyaltyWithERC2981() public {
        // Register collection with royalty
        _registerCollection(address(nftWithRoyalty), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Set per-token royalty
        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, uint96(ROYALTY_FEE));

        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);

        marketplace.createListing(address(nftWithRoyalty), 1, uint128(SALE_PRICE), 0);

        uint256 royaltyBefore = royaltyReceiverAddr.balance;

        marketplace.buy{value: SALE_PRICE}(address(nftWithRoyalty), 1);

        assertEq(nftWithRoyalty.ownerOf(1), buyer);
        assertEq(royaltyReceiverAddr.balance - royaltyBefore, (SALE_PRICE * ROYALTY_FEE) / 10_000);
    }
}
