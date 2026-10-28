// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-05: reject self-bids and self-sales.
contract AuditWashTradingTest is TestSetup {
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
}
