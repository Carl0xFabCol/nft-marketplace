// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-N1: every narrowing cast is now SafeCast or preceded by a bound.
contract LN1_CastSafetyTest is TestSetup {
    function testExpiresAtAboveUint48Reverts() public {
        _registerCollection(address(nft), 0, address(0));
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint64 expiresAt = uint64(2 ** 48);

        vm.expectRevert(MarketplaceCore.ExpiryTooLarge.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiresAt);
    }
}
