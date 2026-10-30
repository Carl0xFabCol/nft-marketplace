// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

contract AuditO4Test is TestSetup {
    function testWithdraw_RevertsWhenNoPending() public {
        vm.prank(buyer);
        vm.expectRevert(Marketplace.NoWithdrawal.selector);
        marketplace.withdraw();
    }

    function testWithdraw_SucceedsWithCoreCreditOnly() public {
        _setupListing();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 before = buyer.balance;
        uint256 pending = core.pendingWithdrawals(seller);
        assertGt(pending, 0);
        assertEq(bids.pendingWithdrawals(seller), 0);

        vm.prank(seller);
        marketplace.withdraw();

        uint256 afterBal = seller.balance;
        assertGt(afterBal, before);
        assertEq(core.pendingWithdrawals(seller), 0);
    }

    function testWithdraw_SucceedsWithBidsCreditOnly() public {
        // register collection
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        vm.prank(buyer);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        vm.prank(buyer);
        marketplace.cancelTokenBid(address(nft), 1);

        uint256 pending = bids.pendingWithdrawals(buyer);
        assertGt(pending, 0);
        assertEq(core.pendingWithdrawals(buyer), 0);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        marketplace.withdraw();
        uint256 afterBal = buyer.balance;
        assertGt(afterBal, before);
        assertEq(bids.pendingWithdrawals(buyer), 0);
    }

    function testWithdraw_SucceedsWithBothCredits() public {
        // create pending in core
        _setupListing();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // create pending in bids (use token 2)
        vm.prank(unauthorized);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 2, uint128(SALE_PRICE), 0);
        vm.prank(unauthorized);
        marketplace.cancelTokenBid(address(nft), 2);

        uint256 corePending = core.pendingWithdrawals(seller);
        uint256 bidsPending = bids.pendingWithdrawals(unauthorized);
        assertGt(corePending, 0);
        assertGt(bidsPending, 0);

        uint256 beforeSeller = seller.balance;
        uint256 beforeUnauth = unauthorized.balance;

        vm.prank(seller);
        marketplace.withdraw();
        vm.prank(unauthorized);
        marketplace.withdraw();

        assertGt(seller.balance, beforeSeller);
        assertGt(unauthorized.balance, beforeUnauth);
        assertEq(core.pendingWithdrawals(seller), 0);
        assertEq(bids.pendingWithdrawals(unauthorized), 0);
    }
}