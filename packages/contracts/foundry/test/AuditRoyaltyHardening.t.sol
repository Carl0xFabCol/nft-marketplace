// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-04: untrusted ERC-2981 responses are bounded and validated.
contract AuditRoyaltyHardeningTest is TestSetup {
    function _listAndBuyRoyaltyNft() internal {
        _registerCollection(address(nftWithRoyalty), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);

        vm.prank(seller);
        marketplace.createListing(address(nftWithRoyalty), 1, uint128(SALE_PRICE), 0);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nftWithRoyalty), 1);
    }

    function testM04_ExcessiveTokenRoyaltyFallsBackToCollectionRoyalty() public {
        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 5_000);

        _listAndBuyRoyaltyNft();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_ZeroReceiverFallsBackToCollectionRoyalty() public {
        // ERC-2981 returns a zero receiver (mock reports amount 0 in this case);
        // the stored collection royalty must be used instead.
        nftWithRoyalty.setTokenRoyalty(1, address(0), 5_000);

        _listAndBuyRoyaltyNft();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_RevertingRoyaltyFallsBackToCollectionRoyalty() public {
        _registerCollection(address(revertingRoyaltyNFT), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintRevertingRoyaltyNFT(seller, 1);
        _approveOnCore(address(revertingRoyaltyNFT), seller);

        vm.prank(seller);
        marketplace.createListing(address(revertingRoyaltyNFT), 1, uint128(SALE_PRICE), 0);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(revertingRoyaltyNFT), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_UpdateRoyaltyRejectsZeroReceiverWithFee() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidAddress.selector);
        marketplace.updateCollectionRoyalty(address(nft), address(0), 500);
    }
}
