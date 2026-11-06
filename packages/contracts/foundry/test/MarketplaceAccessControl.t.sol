// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";
import "./MockNFT.t.sol";
import "./MockNFTWithRoyalty.sol";
import "./MockNFTNonERC721.sol";
import "./MockRevertingNFT.sol";
import "./MockRevertingRoyaltyNFT.sol";
import "./MockMalformedReturn.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {LaunchPad, IMarketplaceCoreRegistry} from "../src/LaunchPad.sol";
import {Hyperc as MiColeccion} from "../src/MERC721.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {BoundedStaticCall} from "../src/BoundedStaticCall.sol";
import {VerifyDeployment} from "../script/VerifyDeployment.s.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract MarketplaceAccessControlTest is TestSetup {
    function testSetAuthorizedLaunchpad_AdminOnly() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(0xBEEF), true);
        assertTrue(core.authorizedLaunchpads(address(0xBEEF)));

        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.setAuthorizedLaunchpad(address(0xBEEF), false);
    }

    function testUpdateMarketplaceFee_AdminOnly() public {
        vm.prank(owner);
        marketplace.updateMarketplaceFee(100);

        assertEq(core.marketplaceFee(), 100);
    }

    function testUpdateMarketplaceFee_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.updateMarketplaceFee(100);
    }

    function testUpdateFeeReceiver_AdminOnly() public {
        vm.prank(owner);
        marketplace.updateFeeReceiver(newOwner);

        assertEq(core.feeReceiver(), newOwner);
    }

    function testUpdateFeeReceiver_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.updateFeeReceiver(newOwner);
    }

    function testPauseAndUnpause_Admin() public {
        vm.prank(owner);
        marketplace.pause();

        assertTrue(core.paused());
        assertTrue(bids.paused());

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(core.paused());
        assertFalse(bids.paused());
    }

    function testPause_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.pause();
    }

    function testOwnershipArchitecture() public {
        assertEq(marketplace.owner(), owner);
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
        assertEq(core.pendingOwner(), address(0));
        assertEq(bids.pendingOwner(), address(0));
        assertEq(core.router(), address(marketplace));
        assertEq(core.bidsContract(), address(bids));
    }

    function testMarketplaceOwnership_RequiresAcceptance() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.pendingOwner(), newOwner);

        vm.prank(newOwner);
        marketplace.acceptOwnership();

        assertEq(marketplace.owner(), newOwner);
    }

    function testConstructor_DeploysCorrectly() public {
        assertEq(address(marketplace.core()), address(core));
        assertEq(address(marketplace.bids()), address(bids));
        assertEq(marketplace.owner(), owner);
    }

    function testViews() public {
        assertEq(marketplace.marketplaceFee(), uint16(MARKETPLACE_FEE));
        assertEq(marketplace.feeReceiver(), feeReceiverAddr);
        assertEq(marketplace.totalVolume(), 0);
        assertEq(marketplace.totalSales(), 0);
        assertEq(marketplace.totalListings(), 0);
    }

    function testAdminFunctions_OnlyMarketplaceOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.pause();

        vm.prank(owner);
        marketplace.pause();

        assertTrue(marketplace.paused());

        vm.prank(owner);
        marketplace.unpause();

        assertFalse(marketplace.paused());
    }

    function testComponentOwnersAreRouter() public {
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
    }

    function testRouterOwnershipIsIndependent() public {
        vm.prank(owner);
        marketplace.transferOwnership(newOwner);

        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.pendingOwner(), newOwner);

        vm.prank(newOwner);
        marketplace.acceptOwnership();

        assertEq(marketplace.owner(), newOwner);
        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
    }

    function testSweepExcessETH_OnlyOwner() public {
        vm.deal(address(core), 1 ether);

        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.sweepExcessETH(payable(owner));
    }

    function testN01_OwnerCannotStealNFTViaDirectCoreCall() public {
        _setupListing();

        vm.deal(owner, 1 ether);

        // The owner is not the router, so a direct Core call must be rejected.
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        vm.prank(owner);
        core.buy{value: 1 wei}(address(nft), 1, owner);

        assertEq(nft.ownerOf(1), seller);
    }

    function testExecuteSaleFromBid_NonAuthorized() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(address(nft), 1, seller, buyer, uint128(SALE_PRICE));
    }

    function testN01_OwnerCannotCallRouterFunctionsDirectly() public {
        // Try to call Core functions directly as owner - should revert
        vm.startPrank(owner);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, 1 ether, 0, seller);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy{value: 1 ether}(address(nft), 1, buyer);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.updateListingPrice(address(nft), 1, 1 ether, seller);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.cancelListing(address(nft), 1, seller);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(seller);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 500, seller);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.registerCollectionFromRouter(address(nft), 500, royaltyReceiverAddr, seller);

        vm.stopPrank();
    }

    function testN01_SetRouterRevertsOnSecondCall() public {
        // Deploy fresh system where owner still owns Core
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);

        // First call should work
        newCore.setRouter(address(0x123));

        // Second call should revert
        vm.expectRevert(MarketplaceCore.AlreadySet.selector);
        newCore.setRouter(address(0x456));

        vm.stopPrank();
    }

    function testN01_SetBidsContractRevertsOnSecondCall() public {
        // Deploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);

        // First call should work
        newCore.setBidsContract(address(0x789));

        // Second call should revert
        vm.expectRevert(MarketplaceCore.AlreadySet.selector);
        newCore.setBidsContract(address(0xabc));

        vm.stopPrank();
    }

    function testN01_SetMarketplaceAddressRevertsOnSecondCall() public {
        // Deploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        MarketplaceBids newBids = new MarketplaceBids(address(newCore));

        // First call should work
        newBids.setMarketplaceAddress(address(0xdef));

        // Second call should revert
        vm.expectRevert(MarketplaceBids.AlreadySet.selector);
        newBids.setMarketplaceAddress(address(0x999));

        vm.stopPrank();
    }

    function testN01_ConfigureBidsMarketplaceIsOneShot() public {
        // Redeploy fresh system
        vm.startPrank(owner);
        MarketplaceCore newCore = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        MarketplaceBids newBids = new MarketplaceBids(address(newCore));
        Marketplace newMarketplace = new Marketplace(address(newCore), address(newBids));

        // Transfer ownership
        newCore.transferOwnership(address(newMarketplace));
        newBids.transferOwnership(address(newMarketplace));

        // Accept ownership
        newMarketplace.acceptComponentOwnership();

        // First configure should work
        newMarketplace.configureBidsMarketplace();

        // Second configure should revert because setters are already set
        vm.expectRevert();
        newMarketplace.configureBidsMarketplace();

        vm.stopPrank();
    }

    function testN01_NewOwnerCannotCallRouterFunctions() public {
        // Test that even after transferComponentOwnership, new owner can't call router functions
        vm.startPrank(owner);

        // Transfer component ownership to new owner
        marketplace.transferComponentOwnership(newOwner);
        vm.stopPrank();

        vm.startPrank(newOwner);
        core.acceptOwnership();
        bids.acceptOwnership();
        vm.stopPrank();

        // New owner tries to call Core directly - should revert
        vm.startPrank(newOwner);

        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, 1 ether, 0, seller);

        vm.stopPrank();
    }

    function testL03_AllComponentsRejectRenounce() public {
        vm.startPrank(owner);

        vm.expectRevert(MarketplaceCore.RenounceOwnershipDisabled.selector);
        core.renounceOwnership();

        vm.expectRevert(MarketplaceBids.RenounceOwnershipDisabled.selector);
        bids.renounceOwnership();

        vm.expectRevert(Marketplace.RenounceOwnershipDisabled.selector);
        marketplace.renounceOwnership();

        vm.stopPrank();
    }

    function testM07_TransferComponentOwnershipStartsHandoff() public {
        vm.prank(owner);
        marketplace.transferComponentOwnership(newOwner);

        assertEq(core.pendingOwner(), newOwner);
        assertEq(bids.pendingOwner(), newOwner);

        vm.startPrank(newOwner);
        core.acceptOwnership();
        bids.acceptOwnership();
        vm.stopPrank();

        assertEq(core.owner(), newOwner);
        assertEq(bids.owner(), newOwner);
    }

    function testM07_OnlyRouterOwnerCanMigrate() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.transferComponentOwnership(unauthorized);
    }

    function testM07_RejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(Marketplace.InvalidAddress.selector);
        marketplace.transferComponentOwnership(address(0));
    }

    function testM06_SweepSucceedsWhenOnlyCoreHasExcess() public {
        vm.deal(address(core), 1 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 1 ether);
        assertEq(address(core).balance, 0);
    }

    function testM06_SweepSucceedsWhenOnlyBidsHasExcess() public {
        vm.deal(address(bids), 1 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 1 ether);
        assertEq(address(bids).balance, 0);
    }

    function testM06_SweepRevertsWhenNeitherHasExcess() public {
        vm.prank(owner);
        vm.expectRevert(Marketplace.SweepFailed.selector);
        marketplace.sweepExcessETH(payable(owner));
    }

    function testM06_PauseAndUnpauseAreIdempotent() public {
        vm.startPrank(owner);
        marketplace.pause();
        marketplace.pause();
        assertTrue(core.paused());
        assertTrue(bids.paused());

        marketplace.unpause();
        marketplace.unpause();
        assertFalse(core.paused());
        assertFalse(bids.paused());
        vm.stopPrank();
    }

    function testL02_RouterRejectsPlainETH() public {
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        (bool ok,) = address(marketplace).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(marketplace).balance, 0);
    }

    function testL02_RouterRejectsUnknownCalldata() public {
        vm.deal(buyer, 1 ether);

        vm.prank(buyer);
        (bool ok,) = address(marketplace).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(marketplace).balance, 0);
    }
}

