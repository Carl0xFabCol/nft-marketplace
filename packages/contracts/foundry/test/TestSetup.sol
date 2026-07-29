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
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestSetup
 * @notice Base contract for all marketplace tests. Deploys mocks and the
 *         three-contract marketplace in the correct order with authorizations
 *         wired up. Test contracts inherit from this and add their own test fns.
 */
contract TestSetup is Test {
    // ── Core contracts ───────────────────────────────────────────────
    MarketplaceCore public core;
    MarketplaceBids public bids;
    Marketplace public marketplace;

    // ── Mocks ────────────────────────────────────────────────────────
    MockNFT public nft;
    MockNFTWithRoyalty public nftWithRoyalty;
    MockNFTNonERC721 public nonERC721;
    MockRevertingNFT public revertingNFT;
    MockRevertingRoyaltyNFT public revertingRoyaltyNFT;

    // ── Test accounts ────────────────────────────────────────────────
    address public owner = vm.addr(1);
    address public seller = vm.addr(2);
    address public buyer = vm.addr(3);
    address public bidder = vm.addr(4);
    address public feeReceiverAddr = vm.addr(5);
    address public royaltyReceiverAddr = vm.addr(6);
    address public unauthorized = vm.addr(7);
    address public newOwner = vm.addr(8);

    // ── Constants ────────────────────────────────────────────────────
    uint256 public constant MARKETPLACE_FEE = 500; // 5%
    uint256 public constant ROYALTY_FEE = 500; // 5%
    uint256 public constant SALE_PRICE = 1 ether;

    function setUp() public {
        // Fund accounts
        vm.deal(owner, 100 ether);
        vm.deal(seller, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(bidder, 100 ether);
        vm.deal(feeReceiverAddr, 100 ether);
        vm.deal(royaltyReceiverAddr, 100 ether);
        vm.deal(address(marketplace), 100 ether);

        // Deploy mocks and marketplace from `owner` (so owner is the
        // collection owner for Ownable-based mocks)
        vm.startPrank(owner);
        nft = new MockNFT();
        nftWithRoyalty = new MockNFTWithRoyalty();
        nonERC721 = new MockNFTNonERC721();
        revertingNFT = new MockRevertingNFT();
        revertingRoyaltyNFT = new MockRevertingRoyaltyNFT();

        core = new MarketplaceCore(uint16(MARKETPLACE_FEE), feeReceiverAddr);
        bids = new MarketplaceBids(address(core));
        marketplace = new Marketplace(address(core), address(bids));

        // Wire authorizations
        core.setAuthorizedContract(address(bids), true);
        core.setAuthorizedContract(address(marketplace), true);
        bids.setMarketplaceAddress(address(marketplace));
        vm.stopPrank();
    }

    // ── Helper: register a collection (from owner) ───────────────────
    function _registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver) internal {
        vm.prank(owner);
        marketplace.registerCollection(collection, royaltyFee, royaltyReceiver);
    }

    // ── Helper: mint NFT to `to` ─────────────────────────────────────
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

    // ── Helper: set approval on core ─────────────────────────────────
    function _approveOnCore(address collection, address who) internal {
        vm.prank(who);
        IERC721(collection).setApprovalForAll(address(core), true);
    }

    // ── Helper: expect a custom-error revert ─────────────────────────
    function _expectRevert(bytes4 selector) internal {
        vm.expectRevert(abi.encodeWithSelector(selector));
    }

    // ── Helper: expect a custom-error revert with argument ───────────
    function _expectRevert(bytes4 selector, address arg) internal {
        vm.expectRevert(abi.encodeWithSelector(selector, arg));
    }
}
