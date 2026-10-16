// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TestSetup.sol";
import {LaunchPad} from "../src/LaunchPad.sol";
import {MiColeccion} from "../src/MERC721.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
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
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);
    }

    function _createCollection() internal returns (address collection) {
        vm.prank(creator);
        collection = launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), royaltyReceiverAddr, 10, BASE_URI);
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

        (address receiver, uint16 royaltyFee, , , , bool exists) = core.collections(collection);
        assertTrue(exists);
        assertEq(receiver, royaltyReceiverAddr);
        assertEq(royaltyFee, uint16(ROYALTY_FEE));
    }

    function test_CreateCollection_DefaultRoyaltyReceiverIsCreator() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), address(0), 10, BASE_URI);

        MiColeccion col = MiColeccion(collection);
        (address receiver, ) = col.royaltyInfo(0, 1 ether);
        assertEq(receiver, creator);
    }

    function test_CreateCollection_RevertsOnExcessiveRoyalty() public {
        vm.prank(creator);
        vm.expectRevert(LaunchPad.FeeTooHigh.selector);
        launchPad.createCollection(NAME, SYMBOL, 2_001, address(0), 10, BASE_URI);
    }

    function test_CreateCollection_RevertsWhenLaunchFeeMismatch() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        vm.prank(creator);
        vm.expectRevert(LaunchPad.InsufficientLaunchFee.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI);
    }

    function test_CreateCollection_ChargesLaunchFee() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        uint256 balanceBefore = address(launchPad).balance;

        vm.prank(creator);
        launchPad.createCollection{value: 0.01 ether}(NAME, SYMBOL, 0, address(0), 10, BASE_URI);

        assertEq(address(launchPad).balance - balanceBefore, 0.01 ether);
        assertEq(launchPad.accruedFees(), 0.01 ether);
    }

    function test_WithdrawFees() public {
        vm.prank(owner);
        launchPad.setLaunchFee(0.01 ether);

        vm.prank(creator);
        launchPad.createCollection{value: 0.01 ether}(NAME, SYMBOL, 0, address(0), 10, BASE_URI);

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

    function test_Mint_ByCreator() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        uint256 tokenId = col.mint(creator);

        assertEq(tokenId, 0);
        assertEq(col.ownerOf(0), creator);
        assertEq(col.totalSupply(), 1);
    }

    function test_Mint_RevertsForNonOwner() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, unauthorized)
        );
        col.mint(unauthorized);
    }

    function test_Mint_RevertsWhenMaxSupplyReached() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 2, BASE_URI);
        MiColeccion col = MiColeccion(collection);

        vm.startPrank(creator);
        col.mint(creator);
        col.mint(creator);

        vm.expectRevert(MiColeccion.MaxSupplyExceeded.selector);
        col.mint(creator);
        vm.stopPrank();
    }

    function test_BatchMint_RespectsMaxSupply() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 3, BASE_URI);
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        vm.expectRevert(MiColeccion.MaxSupplyExceeded.selector);
        col.batchMint(creator, 4);
    }

    function test_TokenURI_UsesBaseURI() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        col.mint(creator);

        assertEq(col.tokenURI(0), string(abi.encodePacked(BASE_URI, "0")));
    }

    function test_SetBaseURI_OnlyOwner() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        col.setBaseURI("ipfs://new/");

        assertEq(col.baseURI(), "ipfs://new/");
    }

    function test_Pause_BlocksCreation() public {
        vm.prank(owner);
        launchPad.pause();

        vm.prank(creator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI);
    }

    function test_CreateCollection_RequiresAuthorizedLaunchpad() public {
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), false);

        vm.prank(creator);
        vm.expectRevert(MarketplaceCore.Unauthorized.selector);
        launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI);
    }

    function test_CreateCollection_CreatorAutoFilledInEvent() public {
        vm.prank(creator);
        vm.expectEmit(false, true, false, false);
        emit MarketplaceCore.CollectionRegistered(address(0), creator, uint16(ROYALTY_FEE), false);
        launchPad.createCollection(NAME, SYMBOL, uint16(ROYALTY_FEE), royaltyReceiverAddr, 10, BASE_URI);
    }
}
