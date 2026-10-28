// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-02: a collection bid spanning tokens with different royalty
///         receivers must credit each receiver separately.
contract AuditRoyaltyAttributionTest is TestSetup {
    function testM02_CollectionBidCreditsEachRoyaltyReceiver() public {
        _registerCollection(address(nftWithRoyalty), 0, address(0));

        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 500);
        nftWithRoyalty.setTokenRoyalty(2, newOwner, 1_000);

        _mintNFTWithRoyalty(seller, 1);
        _mintNFTWithRoyalty(seller, 2);
        _approveOnCore(address(nftWithRoyalty), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: 2 ether}(address(nftWithRoyalty), 1 ether, 2, 0);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nftWithRoyalty), bidder, ids, 0);

        assertEq(bids.pendingWithdrawals(royaltyReceiverAddr), 0.05 ether);
        assertEq(bids.pendingWithdrawals(newOwner), 0.1 ether);
        assertEq(bids.pendingWithdrawals(seller), 1.75 ether);
    }
}
