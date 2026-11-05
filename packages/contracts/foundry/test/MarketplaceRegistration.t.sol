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

contract MarketplaceRegistrationTest is TestSetup {
    function testRegisterCollection_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (address receiver, uint16 fee,,,, bool exists) = core.collections(address(nft));

        assertEq(receiver, royaltyReceiverAddr);
        assertEq(fee, ROYALTY_FEE);
        assertTrue(exists);
    }

    function testRegisterCollection_ExternalCreatorAutoFilled() public {
        vm.expectEmit(false, true, false, false);
        emit MarketplaceCore.CollectionRegistered(address(0), owner, uint16(ROYALTY_FEE), false);
        vm.prank(owner);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (address receiver, uint16 fee,,,, bool exists) = core.collections(address(nft));
        assertTrue(exists);
        assertEq(fee, ROYALTY_FEE);
        assertEq(receiver, royaltyReceiverAddr);
    }

    function testRegisterCollection_NonERC721() public {
        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidCollection.selector);
        marketplace.registerCollection(address(nonERC721), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testRegisterCollection_AlreadyRegistered() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.CollectionAlreadyRegistered.selector);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testUpdateCollectionRoyalty_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), newOwner, 1000);

        (address receiver, uint16 fee,,,,) = core.collections(address(nft));
        assertEq(receiver, newOwner);
        assertEq(fee, 1000);
    }

    function testUpdateCollectionRoyalty_NonOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        marketplace.updateCollectionRoyalty(address(nft), newOwner, 1000);
    }

    function testVerifyCollection_AdminOnly() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.verifyCollection(address(nft));

        (,,,, bool verified,) = core.collections(address(nft));
        assertTrue(verified);
    }

    function testVerifyCollection_NonOwner() public {
        vm.prank(unauthorized);
        _expectOwnableUnauthorized(unauthorized);
        marketplace.verifyCollection(address(nft));
    }

    function testRegisterCollection_ThroughRouter() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        Marketplace.CollectionInfo memory info = marketplace.collections(address(nft));

        assertEq(info.royaltyReceiver, royaltyReceiverAddr);
        assertEq(info.royaltyFee, ROYALTY_FEE);
        assertTrue(info.exists);
    }

    function testRegisterCollection_RejectsNonAdmin() public {
        vm.prank(buyer);
        _expectOwnableUnauthorized(buyer);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
    }

    function testL05_UnverifyCollection() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.startPrank(owner);
        marketplace.verifyCollection(address(nft));
        (,,,, bool verified,) = core.collections(address(nft));
        assertTrue(verified);

        vm.expectEmit(true, false, false, false);
        emit MarketplaceCore.CollectionUnverified(address(nft));
        marketplace.unverifyCollection(address(nft));
        vm.stopPrank();

        (,,,, verified,) = core.collections(address(nft));
        assertFalse(verified);
    }

    function testL05_UnverifyOnlyOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(buyer);
        _expectOwnableUnauthorized(buyer);
        marketplace.unverifyCollection(address(nft));
    }
}
