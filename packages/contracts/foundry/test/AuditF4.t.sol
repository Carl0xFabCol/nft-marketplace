// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {MockMalformedNFT} from "./MockMalformedReturn.sol";

/// @notice F-4: the no-gas-limit staticcall overload must still cap the gas
///         forwarded to untrusted external views.
contract AuditF4Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);
    }

    function testF4_GasBurningIsApprovedForAllFailsClosed() public {
        malformed.setIsApprovedForAllGasBurn(30_000);

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 500_000);
    }
}
