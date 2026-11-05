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

contract OwnerQueryHarness is MarketplaceCore {
    constructor() MarketplaceCore(0, address(this)) {}

    function tryOwnerOf(address collection, uint256 tokenId)
        external
        view
        returns (bool valid, bool reverted, address tokenOwner)
    {
        return _tryOwnerOf(collection, tokenId);
    }
}

contract AuditF2Test is TestSetup {
    MockMalformedNFT internal malformed;
    OwnerQueryHarness internal ownerHarness;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        ownerHarness = new OwnerQueryHarness();
    }

    function _listToken() internal {
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function _assertListingSurvives() internal view {
        (address listingSeller, uint128 listingPrice,,,,) = core.listings(address(malformed), 1);
        assertEq(listingSeller, seller);
        assertEq(listingPrice, SALE_PRICE);
        assertEq(core.totalListings(), 1);
    }

    function testF2_GasBurningOwnerOfListingSurvivesClean() public {
        _listToken();
        malformed.setOwnerOfGasBurn(10_000);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testF2_CustomErrorOwnerOfIsCleaned() public {
        _listToken();
        malformed.setOwnerOfRevertMode(1);

        marketplace.cleanStaleListing(address(malformed), 1);

        (address listingSeller, uint128 listingPrice,,,,) = core.listings(address(malformed), 1);
        assertEq(listingSeller, address(0));
        assertEq(listingPrice, 0);
        assertEq(core.totalListings(), 0);
    }

    function testF2_EmptyDataOwnerOfListingSurvives() public {
        _listToken();
        malformed.setOwnerOfRevertMode(2);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testF2_LowGasRevertsInsufficientGas() public {
        vm.expectRevert(MarketplaceCore.InsufficientGas.selector);
        ownerHarness.tryOwnerOf{gas: 10_000}(address(malformed), 1);
    }
}

contract AuditF3Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);
    }

    function _listToken() internal {
        vm.prank(seller);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testF3_CreateListingMalformedOwnerOfRevertsNotTokenOwner() public {
        malformed.setMalformedOwnerOfMode(true, uint256(uint160(seller)), 1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testF3_CreateListingRevertingOwnerOfRevertsNotTokenOwner() public {
        malformed.setOwnerOfRevertMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testF3_ExecuteSaleFromBidMalformedOwnerOfRevertsNotTokenOwner() public {
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(malformed), 1, uint128(SALE_PRICE), 0);

        malformed.setMalformedOwnerOfMode(true, uint256(uint160(seller)), 1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptTokenBid(address(malformed), 1, bidder, 0, 0);
    }

    function testF3_ExecuteSaleFromBidRevertingOwnerOfRevertsNotTokenOwner() public {
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(malformed), 1, uint128(SALE_PRICE), 0);

        malformed.setOwnerOfRevertMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.acceptTokenBid(address(malformed), 1, bidder, 0, 0);
    }
}

contract AuditF4Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);
    }

    function testF4_GasBurningIsApprovedForAllFailsClosed() public {
        malformed.setIsApprovedForAllGasBurn(30_000);

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 500_000);
    }
}

