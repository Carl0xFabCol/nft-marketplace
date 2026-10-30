// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

contract AuditNB5SelfPurchaseTest is TestSetup {
    function testNB5_SelfPurchaseRevertsInBuy() public {
        _setupListing();
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testNB5_SelfPurchaseRevertsInBuyBatch() public {
        _setupListing();
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buyBatch{value: SALE_PRICE}(address(nft), tokenIds);
    }
}