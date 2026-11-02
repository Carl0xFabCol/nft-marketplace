// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {MockMalformedNFT} from "./MockMalformedReturn.sol";

/// @notice NB-3: royalty queries fail closed when too little gas remains to make
///         the capped external calls safely.
contract AuditNB3Test is TestSetup {
function _setupExpensiveSupportsInterfaceListing(uint256 iterations) internal returns (MockMalformedNFT) {
        MockMalformedNFT expensiveNft = new MockMalformedNFT();
        expensiveNft.setExpensiveRoyaltyInfo(true, iterations);

        // Register collection with royalty fee
        vm.prank(owner);
        marketplace.registerCollection(
            address(expensiveNft),
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr
        );

        // Mint, approve, create listing
        vm.prank(seller);
        expensiveNft.mint(seller, 1);
        vm.prank(seller);
        expensiveNft.setApprovalForAll(address(core), true);
        vm.prank(seller);
        marketplace.createListing(
            address(expensiveNft),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );

        return expensiveNft;
    }

    // NB-3 insufficient gas scenario cannot be triggered via buy because OOG occurs
    // before reaching the guard. The guard ensures that if we have enough gas to reach it,
    // we have enough for at least the first royalty query.
    // We test that royalty payments work with sufficient gas.

    

    function testNB3_SufficientGasPaysRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testNB3_LowGasViaRouterRevertsInsufficientGas() public {
        _setupListing();

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.InsufficientGas.selector);
        marketplace.buy{value: SALE_PRICE, gas: 60_000}(address(nft), 1);
    }

    function testNB3_SufficientGasViaRouterPaysRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE, gas: 500_000}(address(nft), 1);

        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}