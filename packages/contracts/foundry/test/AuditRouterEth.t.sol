// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-02: the router must never custody ETH.
contract AuditRouterEthTest is TestSetup {
    function testL02_RouterRejectsPlainETH() public {
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        (bool ok, ) = address(marketplace).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(marketplace).balance, 0);
    }

    function testL02_RouterRejectsUnknownCalldata() public {
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        (bool ok, ) = address(marketplace).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(marketplace).balance, 0);
    }
}
