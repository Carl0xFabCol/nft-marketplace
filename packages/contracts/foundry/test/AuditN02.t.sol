// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/Marketplace.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "./TestSetup.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice N-02: Stale-listing cleanup never persists
contract AuditN02Test is TestSetup {
    function testN02_StaleListingRemainsAfterFailedBuy() public {
        // Create a listing
        _setupListing();
        
        // Transfer NFT to someone else (makes listing stale)
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();
        
        // Try to buy - should revert with ListingNotFound
        vm.startPrank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        vm.stopPrank();
        
        // Check listing still exists (dead code delete doesn't persist due to revert)
        (address s, uint128 price, , , , ) = core.listings(address(nft), 1);
        assertEq(s, seller); // Still exists!
        assertEq(price, SALE_PRICE);
        assertEq(core.totalListings(), 1); // Should be 0 but is 1
    }
    
    function testN02_StaleListingRemainsAfterFailedUpdateListingPrice() public {
        // Create a listing
        _setupListing();
        
        // Transfer NFT to someone else
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();
        
        // Try to update price - should revert with ListingNotFound
        vm.startPrank(seller);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(SALE_PRICE * 2));
        vm.stopPrank();
        
        // Listing should still exist
        (address s, , , , , ) = core.listings(address(nft), 1);
        assertEq(s, seller);
        assertEq(core.totalListings(), 1);
    }
    
    function testN02_BurnedTokenMakesListingStale() public {
        // Create a listing
        _setupListing();

        // Simulate a burn: ERC721 ownerOf reverts for a non-existent token.
        vm.mockCallRevert(
            address(nft),
            abi.encodeWithSelector(IERC721.ownerOf.selector, 1),
            abi.encode("burned")
        );

        // Try to buy - currently might bubble ownerOf revert
        vm.startPrank(buyer);
        // Should revert with ListingNotFound, not bubble ownerOf revert
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        vm.stopPrank();
    }
    
    function testN02_CleanStaleListingNotImplemented() public {
        // Test that cleanStaleListing doesn't exist yet
        vm.startPrank(seller);
        
        // This should fail to compile or revert
        // marketplace.cleanStaleListing(address(nft), 1);
        
        vm.stopPrank();
    }
}