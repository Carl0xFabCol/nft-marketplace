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

contract LaunchPadTest is TestSetup {
    LaunchPad public launchPad;

    address public creator = vm.addr(9);

    string constant NAME = "Cool Collection";
    string constant SYMBOL = "COOL";
    string constant BASE_URI = "ipfs://base/";

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

    function _createCollection() internal returns (address collection) {
        vm.prank(creator);
        collection =
            launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), royaltyReceiverAddr, 10, BASE_URI, 0, 0);
    }

    function test_CreateCollection_DeploysAndRecordsCreator() public {
        address collection = _createCollection();

        assertTrue(launchPad.isLaunchpadCollection(collection));
        assertEq(launchPad.getCollectionsCreatedCount(creator), 1);

        address[] memory created = launchPad.getCollectionsCreatedBy(creator);
        assertEq(created.length, 1);
        assertEq(created[0], collection);
    }

    function test_CreateCollection_SetsOwnerAndMetadata() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        assertEq(col.owner(), creator);
        assertEq(col.name(), NAME);
        assertEq(col.symbol(), SYMBOL);
        assertEq(col.maxSupply(), 10);
        assertEq(col.baseURI(), BASE_URI);
    }

    function test_CreateCollection_RegistersInCore() public {
        address collection = _createCollection();

        (address receiver, uint16 royaltyFee,,,, bool exists) = core.collections(collection);
        assertTrue(exists);
        assertEq(receiver, royaltyReceiverAddr);
        assertEq(royaltyFee, uint16(ROYALTY_FEE));
    }

    function test_CreateCollection_DefaultRoyaltyReceiverIsCreator() public {
        vm.prank(creator);
        address collection =
            launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), address(0), 10, BASE_URI, 0, 0);

        MiColeccion col = MiColeccion(collection);
        (address receiver,) = col.royaltyInfo(0, 1 ether);
        assertEq(receiver, creator);
    }

    function test_CreateCollection_RevertsOnExcessiveRoyalty() public {
        vm.prank(creator);
        vm.expectRevert(LaunchPad.FeeTooHigh.selector);
        launchPad.createCollection(NAME, SYMBOL, 2_001, address(0), 10, BASE_URI, 0, 0);
    }

    function test_CreateCollection_RevertsWhenLaunchFeeMismatch() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        vm.prank(creator);
        vm.expectRevert(LaunchPad.InsufficientLaunchFee.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 0);
    }

    function test_CreateCollection_ChargesLaunchFee() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        uint256 balanceBefore = address(launchPad).balance;

        vm.prank(creator);
        launchPad.createCollection{value: 0.01 ether}(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 0);

        assertEq(address(launchPad).balance - balanceBefore, 0.01 ether);
        assertEq(launchPad.accruedFees(), 0.01 ether);
    }

    function test_WithdrawFees() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        vm.prank(creator);
        launchPad.createCollection{value: 0.01 ether}(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 0);

        uint256 ownerBalanceBefore = owner.balance;

        vm.prank(owner);
        launchPad.withdrawFees(payable(owner));

        assertEq(owner.balance - ownerBalanceBefore, 0.01 ether);
        assertEq(launchPad.accruedFees(), 0);
    }

    function test_WithdrawFees_RevertsWhenNoFees() public {
        vm.prank(owner);
        vm.expectRevert(LaunchPad.NoFees.selector);
        launchPad.withdrawFees(payable(owner));
    }

    function test_Pause_BlocksCreation() public {
        vm.prank(owner);
        launchPad.pause();

        vm.prank(creator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 0);
    }

    function test_CreateCollection_RequiresAuthorizedLaunchpad() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), false);

        vm.prank(creator);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 0);
    }

    function test_CreateCollection_CreatorAutoFilledInEvent() public {
        vm.expectEmit(false, true, false, false);
        emit MarketplaceCore.CollectionRegistered(address(0), creator, uint16(ROYALTY_FEE), false);
        vm.prank(creator);
        address collection =
            launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), royaltyReceiverAddr, 10, BASE_URI, 0, 0);
        assertTrue(core.isRegistered(collection));
    }
}

