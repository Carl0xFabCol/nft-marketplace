// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice G-05: batch sizes are bounded to keep duplicate checks cheap.
contract AuditBatchCapTest is TestSetup {
    function testG05_BuyBatchRejectsTooManyTokens() public {
        uint256[] memory ids = new uint256[](51);
        for (uint256 i; i < 51; ++i) {
            ids[i] = i + 1;
        }

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.BatchTooLarge.selector);
        marketplace.buyBatch{value: 0}(address(nft), ids);
    }

    function testG05_TokenBidBatchRejectsTooManyTokens() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        uint256[] memory ids = new uint256[](51);
        uint128[] memory prices = new uint128[](51);
        uint64[] memory expiries = new uint64[](51);
        for (uint256 i; i < 51; ++i) {
            ids[i] = i + 1;
            prices[i] = 1 wei;
        }

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.BatchTooLarge.selector);
        marketplace.placeTokenBidBatch{value: 51 wei}(address(nft), ids, prices, expiries);
    }
}
