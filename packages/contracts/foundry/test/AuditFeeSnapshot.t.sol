// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice M-03: marketplace fee is snapshotted at listing time and bid sellers
///         can bound their net proceeds.
contract AuditFeeSnapshotTest is TestSetup {
    function testM03_FeeIncreaseAfterListingDoesNotAffectSeller() public {
        _setupListing();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller = SALE_PRICE
            - (SALE_PRICE * MARKETPLACE_FEE) / 10_000
            - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);
    }

    function testM03_LowerCurrentFeeIsUsed() public {
        _setupListing();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(100);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller = SALE_PRICE
            - (SALE_PRICE * 100) / 10_000
            - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);
    }

    function testM03_TokenBidMinSellerProceedsProtectsSeller() public {
        _setupTokenBid();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        vm.prank(seller);
        _expectRevert(MarketplaceBids.SellerProceedsTooLow.selector);
        marketplace.acceptTokenBid(address(nft), 1, bidder, 0, 0.9 ether);
    }

    function testM03_CollectionBidMinSellerProceedsProtectsSeller() public {
        _setupCollectionBid();
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(seller);
        _expectRevert(MarketplaceBids.SellerProceedsTooLow.selector);
        marketplace.acceptCollectionBid(address(nft), bidder, ids, 0, 0.9 ether);
    }
}
