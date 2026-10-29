// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import "./TestSetup.sol";

/// @notice N-03: royalty snapshot is taken when the listing is created, so a
///         collection owner cannot raise the royalty against a live listing.
contract N03_RoyaltySnapshotTest is TestSetup {
    using stdStorage for StdStorage;

    uint64 internal constant ONE_DAY = 1 days;

    function _expiry() internal view returns (uint64) {
        return uint64(block.timestamp + ONE_DAY);
    }

    function _list(uint256 tokenId, uint128 price, uint64 expiresAt) internal {
        vm.prank(seller);
        marketplace.createListing(address(nft), tokenId, price, expiresAt);
    }

    function _buy(uint256 tokenId, uint128 price) internal {
        vm.deal(buyer, price);
        vm.prank(buyer);
        marketplace.buy{value: price}(address(nft), tokenId);
    }

    function testRoyaltyIncreaseAfterListingUsesSnapshot() public {
        _registerCollection(address(nft), 200, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, uint128(SALE_PRICE), _expiry());

        (, , , , , uint16 snapshotBps) = core.listings(address(nft), 1);
        assertEq(snapshotBps, 200, "snapshot must record the listing-time royalty");

        // Collection owner raises the royalty from 2% to 20% after listing.
        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 2_000);

        _buy(1, uint128(SALE_PRICE));

        uint256 expectedRoyalty = (SALE_PRICE * 200) / 10_000;
        uint256 raisedRoyalty = (SALE_PRICE * 2_000) / 10_000;
        uint256 paidRoyalty = core.pendingWithdrawals(royaltyReceiverAddr);

        assertEq(paidRoyalty, expectedRoyalty, "sale must use the snapshot");
        assertLt(paidRoyalty, raisedRoyalty, "raise must not affect the live listing");
    }

    function testRoyaltyDecreaseAfterListingIsHonored() public {
        _registerCollection(address(nft), 2_000, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, uint128(SALE_PRICE), _expiry());

        (, , , , , uint16 snapshotBps) = core.listings(address(nft), 1);
        assertEq(snapshotBps, 2_000);

        // Collection owner lowers the royalty from 20% to 2% after listing.
        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 200);

        _buy(1, uint128(SALE_PRICE));

        uint256 expectedRoyalty = (SALE_PRICE * 200) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testTinyPricesNeverExceedPrice() public {
        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000); // 10%, the maximum fee

        _registerCollection(address(nft), 2_000, royaltyReceiverAddr); // 20%, the maximum royalty

        uint128[2] memory prices = [uint128(1), uint128(3)];
        for (uint256 i; i < prices.length; ++i) {
            uint256 tokenId = i + 1;
            _mintNFT(seller, tokenId);
            _approveOnCore(address(nft), seller);
            _list(tokenId, prices[i], _expiry());

            uint256 feesBefore = core.pendingWithdrawals(feeReceiverAddr);
            uint256 royaltyBefore = core.pendingWithdrawals(royaltyReceiverAddr);

            _buy(tokenId, prices[i]);

            uint256 feeDelta = core.pendingWithdrawals(feeReceiverAddr) - feesBefore;
            uint256 royaltyDelta = core.pendingWithdrawals(royaltyReceiverAddr) - royaltyBefore;

            assertLe(feeDelta + royaltyDelta, prices[i], "fee + royalty must never exceed price");
        }
    }

    function testFuzzFeeAndRoyaltyNeverExceedPrice(
        uint128 priceSeed,
        uint16 feeBpsSeed,
        uint16 royaltyBpsSeed
    ) public {
        uint16 feeBps = uint16(bound(feeBpsSeed, 0, 1_000));
        uint16 royaltyBps = uint16(bound(royaltyBpsSeed, 0, 2_000));
        uint128 price = uint128(bound(priceSeed, 1, 1e30));

        vm.prank(owner);
        marketplace.updateMarketplaceFee(feeBps);
        _registerCollection(address(nft), royaltyBps, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, price, _expiry());

        _buy(1, price);

        uint256 fee = core.pendingWithdrawals(feeReceiverAddr);
        uint256 royalty = core.pendingWithdrawals(royaltyReceiverAddr);
        uint256 sellerProceeds = core.pendingWithdrawals(seller);

        assertLe(fee + royalty, price, "fee + royalty must never exceed price");
        assertEq(fee + royalty + sellerProceeds, price, "proceeds must sum to price");
        assertEq(core.totalPendingWithdrawals(), price, "accounting must match the sale");
    }

    function testListingStorageLayout() public {
        _registerCollection(address(nft), 500, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint128 price = uint128(SALE_PRICE);
        uint64 expiresAt = _expiry();
        _list(1, price, expiresAt);

        uint256 baseSlot = stdstore
            .target(address(core))
            .sig(core.listings.selector)
            .with_key(address(nft))
            .with_key(uint256(1))
            .find();

        bytes32 slot0 = vm.load(address(core), bytes32(baseSlot));
        bytes32 slot1 = vm.load(address(core), bytes32(baseSlot + 1));
        bytes32 slot2 = vm.load(address(core), bytes32(baseSlot + 2));

        // Slot 1: seller.
        assertEq(address(uint160(uint256(slot0))), seller);

        // Slot 2: price, listedAt, expiresAt, feeBps and royaltyBps.
        assertEq(uint128(uint256(slot1)), price);
        assertEq(uint48(uint256(slot1) >> 128), uint48(block.timestamp));
        assertEq(uint48(uint256(slot1) >> 176), expiresAt);
        assertEq(uint16(uint256(slot1) >> 224), MARKETPLACE_FEE);
        assertEq(uint16(uint256(slot1) >> 240), 500, "royaltyBps lives in the second slot");

        // No third slot is consumed.
        assertEq(slot2, bytes32(0));
    }
}
