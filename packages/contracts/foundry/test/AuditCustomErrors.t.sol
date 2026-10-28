// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice G-08: string reverts are replaced by custom errors.
contract AuditCustomErrorsTest is TestSetup {
    function testG08_RouterConstructorUsesCustomError() public {
        vm.expectRevert(Marketplace.InvalidAddress.selector);
        new Marketplace(address(0), address(bids));
    }

    function testG08_CoreFallbackUsesCustomError() public {
        (bool ok, bytes memory data) = address(core).call(hex"deadbeef");
        assertFalse(ok);
        assertEq(bytes4(data), MarketplaceCore.InvalidCall.selector);
    }

    function testG08_BidsCorePausedUsesCustomError() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(address(marketplace));
        core.pause();

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CorePaused.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }
}
