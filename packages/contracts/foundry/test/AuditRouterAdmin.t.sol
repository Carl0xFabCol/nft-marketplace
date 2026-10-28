// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-06: router admin operations tolerate partial component state.
contract AuditRouterAdminTest is TestSetup {
    function testM06_SweepSucceedsWhenOnlyCoreHasExcess() public {
        vm.deal(address(core), 1 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 1 ether);
        assertEq(address(core).balance, 0);
    }

    function testM06_SweepSucceedsWhenOnlyBidsHasExcess() public {
        vm.deal(address(bids), 1 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 1 ether);
        assertEq(address(bids).balance, 0);
    }

    function testM06_SweepRevertsWhenNeitherHasExcess() public {
        vm.prank(owner);
        vm.expectRevert(Marketplace.SweepFailed.selector);
        marketplace.sweepExcessETH(payable(owner));
    }

    function testM06_PauseAndUnpauseAreIdempotent() public {
        vm.startPrank(owner);
        marketplace.pause();
        marketplace.pause();
        assertTrue(core.paused());
        assertTrue(bids.paused());

        marketplace.unpause();
        marketplace.unpause();
        assertFalse(core.paused());
        assertFalse(bids.paused());
        vm.stopPrank();
    }
}
