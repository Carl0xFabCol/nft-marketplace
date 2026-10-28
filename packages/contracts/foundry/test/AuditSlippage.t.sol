// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice H-03: bid acceptance must be protected against last-second bid
///         replacement (bait-and-switch).
contract AuditSlippageTest is TestSetup {
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
}
