// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {LaunchPad} from "../src/LaunchPad.sol";

/// @notice H-02: authorized launchpads must not inherit router/bids privileges.
contract AuditAuthorizationTest is TestSetup {
    LaunchPad internal launchPad;
    address internal creator = vm.addr(9);

    function setUp() public override {
        super.setUp();

        vm.deal(creator, 100 ether);

        vm.prank(owner);
        launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);
    }

    function _launchCollection() internal returns (address collection) {
        vm.prank(creator);
        collection = launchPad.createCollection(
            "Audit",
            "AUD",
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr,
            100,
            "ipfs://",
            0,
            0
        );
    }

    function testH02_LaunchpadCannotExecuteSaleFromBid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(address(nft), 1, seller, buyer, uint128(SALE_PRICE));
    }

    function testH02_LaunchpadCannotCreateListing() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), 0, seller);
    }

    function testH02_LaunchpadCannotBuy() public {
        _setupListing();

        vm.deal(address(launchPad), SALE_PRICE);
        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy{value: SALE_PRICE}(address(nft), 1, buyer);
    }

    function testH02_LaunchpadCannotWithdrawFor() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(seller);
    }

    function testH02_LaunchpadCannotUseRouterRegistration() public {
        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.registerCollectionFromRouter(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr, creator);
    }

    function testH02_LaunchpadCannotRegisterExistingCollection() public {
        address collection = _launchCollection();

        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.CollectionAlreadyRegistered.selector);
        core.registerCollectionFromLaunchpad(collection, uint16(ROYALTY_FEE), newOwner, creator);
    }

    function testH02_LaunchpadCannotRegisterForeignCollection() public {
        // A collection not deployed by the launchpad, but whose owner matches
        // the supplied creator, must still be rejected by the factory hook.
        _mintNFT(seller, 1);

        vm.prank(address(launchPad));
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        core.registerCollectionFromLaunchpad(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr, owner);
    }

    function testL07_WithdrawForIsRouterOnly() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(seller);

        uint256 before = seller.balance;
        vm.prank(seller);
        marketplace.withdraw();
        assertGt(seller.balance, before);
    }

    function testH02_LaunchpadCanOnlyRegisterOwnLaunch() public {
        address collection = _launchCollection();
        (, , , , , bool exists) = core.collections(collection);
        assertTrue(exists);
        assertTrue(core.isRegistered(collection));
    }
}