contract AuditAuthorizationTest is TestSetup {
    LaunchPad internal launchPad;
    address internal creator = vm.addr(9);

    function setUp() public override {
        super.setUp();

        vm.deal(creator, 100 ether);

        vm.prank(owner);
        launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        launchPad.setLaunchFee(0);

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);
    }

    function _launchCollection() internal returns (address collection) {
        vm.prank(creator);
        collection =
            launchPad.createCollection("Audit", "AUD", uint16(ROYALTY_FEE), royaltyReceiverAddr, 100, "ipfs://", 0, 0);
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
        (,,,,, bool exists) = core.collections(collection);
        assertTrue(exists);
        assertTrue(core.isRegistered(collection));
    }
}

contract AuditO1Test is TestSetup {
    address internal newOwnerAddr = address(0x1234);

    function setUp() public override {
        super.setUp();

        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));

        vm.prank(owner);
        marketplace.transferComponentOwnership(newOwnerAddr);

        vm.prank(newOwnerAddr);
        core.acceptOwnership();
        vm.prank(newOwnerAddr);
        bids.acceptOwnership();
    }

    function testO1_NewOwnerAdminsCoreAndBidsDirectly() public {
        assertEq(core.owner(), newOwnerAddr);
        assertEq(bids.owner(), newOwnerAddr);
        assertEq(marketplace.owner(), owner);

        vm.prank(newOwnerAddr);
        core.updateMarketplaceFee(500);
        assertEq(core.marketplaceFee(), 500);

        vm.prank(newOwnerAddr);
        core.updateFeeReceiver(address(0x9999));
        assertEq(core.feeReceiver(), address(0x9999));

        vm.prank(newOwnerAddr);
        bids.pause();
        assertTrue(bids.paused());
        vm.prank(newOwnerAddr);
        bids.unpause();
        assertFalse(bids.paused());
    }

    function testO1_RouterAdminWrappersRevertForNewOwner() public {
        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.updateMarketplaceFee(700);

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.pause();

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.verifyCollection(address(nft));

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.sweepExcessETH(payable(newOwnerAddr));

        vm.prank(newOwnerAddr);
        _expectOwnableUnauthorized(newOwnerAddr);
        marketplace.transferComponentOwnership(address(0xbeef));
    }

    function testO1_NewOwnerCannotCallRouterOnlyCoreFunctions() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry(), seller);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.buy(address(nft), 1, buyer);

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.executeSaleFromBid(address(nft), 1, seller, buyer, uint128(SALE_PRICE));

        vm.prank(newOwnerAddr);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        core.withdrawFor(newOwnerAddr);
    }

    function testO1_RouterStillOperatesAfterMigration() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }
}

