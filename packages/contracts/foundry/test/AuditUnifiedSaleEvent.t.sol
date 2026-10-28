// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TestSetup} from "./TestSetup.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";

contract UnifiedSaleEventTest is TestSetup {
    function testExecuteSaleFromBidEmitsSaleEventForTokenBid() public {
        // Setup: mint NFT, register collection, approve
        vm.prank(owner);
        nft.mint(seller, 1);
        vm.prank(seller);
        nft.setApprovalForAll(address(core), true);
        
        vm.prank(owner);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        
        // Place token bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        
        // Accept token bid and check Sale event
        vm.expectEmit(true, true, true, true);
        emit MarketplaceCore.Sale(address(nft), 1, seller, bidder, uint128(SALE_PRICE), uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000), uint128((SALE_PRICE * ROYALTY_FEE) / 10000));
        
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
        
        vm.prank(owner);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        
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
            emit MarketplaceCore.Sale(address(nft), tokenIds[i], seller, bidder, uint128(SALE_PRICE), uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000), uint128((SALE_PRICE * ROYALTY_FEE) / 10000));
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
        
        vm.prank(owner);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        
        // Place and accept bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        
        // Calculate expected values
        uint128 expectedMarketplaceFee = uint128((SALE_PRICE * MARKETPLACE_FEE) / 10000);
        uint128 expectedRoyalty = uint128((SALE_PRICE * ROYALTY_FEE) / 10000);
        
        // Check event
        vm.expectEmit(true, true, true, true);
        emit MarketplaceCore.Sale(address(nft), 1, seller, bidder, uint128(SALE_PRICE), expectedMarketplaceFee, expectedRoyalty);
        
        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, bidder, uint128(SALE_PRICE), 0);
        
        // Verify the event was emitted with correct values by checking logs
        vm.recordLogs();
        // We already checked with expectEmit, but we can also verify after
    }
}