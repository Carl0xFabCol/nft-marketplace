// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MarketplaceCore.sol";
import "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import "./MockNFT.t.sol";
import "./MockNFTWithRoyalty.sol";
import "./MockNFTNonERC721.sol";
import "./MockRevertingNFT.sol";
import "./MockRevertingRoyaltyNFT.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TestSetup is Test {
    MarketplaceCore public core;
    MarketplaceBids public bids;
    Marketplace public marketplace;

    MockNFT public nft;
    MockNFTWithRoyalty public nftWithRoyalty;
    MockNFTNonERC721 public nonERC721;
    MockRevertingNFT public revertingNFT;
    MockRevertingRoyaltyNFT public revertingRoyaltyNFT;

    address public owner = vm.addr(1);
    address public seller = vm.addr(2);
    address public buyer = vm.addr(3);
    address public bidder = vm.addr(4);
    address public feeReceiverAddr = vm.addr(5);
    address public royaltyReceiverAddr = vm.addr(6);
    address public unauthorized = vm.addr(7);
    address public newOwner = vm.addr(8);

    uint256 public constant MARKETPLACE_FEE = 500;
    uint256 public constant ROYALTY_FEE = 500;
    uint256 public constant SALE_PRICE = 1 ether;

    function setUp() public virtual {
        vm.deal(owner, 100 ether);
        vm.deal(seller, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(bidder, 100 ether);
        vm.deal(feeReceiverAddr, 100 ether);
        vm.deal(royaltyReceiverAddr, 100 ether);
        vm.deal(unauthorized, 100 ether);
        vm.deal(newOwner, 100 ether);

        vm.startPrank(owner);

        nft = new MockNFT();
        nftWithRoyalty = new MockNFTWithRoyalty();
        nonERC721 = new MockNFTNonERC721();
        revertingNFT = new MockRevertingNFT();
        revertingRoyaltyNFT = new MockRevertingRoyaltyNFT();

        core = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        bids = new MarketplaceBids(address(core));
        marketplace = new Marketplace(address(core), address(bids));

        // Initial wiring is done while the deployer still owns Core/Bids.
        core.setAuthorizedContract(address(bids), true);
        core.setAuthorizedContract(address(marketplace), true);

        // Move component ownership to the router using Ownable2Step.
        core.transferOwnership(address(marketplace));
        bids.transferOwnership(address(marketplace));

        // Marketplace is still owned by `owner`, so it can make the router
        // accept both pending component ownership transfers.
        marketplace.acceptComponentOwnership();
        marketplace.configureBidsMarketplace();

        vm.stopPrank();

        assertEq(core.owner(), address(marketplace));
        assertEq(bids.owner(), address(marketplace));
        assertEq(marketplace.owner(), owner);
        assertEq(bids.marketplace(), address(marketplace));
    }

    function _registerCollection(
        address collection,
        uint16 royaltyFee,
        address royaltyReceiver
    ) internal {
        // MockNFT ownership belongs to `owner`.
        vm.prank(owner);
        marketplace.registerCollection(collection, royaltyFee, royaltyReceiver);
    }

    function _mintNFT(address to, uint256 tokenId) internal {
        nft.mint(to, tokenId);
    }

    function _mintNFTWithRoyalty(address to, uint256 tokenId) internal {
        nftWithRoyalty.mint(to, tokenId);
    }

    function _mintRevertingNFT(address to, uint256 tokenId) internal {
        revertingNFT.mint(to, tokenId);
    }

    function _mintRevertingRoyaltyNFT(address to, uint256 tokenId) internal {
        revertingRoyaltyNFT.mint(to, tokenId);
    }

    function _approveOnCore(address collection, address who) internal {
        vm.prank(who);
        IERC721(collection).setApprovalForAll(address(core), true);
    }

    function _setupListing() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function _setupTokenBid() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(
            address(nft), 1, uint128(SALE_PRICE), 0
        );
    }

    function _setupCollectionBid() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: SALE_PRICE}(
            address(nft), uint128(SALE_PRICE), 1, 0
        );
    }

    function _expectRevert(bytes4 selector) internal {
        vm.expectRevert(abi.encodeWithSelector(selector));
    }

    function _expectOwnableUnauthorized(address account) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                account
            )
        );
    }
}