contract AuditPaginationTest is TestSetup {
    LaunchPad internal launchPad;
    address internal creator = vm.addr(9);

    function setUp() public override {
        super.setUp();

        vm.prank(owner);
        launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        launchPad.setLaunchFee(0);

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);

        for (uint256 i; i < 5; ++i) {
            vm.prank(creator);
            launchPad.createCollection("C", "C", 0, address(0), 10, "", 0, 0);
        }
    }

    function testPagination_ReturnsRequestedSlice() public {
        address[] memory all = launchPad.getCollectionsCreatedBy(creator);
        address[] memory page = launchPad.getCollectionsCreatedByPage(creator, 1, 3);

        assertEq(page.length, 3);
        assertEq(page[0], all[1]);
        assertEq(page[1], all[2]);
        assertEq(page[2], all[3]);
    }

    function testPagination_ClampsFinalPage() public {
        address[] memory all = launchPad.getCollectionsCreatedBy(creator);
        address[] memory page = launchPad.getCollectionsCreatedByPage(creator, 3, 10);

        assertEq(page.length, 2);
        assertEq(page[0], all[3]);
        assertEq(page[1], all[4]);
    }

    function testPagination_OutOfRangeAndZeroLimitReturnEmpty() public {
        assertEq(launchPad.getCollectionsCreatedByPage(creator, 5, 1).length, 0);
        assertEq(launchPad.getCollectionsCreatedByPage(creator, 0, 0).length, 0);
    }

    function testPagination_RejectsOversizedPage() public {
        uint256 oversized = launchPad.MAX_PAGE_SIZE() + 1;
        vm.expectRevert(LaunchPad.PageTooLarge.selector);
        launchPad.getCollectionsCreatedByPage(creator, 0, oversized);
    }
}

contract MismatchedLaunchpad {
    IMarketplaceCoreRegistry public immutable core;
    mapping(address => bool) public isLaunchpadCollection;

    constructor(address _core) {
        core = IMarketplaceCoreRegistry(_core);
    }

    function createCollection(address initialOwner) external returns (address collection) {
        collection = address(new MiColeccion("Mismatch", "MM", initialOwner, 0, address(0), 10, "", 0, 0));
        isLaunchpadCollection[collection] = true;
        core.registerCollectionFromLaunchpad(collection, 0, address(this), msg.sender);
    }

    function isCollection(address collection) external view returns (bool) {
        return isLaunchpadCollection[collection];
    }
}

contract AuditNB2Test is TestSetup {
    LaunchPad internal launchPad;
    VerifyDeployment internal verifier;
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

        verifier = new VerifyDeployment();
    }

    function _createCollection() internal returns (MiColeccion collection) {
        vm.prank(creator);
        address deployed = launchPad.createCollection(
            "Launch Collection", "LC", uint16(ROYALTY_FEE), royaltyReceiverAddr, 10, "ipfs://launch/", 0, 0
        );
        collection = MiColeccion(deployed);
    }

    function testNB2_LaunchPadEndToEnd() public {
        MiColeccion collection = _createCollection();

        assertTrue(core.isRegistered(address(collection)));
        assertTrue(core.authorizedLaunchpads(address(launchPad)));
        assertEq(address(launchPad.core()), address(core));

        (address receiver, uint16 royaltyFee,,,, bool exists) = core.collections(address(collection));
        assertTrue(exists);
        assertEq(receiver, royaltyReceiverAddr);
        assertEq(royaltyFee, uint16(ROYALTY_FEE));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        assertEq(collection.ownerOf(1), buyer);
        assertGt(core.pendingWithdrawals(seller), 0);

        verifier.run(address(core), address(bids), address(marketplace), address(launchPad));
    }

    function testNB2_CollectionOwnerMismatchReverts() public {
        MismatchedLaunchpad mismatched = new MismatchedLaunchpad(address(core));

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(mismatched), true);

        vm.prank(creator);
        vm.expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        mismatched.createCollection(unauthorized);
    }

    function testNB2_VerifierRejectsUnauthorizedLaunchpad() public {
        LaunchPad unverified = new LaunchPad(address(core));

        vm.expectRevert("R-5: launchpad not authorized");
        verifier.run(address(core), address(bids), address(marketplace), address(unverified));
    }
}
