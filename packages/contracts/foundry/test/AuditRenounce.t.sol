// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-03: ownership cannot be renounced on any component.
contract AuditRenounceTest is TestSetup {
    function testL03_AllComponentsRejectRenounce() public {
        vm.startPrank(owner);

        vm.expectRevert(MarketplaceCore.RenounceOwnershipDisabled.selector);
        core.renounceOwnership();

        vm.expectRevert(MarketplaceBids.RenounceOwnershipDisabled.selector);
        bids.renounceOwnership();

        vm.expectRevert(Marketplace.RenounceOwnershipDisabled.selector);
        marketplace.renounceOwnership();

        vm.stopPrank();
    }
}