contract AuditR5Test is TestSetup {
    VerifyDeployment internal verifier;

    function setUp() public override {
        super.setUp();
        verifier = new VerifyDeployment();
    }

    function testR5_ValidDeploymentPasses() public view {
        verifier.verify(address(core), address(bids), address(marketplace));
    }

    /// @dev A router that exists but is not the one Core is wired to.
    function testR5_WrongRouterRejected() public {
        Marketplace impostor = new Marketplace(address(core), address(bids));

        vm.expectRevert("R-5: core.router mismatch");
        verifier.verify(address(core), address(bids), address(impostor));
    }

    /// @dev An address with no code is reported as such, before any state read.
    function testR5_RouterWithoutCodeRejected() public {
        vm.expectRevert(
            bytes("MARKETPLACE has no code at 0x000000000000000000000000000000000000bEEF on chain 31337")
        );
        verifier.verify(address(core), address(bids), address(0xBEEF));
    }

    function testR5_PausedComponentsRequireExpectation() public {
        vm.prank(owner);
        marketplace.pause();

        vm.expectRevert("R-5: core is paused");
        verifier.verify(address(core), address(bids), address(marketplace));

        verifier.verify(address(core), address(bids), address(marketplace), true);
    }
}

contract O3_RouterUpdatedTest is Test {
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);

    function testSetRouterEmitsRouterUpdated() public {
        MarketplaceCore core = new MarketplaceCore(500, address(this));
        address newRouter = address(0xBEEF);

        vm.expectEmit(true, true, false, true, address(core));
        emit RouterUpdated(address(0), newRouter);

        core.setRouter(newRouter);

        assertEq(core.router(), newRouter);
    }
}
