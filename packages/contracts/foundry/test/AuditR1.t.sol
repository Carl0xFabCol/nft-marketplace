// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/MarketplaceCore.sol";

contract MarketplaceCoreAccountingHarness is MarketplaceCore {
    constructor() MarketplaceCore(0, address(this)) {}

    function setTotalListings(uint256 value) external {
        totalListings = value;
    }

    function setTotalPendingWithdrawals(uint256 value) external {
        totalPendingWithdrawals = value;
    }

    function setPendingWithdrawal(address account, uint256 value) external {
        pendingWithdrawals[account] = value;
    }

    function setListing(address collection, uint256 tokenId, address seller, uint128 price) external {
        listings[collection][tokenId] = Listing({
            seller: seller,
            price: price,
            listedAt: uint48(block.timestamp),
            expiresAt: uint48(block.timestamp + 1 days),
            feeBps: 0,
            royaltyBps: 0
        });
    }

    function cancelListingTest(address collection, uint256 tokenId, address seller) external {
        _cancelListing(collection, tokenId, seller);
    }

    function withdrawTest(address account) external {
        _withdraw(account);
    }
}

/// @notice R-1: accounting counters must revert on underflow instead of wrapping.
contract AuditR1Test is Test {
    MarketplaceCoreAccountingHarness internal harness;

    function setUp() public {
        harness = new MarketplaceCoreAccountingHarness();
    }

    function testR1_TotalListingsUnderflowReverts() public {
        harness.setTotalListings(0);
        harness.setListing(address(0x1234), 1, address(0x5678), 1 ether);

        vm.expectRevert(stdError.arithmeticError);
        harness.cancelListingTest(address(0x1234), 1, address(0x5678));
    }

    function testR1_TotalPendingWithdrawalsUnderflowReverts() public {
        address account = address(0x5678);
        harness.setTotalPendingWithdrawals(0);
        harness.setPendingWithdrawal(account, 1 ether);

        vm.expectRevert(stdError.arithmeticError);
        harness.withdrawTest(account);
    }
}
