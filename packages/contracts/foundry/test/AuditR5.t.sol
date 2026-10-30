// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import "../script/VerifyDeployment.s.sol";

/// @notice R-5: the deployment verifier enforces every set-once wiring check.
contract AuditR5Test is TestSetup {
    VerifyDeployment internal verifier;

    function setUp() public override {
        super.setUp();
        verifier = new VerifyDeployment();
    }

    function testR5_ValidDeploymentPasses() public view {
        verifier.run(address(core), address(bids), address(marketplace));
    }

    function testR5_WrongRouterRejected() public {
        vm.expectRevert("R-5: core.router mismatch");
        verifier.run(address(core), address(bids), address(0xBEEF));
    }

    function testR5_PausedComponentsRequireExpectation() public {
        vm.prank(owner);
        marketplace.pause();

        vm.expectRevert("R-5: core is paused");
        verifier.run(address(core), address(bids), address(marketplace));

        verifier.run(address(core), address(bids), address(marketplace), true);
    }
}
