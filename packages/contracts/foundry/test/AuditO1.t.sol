// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice O-1: migration to a new owner after the real deployment fixture.
///         The router owns Core/Bids; transferComponentOwnership hands them to
///         a new admin while router-only entrypoints stay bound to the router.
contract AuditO1Test is TestSetup {
    address internal newOwnerAddr = address(0x1234);

    function setUp() public override {
        super.setUp();

        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));

        vm.prank(owner);
        marketplace.transferComponentOwnership(newOwnerAddr);

        vm.prank(newOwnerAddr);
        core.acceptOwnership();
        vm.prank(newOwnerAddr);
        bids.acceptOwnership();
    }

    function testO1_NewOwnerAdminsCoreAndBidsDirectly() public {
        assertEq(core.owner(), newOwnerAddr);
        assertEq(bids.owner(), newOwnerAddr);
        assertEq(marketplace.owner(), owner);

        vm.prank(newOwnerAddr);
        core.updateMarketplaceFee(500);
        assertEq(core.marketplaceFee(), 500);

        vm.prank(newOwnerAddr);
        core.updateFeeReceiver(address(0x9999));
        assertEq(core.feeReceiver(), address(0x9999));

        vm.prank(newOwnerAddr);
        bids.pause();
        assertTrue(bids.paused());
        vm.prank(newOwnerAddr);
        bids.unpause();
        assertFalse(bids.paused());
    }

    function testO1_RouterAdminWrappersRevertForNewOwner() public {
        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.updateMarketplaceFee(700);

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.pause();

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.verifyCollection(address(nft));

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.sweepExcessETH(payable(newOwnerAddr));

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.transferComponentOwnership(address(0xbeef));
    }

    function testO1_NewOwnerCannotCallRouterOnlyCoreFunctions() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry(), seller);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy(address(nft), 1, buyer);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(address(nft), 1, seller, buyer, uint128(SALE_PRICE));

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(newOwnerAddr);
    }

    function testO1_RouterStillOperatesAfterMigration() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }
}
