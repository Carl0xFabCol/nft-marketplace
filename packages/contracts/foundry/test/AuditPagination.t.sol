// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {LaunchPad} from "../src/LaunchPad.sol";

contract AuditPaginationTest is TestSetup {
    LaunchPad internal launchPad;
    address internal creator = vm.addr(9);

    function setUp() public override {
        super.setUp();

        vm.prank(owner);
        launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        launchPad.setLaunchFee(0);

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);

        for (uint256 i; i < 5; ++i) {
            vm.prank(creator);
            launchPad.createCollection("C", "C", 0, address(0), 10, "", 0, 0);
        }
    }

    function testPagination_ReturnsRequestedSlice() public {
        address[] memory all = launchPad.getCollectionsCreatedBy(creator);
        address[] memory page = launchPad.getCollectionsCreatedBy(creator, 1, 3);

        assertEq(page.length, 3);
        assertEq(page[0], all[1]);
        assertEq(page[1], all[2]);
        assertEq(page[2], all[3]);
    }

    function testPagination_ClampsFinalPage() public {
        address[] memory all = launchPad.getCollectionsCreatedBy(creator);
        address[] memory page = launchPad.getCollectionsCreatedBy(creator, 3, 10);

        assertEq(page.length, 2);
        assertEq(page[0], all[3]);
        assertEq(page[1], all[4]);
    }

    function testPagination_OutOfRangeAndZeroLimitReturnEmpty() public {
        assertEq(launchPad.getCollectionsCreatedBy(creator, 5, 1).length, 0);
        assertEq(launchPad.getCollectionsCreatedBy(creator, 0, 0).length, 0);
    }

    function testPagination_RejectsOversizedPage() public {
        uint256 oversized = launchPad.MAX_PAGE_SIZE() + 1;
        vm.expectRevert(LaunchPad.PageTooLarge.selector);
        launchPad.getCollectionsCreatedBy(creator, 0, oversized);
    }
}
