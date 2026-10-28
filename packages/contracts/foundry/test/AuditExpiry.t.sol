// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-04: expiresAt is exclusive (expiresAt <= now is expired).
contract AuditExpiryTest is TestSetup {
    function testL04_ListingExpiresAtExactTimestamp() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint64 expiry = uint64(block.timestamp + 1);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiry);

        vm.warp(expiry);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
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
}
