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

contract HypercTest is TestSetup {
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

    function test_Mint_ByCreator() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        uint256 tokenId = col.mint(creator);

        assertEq(tokenId, 1);
        assertEq(col.ownerOf(1), creator);
        assertEq(col.totalSupply(), 1);
    }

    function test_Mint_IsPublic() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(unauthorized);
        uint256 tokenId = col.mint(unauthorized);

        assertEq(tokenId, 1);
        assertEq(col.ownerOf(1), unauthorized);
    }

    function test_Mint_RequiresConfiguredPrice() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0.01 ether, 0);
        MiColeccion col = MiColeccion(collection);

        vm.prank(unauthorized);
        vm.expectRevert(MiColeccion.InsufficientPayment.selector);
        col.mint(unauthorized);

        vm.prank(unauthorized);
        col.mint{value: 0.01 ether}(unauthorized);
        assertEq(col.ownerOf(1), unauthorized);
    }

    function test_Mint_RevertsAfterDuration() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 10, BASE_URI, 0, 1 days);
        MiColeccion col = MiColeccion(collection);

        assertTrue(col.isMintActive());
        assertEq(col.mintEndsAt(), block.timestamp + 1 days);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(creator);
        vm.expectRevert(MiColeccion.MintEnded.selector);
        col.mint(creator);
    }

    function test_Mint_UnlimitedSupplyAndEternalDuration() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 0, BASE_URI, 0, 0);
        MiColeccion col = MiColeccion(collection);

        assertEq(col.maxSupply(), 0);
        assertEq(col.mintEndsAt(), 0);
        assertTrue(col.isMintActive());

        vm.prank(creator);
        col.batchMint(creator, 3);
        assertEq(col.totalSupply(), 3);
        assertEq(col.getNextTokenId(), 4);
    }

    function test_Mint_RevertsWhenMaxSupplyReached() public {
        vm.prank(creator);
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 2, BASE_URI, 0, 0);
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
        address collection = launchPad.createCollection(NAME, SYMBOL, 0, address(0), 3, BASE_URI, 0, 0);
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

        assertEq(col.tokenURI(1), string(abi.encodePacked(BASE_URI, "1")));
    }

    function test_SetBaseURI_OnlyOwner() public {
        address collection = _createCollection();
        MiColeccion col = MiColeccion(collection);

        vm.prank(creator);
        col.setBaseURI("ipfs://new/");

        assertEq(col.baseURI(), "ipfs://new/");
    }
}
