// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {Hyperc} from "../src/MERC721.sol";

/// @notice M-04: Core royalty values override ERC-2981 only when explicitly set.
contract AuditM04RoyaltyOverrideTest is TestSetup {
    address internal erc2981Receiver = vm.addr(10);
    address internal overrideReceiver = vm.addr(11);

    function _deployHyperc(address royaltyReceiver) internal returns (Hyperc collection) {
        collection = new Hyperc(
            "Hyperc Collection",
            "HYPERC",
            owner,
            uint16(ROYALTY_FEE),
            royaltyReceiver,
            100,
            "",
            0,
            0
        );
    }

    function _listAndBuy(Hyperc collection) internal {
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(seller);
        collection.mint(seller);

        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);
    }

    function test_M04_overrideWinsOverERC2981() public {
        Hyperc collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);

        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * 300) / 10_000;
        assertEq(core.pendingWithdrawals(overrideReceiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(erc2981Receiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }

    function test_M04_fallbackStillUsesERC2981WhenNotOverridden() public {
        Hyperc collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        assertFalse(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(erc2981Receiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }

    function test_M04_clearOverrideRestoresERC2981() public {
        Hyperc collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);
        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(owner);
        marketplace.clearRoyaltyOverride(address(collection));
        assertFalse(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(erc2981Receiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(overrideReceiver), 0);
    }

    function test_M04_royaltyInfoRevertStillFallsBack() public {
        _registerCollection(address(revertingRoyaltyNFT), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintRevertingRoyaltyNFT(seller, 1);
        _approveOnCore(address(revertingRoyaltyNFT), seller);

        vm.prank(seller);
        marketplace.createListing(address(revertingRoyaltyNFT), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(revertingRoyaltyNFT), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}