contract AuditLN2Test is TestSetup {
    MockMalformedNFT internal malformed;
    MockMalformedFactory internal factory;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
        factory = new MockMalformedFactory();
    }

    function _registerMalformed() internal {
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function _listMalformedToken() internal {
        _registerMalformed();
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testLN2_MalformedSupportsInterfaceRejected() public {
        malformed.setMalformedSupportsInterface(true);

        vm.prank(owner);
        vm.expectRevert(MarketplaceCore.InvalidCollection.selector);
        marketplace.registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testLN2_MalformedOwnerOfTreatedAsStale() public {
        _listMalformedToken();

        malformed.setMalformedOwnerOf(true, (uint256(1) << 160) | 1);

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);
    }

    function testLN2_MalformedGetApprovedTreatedAsNotApproved() public {
        _registerMalformed();
        malformed.mint(seller, 1);
        malformed.setMalformedGetApproved(true);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testLN2_MalformedIsApprovedForAllTreatedAsNotApproved() public {
        _registerMalformed();
        malformed.mint(seller, 1);
        malformed.setMalformedIsApprovedForAll(true);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testLN2_MalformedCollectionOwnerRejected() public {
        _registerMalformed();
        malformed.setMalformedOwner(true);

        vm.expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        marketplace.updateCollectionRoyalty(address(malformed), royaltyReceiverAddr, uint16(ROYALTY_FEE));
    }

    function testLN2_MalformedRoyaltyInfoFallsBackToCollectionRoyalty() public {
        address tokenRoyaltyReceiver = address(0xB0B);
        malformed.setTokenRoyalty(1, tokenRoyaltyReceiver, uint96(ROYALTY_FEE));
        _listMalformedToken();

        malformed.setMalformedRoyaltyInfo(true);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(tokenRoyaltyReceiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testLN2_MalformedFactoryCheckRejected() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(factory), true);

        factory.setMalformedIsCollection(true);

        vm.expectRevert(MarketplaceCore.InvalidCollection.selector);
        factory.register(address(core), address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr, address(this));
    }

    function testLN2_MalformedOwnerOfDoesNotBlockBid() public {
        _registerMalformed();
        malformed.mint(seller, 1);

        malformed.setMalformedOwnerOf(true, (uint256(1) << 160) | uint160(bidder));

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(malformed), 1, uint128(SALE_PRICE), 0);

        assertEq(bids.totalBidEscrow(), SALE_PRICE);
    }
}

contract BoundedStaticCallHarness is BoundedStaticCall {
    // expose internal functions for testing
    function exposedStaticcallBounded(address target, bytes memory callData, uint256 gasLimit)
        public
        view
        returns (bool ok, uint256 word)
    {
        return _staticcallBounded(target, callData, gasLimit);
    }

    function exposedStaticcallBounded2(address target, bytes memory callData, uint256 gasLimit)
        public
        view
        returns (bool ok, uint256 word0, uint256 word1)
    {
        return _staticcallBounded2(target, callData, gasLimit);
    }

    function exposedStaticcallBoundedRaw(address target, bytes memory callData)
        public
        view
        returns (bool success, bool valid, uint256 word)
    {
        uint256 status;
        (status, word) = _staticcallBoundedRaw(target, callData, 50_000);
        success = (status & 1) != 0;
        valid = (status & 2) != 0;
    }

    function exposedIsAddressWord(uint256 word) public pure returns (bool) {
        return _isAddressWord(word);
    }
}

contract AuditGasHelpersTest is Test {
    BoundedStaticCallHarness internal harness;
    MockMalformedNFT internal mock;

    function setUp() public {
        harness = new BoundedStaticCallHarness();
        mock = new MockMalformedNFT();
    }

    function test_SingleWord_OOG() public {
        mock.setExpensiveRoyaltyInfo(true, 5_000); // will burn gas
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 10_000);
        assertFalse(ok);
        assertEq(word, 0);
    }

    function test_SingleWord_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 50_000);
        assertFalse(ok);
        assertEq(word, 0);
    }

    function test_SingleWord_ValidReturn() public {
        mock.setMalformedOwner(false);
        bytes memory callData = abi.encodeWithSelector(mock.owner.selector);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 50_000);
        assertTrue(ok);
        // owner returns address (single word)
        assertEq(word, uint256(uint160(address(mock.owner()))));
    }

    function test_DoubleWord_OOG() public {
        mock.setExpensiveRoyaltyInfo(true, 5_000);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 10_000);
        assertFalse(ok);
        assertEq(word0, 0);
        assertEq(word1, 0);
    }

    function test_DoubleWord_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 50_000);
        assertFalse(ok);
        assertEq(word0, 0);
        assertEq(word1, 0);
    }

    function test_DoubleWord_ValidReturn() public {
        mock.setTokenRoyalty(1, address(0x123), 500);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 50_000);
        assertTrue(ok);
        assertTrue(word0 != 0 || word1 != 0);
    }

    function test_Raw_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool success, bool valid, uint256 word) = harness.exposedStaticcallBoundedRaw(address(mock), callData);
        assertTrue(success);
        assertFalse(valid);
        assertEq(word, 0);
    }

    function test_Raw_ValidReturn() public {
        // Use owner() which returns a single address
        bytes memory callData = abi.encodeWithSelector(mock.owner.selector);
        (bool success, bool valid, uint256 word) = harness.exposedStaticcallBoundedRaw(address(mock), callData);
        assertTrue(success);
        assertTrue(valid);
        // owner returns address (single word)
        assertEq(word, uint256(uint160(address(mock.owner()))));
    }

    function test_IsAddressWord() public {
        uint256 max160 = type(uint160).max;
        assertTrue(harness.exposedIsAddressWord(0));
        assertTrue(harness.exposedIsAddressWord(max160));
        assertFalse(harness.exposedIsAddressWord(max160 + 1));
        assertFalse(harness.exposedIsAddressWord(type(uint256).max));
    }
}

contract AuditCustomErrorsTest is TestSetup {
    function testG08_RouterConstructorUsesCustomError() public {
        vm.expectRevert(Marketplace.InvalidAddress.selector);
        new Marketplace(address(0), address(bids));
    }

    function testG08_CoreFallbackUsesCustomError() public {
        (bool ok, bytes memory data) = address(core).call(hex"deadbeef");
        assertFalse(ok);
        assertEq(bytes4(data), MarketplaceCore.InvalidCall.selector);
    }

    function testG08_BidsCorePausedUsesCustomError() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(address(marketplace));
        core.pause();

        vm.prank(bidder);
        _expectRevert(MarketplaceBids.CorePaused.selector);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
    }
}
