// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-06: per-token approval is sufficient, not just operator approval.
contract AuditPerTokenApprovalTest is TestSetup {
    function testL06_PerTokenApprovalAllowsListingAndBuy() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(seller);
        nft.approve(address(core), 1);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
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
