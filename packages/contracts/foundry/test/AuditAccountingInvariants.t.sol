// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {TestSetup} from "./TestSetup.sol";

contract AccountingInvariantsTest is TestSetup {
    
    
    
    function testCoreCreditUpdatesTotalPendingWithdrawals() public {
        // Test that _credit updates totalPendingWithdrawals
        uint256 initialTotalPending = core.totalPendingWithdrawals();
        
        // Direct call to _credit (internal function) - need to test via sale
        vm.deal(buyer, SALE_PRICE);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        
        // Check that totalPendingWithdrawals increased by sale price
        assertEq(core.totalPendingWithdrawals(), initialTotalPending + SALE_PRICE);
        
        // Check pending withdrawals for each account
        (uint256 corePending,) = marketplace.pendingWithdrawals(feeReceiverAddr);
        assertTrue(corePending > 0);
    }
    
    function testBidsCreditUpdatesTotalPendingWithdrawals() public {
        // Place a token bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        
        uint256 initialTotalPending = bids.totalPendingWithdrawals();
        
        // Cancel bid to trigger _credit
        vm.prank(bidder);
        marketplace.cancelTokenBid(address(nft), 1);
        
        // Check that totalPendingWithdrawals increased
        assertEq(bids.totalPendingWithdrawals(), initialTotalPending + SALE_PRICE);
    }
    
    function testWithdrawFailureReaddsToTotalPendingWithdrawals() public {
        // Make a sale
        vm.deal(buyer, SALE_PRICE);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        
        uint256 initialTotalPending = core.totalPendingWithdrawals();
        uint256 feeReceiverBalance = core.pendingWithdrawals(feeReceiverAddr);
        
        // Mock transfer failure
        vm.mockCallRevert(
            payable(feeReceiverAddr),
            abi.encodeWithSignature(""),
            abi.encode("")
        );
        
        // Try to withdraw - should revert TransferFailed
        vm.expectRevert(MarketplaceCore.TransferFailed.selector);
        vm.prank(feeReceiverAddr);
        core.withdraw();
        
        // Check totalPendingWithdrawals restored
        assertEq(core.totalPendingWithdrawals(), initialTotalPending);
        assertEq(core.pendingWithdrawals(feeReceiverAddr), feeReceiverBalance);
    }
    
    function testInvariantTotalPendingEqualsSumOfIndividualPending() public {
        // Make multiple sales
        vm.deal(buyer, SALE_PRICE * 2);
        vm.prank(buyer);
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), tokenIds);
        
        // Calculate sum of all pending withdrawals
        uint256 sumPending = 0;
        address[] memory accounts = new address[](3);
        accounts[0] = feeReceiverAddr;
        accounts[1] = seller;
        accounts[2] = makeAddr("other");
        
        for (uint256 i = 0; i < accounts.length; i++) {
            sumPending += core.pendingWithdrawals(accounts[i]);
        }
        
        // Check invariant
        assertEq(core.totalPendingWithdrawals(), sumPending);
    }
    
    function testBidsInvariantBalanceGeTotalPendingPlusEscrow() public {
        // Place bids
        uint128 bidPrice = 0.5 ether;
        vm.deal(bidder, bidPrice * 2);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: bidPrice}(address(nft), 1, bidPrice, 0);
        vm.prank(bidder);
        marketplace.placeCollectionBid{value: bidPrice}(address(nft), uint128(bidPrice), 2, 0);
        
        uint256 totalObligations = bids.totalPendingWithdrawals() + bids.totalBidEscrow();
        uint256 contractBalance = address(bids).balance;
        
        // Check invariant: balance >= totalPendingWithdrawals + totalBidEscrow
        assertGe(contractBalance, totalObligations);
        
        // Force ETH via vm.deal and check invariant still holds
        vm.deal(address(bids), contractBalance + 1 ether);
        uint256 newTotalObligations = bids.totalPendingWithdrawals() + bids.totalBidEscrow();
        uint256 newContractBalance = address(bids).balance;
        
        assertGe(newContractBalance, newTotalObligations);
    }
}