// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import "./MockMalformedReturn.sol";

/// @notice I-N3: royalty queries are capped at ROYALTY_QUERY_GAS so registry
///         style collections cannot consume unbounded gas during a sale.
contract AuditIN3Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
    }

    function testIN3_ExpensiveRoyaltyQueryFallsBack() public {
        assertEq(core.ROYALTY_QUERY_GAS(), 50_000);

        address expensiveReceiver = address(0xBEEF);
        malformed.setTokenRoyalty(1, expensiveReceiver, uint96(ROYALTY_FEE));
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(
            address(malformed),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );

        malformed.setExpensiveRoyaltyInfo(true, 5_000);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(expensiveReceiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}
