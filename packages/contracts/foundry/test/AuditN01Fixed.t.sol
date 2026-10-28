// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/Marketplace.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "./TestSetup.sol";

/// @notice Test that N-01 fix prevents owner from stealing NFTs
contract AuditN01FixedTest is TestSetup {
    function testN01_OwnerCannotCallRouterFunctionsDirectly() public {
        // Try to call Core functions directly as owner - should revert
        vm.startPrank(owner);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, 1 ether, 0, seller);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy{value: 1 ether}(address(nft), 1, buyer);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.updateListingPrice(address(nft), 1, 1 ether, seller);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.cancelListing(address(nft), 1, seller);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(seller);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 500, seller);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.registerCollectionFromRouter(address(nft), 500, royaltyReceiverAddr, seller);
        
        vm.stopPrank();
    }
    
    function testN01_SetRouterRevertsOnSecondCall() public {
        // Deploy fresh system where owner still owns Core
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        
        // First call should work
        newCore.setRouter(address(0x123));
        
        // Second call should revert
        vm.expectRevert(MarketplaceCore.AlreadySet.selector);
        newCore.setRouter(address(0x456));
        
        vm.stopPrank();
    }
    
    function testN01_SetBidsContractRevertsOnSecondCall() public {
        // Deploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        
        // First call should work
        newCore.setBidsContract(address(0x789));
        
        // Second call should revert
        vm.expectRevert(MarketplaceCore.AlreadySet.selector);
        newCore.setBidsContract(address(0xabc));
        
        vm.stopPrank();
    }
    
    function testN01_SetMarketplaceAddressRevertsOnSecondCall() public {
        // Deploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        MarketplaceBids newBids = new MarketplaceBids(address(newCore));
        
        // First call should work
        newBids.setMarketplaceAddress(address(0xdef));
        
        // Second call should revert
        vm.expectRevert(MarketplaceBids.AlreadySet.selector);
        newBids.setMarketplaceAddress(address(0x999));
        
        vm.stopPrank();
    }
    
    function testN01_ConfigureBidsMarketplaceIsOneShot() public {
        // Redeploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        MarketplaceBids newBids = new MarketplaceBids(address(newCore));
        Marketplace newMarketplace = new Marketplace(address(newCore), address(newBids));
        
        // Transfer ownership
        newCore.transferOwnership(address(newMarketplace));
        newBids.transferOwnership(address(newMarketplace));
        
        // Accept ownership
        newMarketplace.acceptComponentOwnership();
        
        // First configure should work
        newMarketplace.configureBidsMarketplace();
        
        // Second configure should revert because setters are already set
        vm.expectRevert();
        newMarketplace.configureBidsMarketplace();
        
        vm.stopPrank();
    }
    
    function testN01_NewOwnerCannotCallRouterFunctions() public {
        // Test that even after transferComponentOwnership, new owner can't call router functions
        vm.startPrank(owner);
        
        // Transfer component ownership to new owner
        marketplace.transferComponentOwnership(newOwner);
        vm.stopPrank();
        
        vm.startPrank(newOwner);
        core.acceptOwnership();
        bids.acceptOwnership();
        vm.stopPrank();
        
        // New owner tries to call Core directly - should revert
        vm.startPrank(newOwner);
        
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, 1 ether, 0, seller);
        
        vm.stopPrank();
    }
}