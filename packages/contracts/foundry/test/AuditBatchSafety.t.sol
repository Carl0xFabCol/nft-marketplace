// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice L-01: duplicate token ids must be rejected explicitly in buyBatch.
contract AuditBatchSafetyTest is TestSetup {
    function testL01_BuyBatchRejectsDuplicateTokenIds() public {
        _setupListing();

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.DuplicateTokenId.selector);
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), ids);
    }
}
