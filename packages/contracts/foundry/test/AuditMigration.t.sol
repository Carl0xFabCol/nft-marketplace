// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-07: the router can hand both components to a new owner.
contract AuditMigrationTest is TestSetup {
    function testM07_TransferComponentOwnershipStartsHandoff() public {
        vm.prank(owner);
        marketplace.transferComponentOwnership(newOwner);

        assertEq(core.pendingOwner(), newOwner);
        assertEq(bids.pendingOwner(), newOwner);

        vm.startPrank(newOwner);
        core.acceptOwnership();
        bids.acceptOwnership();
        vm.stopPrank();

        assertEq(core.owner(), newOwner);
        assertEq(bids.owner(), newOwner);
    }

    function testM07_OnlyRouterOwnerCanMigrate() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.transferComponentOwnership(unauthorized);
    }

    function testM07_RejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(Marketplace.InvalidAddress.selector);
        marketplace.transferComponentOwnership(address(0));
    }
}
