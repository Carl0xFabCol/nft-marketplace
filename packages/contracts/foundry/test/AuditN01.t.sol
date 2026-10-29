// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/Marketplace.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import "./TestSetup.sol";

/// @notice N-01: owner/multisig cannot steal an NFT that has an approval to Core.
///         These are the regression expectations after the router-only fix.
contract AuditN01Test is TestSetup {
    function testN01_OwnerCannotStealNFTViaDirectCoreCall() public {
        _setupListing();

        vm.deal(owner, 1 ether);

        // The owner is not the router, so a direct Core call must be rejected.
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        vm.prank(owner);
        core.buy{value: 1 wei}(address(nft), 1, owner);

        assertEq(nft.ownerOf(1), seller);
    }

    function testN01_OwnerCannotCreateListingForVictim() public {
        _registerCollection(address(nft), 0, address(0));
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        // The owner cannot forge a listing on the victim's behalf.
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        vm.prank(owner);
        core.createListing(address(nft), 1, 1 wei, 0, seller);
    }

    function testN01_SetBidsContractIsNotReassignable() public {
        vm.startPrank(owner);
        MarketplaceCore freshCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        freshCore.setBidsContract(address(0x999));

        vm.expectRevert(MarketplaceCore.AlreadySet.selector);
        freshCore.setBidsContract(address(0x888));
        vm.stopPrank();
    }

    function testN01_SetMarketplaceAddressIsNotReassignable() public {
        vm.startPrank(owner);
        MarketplaceCore freshCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        MarketplaceBids freshBids = new MarketplaceBids(address(freshCore));
        freshBids.setMarketplaceAddress(address(0x999));

        vm.expectRevert(MarketplaceBids.AlreadySet.selector);
        freshBids.setMarketplaceAddress(address(0x888));
        vm.stopPrank();
    }
}
