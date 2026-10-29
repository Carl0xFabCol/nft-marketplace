// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/MarketplaceCore.sol";

/// @notice O-3: setRouter emits the old and new router addresses.
contract O3_RouterUpdatedTest is Test {
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);

    function testSetRouterEmitsRouterUpdated() public {
        MarketplaceCore core = new MarketplaceCore(500, address(this));
        address newRouter = address(0xBEEF);

        vm.expectEmit(true, true, false, true, address(core));
        emit RouterUpdated(address(0), newRouter);

        core.setRouter(newRouter);

        assertEq(core.router(), newRouter);
    }
}
