// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice Dedicated behaviour and gas-bound tests for the gas optimisation
///         findings G-03, G-04, G-06, G-07 and G-09.
contract AuditGSeriesTest is TestSetup {
    function _prepareTokens(uint256 count) internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        for (uint256 i = 1; i <= count; ++i) {
            nft.mint(seller, i);
        }
        _approveOnCore(address(nft), seller);
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

    function testG04_SingleAndBatchListingSharePath() public {
        _prepareTokens(2);

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
        uint256 singleGas = gasBefore - gasleft();

        address[] memory collections_ = new address[](1);
        uint256[] memory tokenIds = new uint256[](1);
        uint128[] memory prices = new uint128[](1);
        uint64[] memory expiries = new uint64[](1);
        collections_[0] = address(nft);
        tokenIds[0] = 2;
        prices[0] = uint128(SALE_PRICE);
        expiries[0] = _listingExpiry();

        vm.prank(seller);
        marketplace.createListingBatch(collections_, tokenIds, prices, expiries);

        (address seller1, uint128 price1, , , uint16 fee1, ) = core.listings(address(nft), 1);
        (address seller2, uint128 price2, , , uint16 fee2, ) = core.listings(address(nft), 2);

        assertEq(seller1, seller);
        assertEq(seller2, seller);
        assertEq(price1, SALE_PRICE);
        assertEq(price2, SALE_PRICE);
        assertEq(fee1, fee2);
        assertEq(core.totalListings(), 2);
        assertLt(singleGas, 500_000);
    }

    function testG06_BuyBatchCachesListingsAndGasBounded() public {
        _prepareTokens(2);

        address[] memory collections_ = new address[](2);
        uint256[] memory tokenIds = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);
        for (uint256 i; i < 2; ++i) {
            collections_[i] = address(nft);
            tokenIds[i] = i + 1;
            prices[i] = uint128(SALE_PRICE);
            expiries[i] = _listingExpiry();
        }

        vm.prank(seller);
        marketplace.createListingBatch(collections_, tokenIds, prices, expiries);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        uint256 gasBefore = gasleft();
        vm.prank(buyer);
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), ids);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(nft.ownerOf(1), buyer);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(core.totalListings(), 0);
        assertLt(gasUsed, 1_000_000);
    }

    function testG07_BidsUseRegistryAndCachedFeeReceiver() public {
        MockNFT unregistered = new MockNFT();

        vm.prank(bidder);
        vm.expectRevert(MarketplaceBids.CollectionNotRegistered.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(unregistered), 1, uint128(SALE_PRICE), 0
        );

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

    function testG09_WithdrawalTotalsAccumulateOncePerSale() public {
        _setupListing();

        uint256 gasBefore = gasleft();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(core.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
        assertEq(core.pendingWithdrawals(seller), expectedSeller);
        assertEq(
            core.totalPendingWithdrawals(),
            core.pendingWithdrawals(feeReceiverAddr)
                + core.pendingWithdrawals(royaltyReceiverAddr)
                + core.pendingWithdrawals(seller)
        );
        assertLt(gasUsed, 600_000);
    }
}
