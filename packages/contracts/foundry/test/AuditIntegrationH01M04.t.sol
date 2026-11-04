// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {Hyperc} from "../src/MERC721.sol";

/// @notice Integration: H-01 price-update royalty snapshot combined with M-04
///         Core override precedence and full sale proceeds conservation.
contract AuditIntegrationH01M04Test is TestSetup {
    address internal erc2981Receiver = vm.addr(10);
    address internal overrideReceiver = vm.addr(11);

    function test_integration_H01_and_M04_combined() public {
        Hyperc collection = new Hyperc(
            "Hyperc Collection",
            "HYPERC",
            owner,
            uint16(ROYALTY_FEE),
            erc2981Receiver,
            100,
            "",
            0,
            0
        );

        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);
        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, 1, _listingExpiry());

        uint256 finalPrice = 100 ether;
        vm.prank(seller);
        marketplace.updateListingPrice(address(collection), 1, uint128(finalPrice));

        (address sellerSnapshot, uint128 priceSnapshot, , , uint16 feeBps, uint16 royaltyBps) =
            core.listings(address(collection), 1);
        assertEq(sellerSnapshot, seller);
        assertEq(priceSnapshot, finalPrice);
        assertEq(feeBps, uint16(MARKETPLACE_FEE));
        assertEq(royaltyBps, 300);

        vm.deal(buyer, 200 ether);
        vm.prank(buyer);
        marketplace.buy{value: finalPrice}(address(collection), 1);

        uint256 expectedFee = (finalPrice * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (finalPrice * 300) / 10_000;
        uint256 expectedSeller = finalPrice - expectedFee - expectedRoyalty;

        uint256 sellerCredit = core.pendingWithdrawals(seller);
        uint256 feeCredit = core.pendingWithdrawals(feeReceiverAddr);
        uint256 royaltyCredit = core.pendingWithdrawals(overrideReceiver);

        assertEq(sellerCredit, expectedSeller);
        assertEq(feeCredit, expectedFee);
        assertEq(royaltyCredit, expectedRoyalty);
        assertEq(sellerCredit + feeCredit + royaltyCredit, finalPrice);

        assertEq(core.pendingWithdrawals(erc2981Receiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }
}
