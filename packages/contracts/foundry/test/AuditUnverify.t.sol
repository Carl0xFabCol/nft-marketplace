// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-05: collections can be unverified by the owner.
contract AuditUnverifyTest is TestSetup {
    function testL05_UnverifyCollection() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.startPrank(owner);
        marketplace.verifyCollection(address(nft));
        (, , , , bool verified, ) = core.collections(address(nft));
        assertTrue(verified);

        vm.expectEmit(true, false, false, false);
        emit MarketplaceCore.CollectionUnverified(address(nft));
        marketplace.unverifyCollection(address(nft));
        vm.stopPrank();

        (, , , , verified, ) = core.collections(address(nft));
        assertFalse(verified);
    }

    function testL05_UnverifyOnlyOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(buyer);
        _expectOwnableUnauthorized(buyer);
        marketplace.unverifyCollection(address(nft));
    }
}
