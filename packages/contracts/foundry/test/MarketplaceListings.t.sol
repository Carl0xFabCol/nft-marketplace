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

contract MarketplaceListingsTest is TestSetup {
    function testCreateListing_Valid() public {
        _setupListing();

        (address s, uint128 price,, uint48 expiresAt,,) = core.listings(address(nft), 1);

        assertEq(s, seller);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, _listingExpiry());
        assertEq(core.totalListings(), 1);
    }

    function testCreateListing_Expired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.InvalidExpiry.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 1);
    }

    function testCreateListing_PriceBelowMin() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.InvalidPrice.selector);
        marketplace.createListing(address(nft), 1, 0, _listingExpiry());
    }

    function testCreateListing_Unregistered() public {
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.CollectionNotRegistered.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testCreateListing_NotOwner() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testCreateListing_NotApproved() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(seller);
        _expectRevert(MarketplaceCore.NotApproved.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testCreateListing_ReplacesExisting() public {
        _setupListing();

        uint64 newExpiry = uint64(block.timestamp + 2 days);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(2 ether), newExpiry);

        (address listedSeller, uint128 price,, uint48 expiresAt,,) = core.listings(address(nft), 1);
        assertEq(listedSeller, seller);
        assertEq(price, 2 ether);
        assertEq(expiresAt, newExpiry);
        assertEq(core.totalListings(), 1);
        assertEq(nft.ownerOf(1), seller);

        // The old listing terms are gone: buying at the old price must fail.
        vm.prank(buyer);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // The replacement listing is purchasable at the new price.
        vm.prank(buyer);
        marketplace.buy{value: 2 ether}(address(nft), 1);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.totalListings(), 0);
    }

    function testCreateListing_CannotReplaceAnotherSellersListing() public {
        _setupListing();

        uint64 originalExpiry = _listingExpiry();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(nft), 1, uint128(2 ether), uint64(block.timestamp + 2 days));

        (address listedSeller, uint128 price,, uint48 expiresAt,,) = core.listings(address(nft), 1);
        assertEq(listedSeller, seller);
        assertEq(price, SALE_PRICE);
        assertEq(expiresAt, originalExpiry);
        assertEq(core.totalListings(), 1);
        assertEq(nft.ownerOf(1), seller);
    }

    function testUpdateListingPrice_Valid() public {
        _setupListing();

        vm.prank(seller);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));

        (, uint128 price,,,,) = core.listings(address(nft), 1);
        assertEq(price, 2 ether);
    }

    function testUpdateListingPrice_NotSeller() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));
    }

    function testUpdateListingPrice_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        marketplace.pause();

        vm.prank(seller);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(2 ether));
    }

    function testCancelListing_Valid() public {
        _setupListing();

        vm.prank(seller);
        marketplace.cancelListing(address(nft), 1);

        (address s, uint128 price,,,,) = core.listings(address(nft), 1);
        assertEq(s, address(0));
        assertEq(price, 0);
        assertEq(core.totalListings(), 0);
    }

    function testCancelListing_NotSeller() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        marketplace.cancelListing(address(nft), 1);
    }

    function testCancelListing_UnauthorizedDirectCore() public {
        _setupListing();

        vm.prank(unauthorized);
        _expectRevert(MarketplaceCore.Unauthorized.selector);
        core.cancelListing(address(nft), 1, seller);
    }

    function testBuy_Valid_CreditsPullPayments() public {
        _setupListing();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(core.pendingWithdrawals(seller), expectedSeller);
        assertEq(core.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
        assertEq(core.totalSales(), 1);
        assertEq(core.totalVolume(), SALE_PRICE);
        assertEq(core.totalListings(), 0);
    }

    function testBuy_RequiresExactETH() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE - 1}(address(nft), 1);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.InsufficientValue.selector);
        marketplace.buy{value: SALE_PRICE + 1}(address(nft), 1);
    }

    function testBuy_SelfPurchase() public {
        _setupListing();

        vm.prank(seller);
        _expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuy_ListingExpired() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), uint64(block.timestamp + 1));

        vm.warp(block.timestamp + 2);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuy_WhenPaused() public {
        _setupListing();

        vm.prank(owner);
        marketplace.pause();

        vm.prank(buyer);
        _expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testBuyBatch_Valid() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _mintNFT(seller, 2);
        _approveOnCore(address(nft), seller);

        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
        marketplace.createListing(address(nft), 2, uint128(2 ether), _listingExpiry());
        vm.stopPrank();

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.prank(buyer);
        marketplace.buyBatch{value: 3 ether}(address(nft), ids);

        assertEq(nft.ownerOf(1), buyer);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(core.totalSales(), 2);
        assertEq(core.totalVolume(), 3 ether);
        assertEq(core.totalListings(), 0);
    }

    function testCreateListing_UsesActualSeller() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());

        assertEq(marketplace.listings(address(nft), 1).seller, seller);
    }

    function testCreateListing_CannotSpoofSeller() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotTokenOwner.selector);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function testCancelListing_UsesActualSeller() public {
        _setupListing();

        vm.prank(seller);
        marketplace.cancelListing(address(nft), 1);

        assertEq(marketplace.listings(address(nft), 1).price, 0);
    }

    function testCancelListing_CannotBeCalledByOtherUser() public {
        _setupListing();

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.NotSeller.selector);
        marketplace.cancelListing(address(nft), 1);
    }

    function testBuy_UsesActualBuyer() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }

    function testG05_BuyBatchRejectsTooManyTokens() public {
        uint256[] memory ids = new uint256[](51);
        for (uint256 i; i < 51; ++i) {
            ids[i] = i + 1;
        }

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.BatchTooLarge.selector);
        marketplace.buyBatch{value: 0}(address(nft), ids);
    }

    function testL01_BuyBatchRejectsDuplicateTokenIds() public {
        _setupListing();

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.DuplicateTokenId.selector);
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), ids);
    }

    function testL04_ListingExpiresAtExactTimestamp() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint64 expiry = uint64(block.timestamp + 1);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiry);

        vm.warp(expiry);

        vm.prank(buyer);
        _expectRevert(MarketplaceCore.ListingExpired.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testExpiresAtAboveUint48Reverts() public {
        _registerCollection(address(nft), 0, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint64 expiresAt = uint64(2 ** 48);

        vm.expectRevert(MarketplaceCore.ExpiryTooLarge.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiresAt);
    }

    function _prepareToken() internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
    }

    function testListingZeroExpiryReverts() public {
        _prepareToken();

        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testListingBeyondMaxDurationReverts() public {
        _prepareToken();

        uint64 tooLong = uint64(block.timestamp + 30 days + 1);

        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), tooLong);
    }

    function testListingResurrectionAfterExpiryFails() public {
        _prepareToken();

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), expiry);

        vm.warp(expiry + 1);

        // A -> B -> A: the token moves away and back, so the old listing would
        // otherwise become "live" again. It must stay expired.
        vm.prank(seller);
        nft.transferFrom(seller, buyer, 1);
        vm.prank(buyer);
        nft.transferFrom(buyer, seller, 1);

        vm.expectRevert(MarketplaceCore.ListingExpired.selector);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // It also cannot be resurrected as a never-expiring listing.
        vm.expectRevert(MarketplaceCore.InvalidExpiry.selector);
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), 0);
    }

    function testN02_BurnedTokenMakesListingStale() public {
        // Create a listing
        _setupListing();

        // Simulate a burn: ERC721 ownerOf reverts for a non-existent token.
        vm.mockCallRevert(address(nft), abi.encodeWithSelector(IERC721.ownerOf.selector, 1), abi.encode("burned"));

        // Try to buy - currently might bubble ownerOf revert
        vm.startPrank(buyer);
        // Should revert with ListingNotFound, not bubble ownerOf revert
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        vm.stopPrank();
    }

    function testN02_StaleListingCanBeCleaned() public {
        // Create a listing
        _setupListing();

        // Transfer NFT to someone else (makes listing stale)
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();

        // Clean stale listing
        marketplace.cleanStaleListing(address(nft), 1);

        // Verify listing is gone
        (address s, uint128 price,,,,) = core.listings(address(nft), 1);
        assertEq(s, address(0));
        assertEq(price, 0);
        assertEq(core.totalListings(), 0);
    }

    function testN02_CleanStaleListingRevertsForNonStale() public {
        // Create a listing
        _setupListing();

        // Try to clean non-stale listing - should revert
        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(nft), 1);
    }

    function testN02_CleanStaleListingRevertsForNonExistent() public {
        // Try to clean non-existent listing
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.cleanStaleListing(address(nft), 999);
    }

    function testN02_BuyRevertsForStaleListingWithoutCleanup() public {
        // Create a listing
        _setupListing();

        // Transfer NFT to someone else
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();

        // Try to buy - should revert with ListingNotFound
        vm.startPrank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        vm.stopPrank();

        // Listing should still exist (not cleaned by buy)
        (address s,,,,,) = core.listings(address(nft), 1);
        assertEq(s, seller);
    }

    function testN02_UpdateListingPriceRevertsForStaleListing() public {
        // Create a listing
        _setupListing();

        // Transfer NFT to someone else
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();

        // Try to update price - should revert with ListingNotFound
        vm.startPrank(seller);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.updateListingPrice(address(nft), 1, uint128(SALE_PRICE * 2));
        vm.stopPrank();

        // Listing should still exist
        (address s,,,,,) = core.listings(address(nft), 1);
        assertEq(s, seller);
    }

    function testN02_NewOwnerCanCreateListingOverStale() public {
        // Create a listing
        _setupListing();

        // Transfer NFT to buyer
        vm.startPrank(seller);
        nft.safeTransferFrom(seller, buyer, 1);
        vm.stopPrank();

        // Buyer creates new listing (should overwrite stale)
        vm.startPrank(buyer);
        nft.setApprovalForAll(address(core), true);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE * 2), _listingExpiry());
        vm.stopPrank();

        // New listing exists
        (address s, uint128 price,,,,) = core.listings(address(nft), 1);
        assertEq(s, buyer);
        assertEq(price, SALE_PRICE * 2);
        assertEq(core.totalListings(), 1);
    }

    function testExpiredListingIsCleaned() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _mintNFT(seller, 2);
        _approveOnCore(address(nft), seller);

        uint64 shortExpiry = uint64(block.timestamp + 1);
        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), shortExpiry);
        marketplace.createListing(address(nft), 2, uint128(SALE_PRICE), _listingExpiry());
        vm.stopPrank();

        assertEq(core.totalListings(), 2);

        vm.warp(shortExpiry + 1);

        marketplace.cleanStaleListing(address(nft), 1);

        (address cleanedSeller, uint128 cleanedPrice,,,,) = core.listings(address(nft), 1);
        assertEq(cleanedSeller, address(0));
        assertEq(cleanedPrice, 0);
        assertEq(core.totalListings(), 1, "exactly one listing must be removed");

        // The live listing is untouched.
        (address liveSeller, uint128 livePrice,,,,) = core.listings(address(nft), 2);
        assertEq(liveSeller, seller);
        assertEq(livePrice, SALE_PRICE);
    }

    function testLiveListingStillReverts() public {
        _setupListing();

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(nft), 1);
    }

    function testL06_PerTokenApprovalAllowsListingAndBuy() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFT(seller, 1);

        vm.prank(seller);
        nft.approve(address(core), 1);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(nft.ownerOf(1), buyer);
    }

    function testNB5_SelfPurchaseRevertsInBuy() public {
        _setupListing();
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
    }

    function testNB5_SelfPurchaseRevertsInBuyBatch() public {
        _setupListing();
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;
        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.SelfPurchase.selector);
        marketplace.buyBatch{value: SALE_PRICE}(address(nft), tokenIds);
    }

    function _prepareTokens(uint256 count) internal {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        for (uint256 i = 1; i <= count; ++i) {
            nft.mint(seller, i);
        }
        _approveOnCore(address(nft), seller);
    }

    function testG04_SingleAndBatchListingSharePath() public {
        _prepareTokens(2);

        uint256 gasBefore = gasleft();
        vm.prank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
        uint256 singleGas = gasBefore - gasleft();

        address[] memory collections_ = new address[](1);
        uint256[] memory tokenIds = new uint256[](1);
        uint128[] memory prices = new uint128[](1);
        uint64[] memory expiries = new uint64[](1);
        collections_[0] = address(nft);
        tokenIds[0] = 2;
        prices[0] = uint128(SALE_PRICE);
        expiries[0] = _listingExpiry();

        vm.prank(seller);
        marketplace.createListingBatch(collections_, tokenIds, prices, expiries);

        (address seller1, uint128 price1,,, uint16 fee1,) = core.listings(address(nft), 1);
        (address seller2, uint128 price2,,, uint16 fee2,) = core.listings(address(nft), 2);

        assertEq(seller1, seller);
        assertEq(seller2, seller);
        assertEq(price1, SALE_PRICE);
        assertEq(price2, SALE_PRICE);
        assertEq(fee1, fee2);
        assertEq(core.totalListings(), 2);
        assertLt(singleGas, 500_000);
    }

    function testG06_BuyBatchCachesListingsAndGasBounded() public {
        _prepareTokens(2);

        address[] memory collections_ = new address[](2);
        uint256[] memory tokenIds = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);
        for (uint256 i; i < 2; ++i) {
            collections_[i] = address(nft);
            tokenIds[i] = i + 1;
            prices[i] = uint128(SALE_PRICE);
            expiries[i] = _listingExpiry();
        }

        vm.prank(seller);
        marketplace.createListingBatch(collections_, tokenIds, prices, expiries);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        uint256 gasBefore = gasleft();
        vm.prank(buyer);
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), ids);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(nft.ownerOf(1), buyer);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(core.totalListings(), 0);
        assertLt(gasUsed, 1_000_000);
    }
}

contract AuditNB1Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
    }

    function _listToken() internal {
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());
    }

    function _setOwnerOfMode(uint8 mode) internal {
        malformed.setMalformedOwnerOfMode(true, (uint256(1) << 160) | 1, mode);
    }

    function _assertListingSurvives() internal view {
        (address listingSeller, uint128 listingPrice,,,,) = core.listings(address(malformed), 1);
        assertEq(listingSeller, seller);
        assertEq(listingPrice, SALE_PRICE);
        assertEq(core.totalListings(), 1);
    }

    function testNB1_CleanRejects64ByteOwnerOf() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_CleanRejectsDirtyAddressOwnerOf() public {
        _listToken();
        _setOwnerOfMode(0);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_CleanRejectsBoolStyleOwnerOf() public {
        _listToken();
        _setOwnerOfMode(2);

        vm.expectRevert(MarketplaceCore.InvalidCall.selector);
        marketplace.cleanStaleListing(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_BuyRejectsMalformedOwnerOfWithoutCleanup() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        _assertListingSurvives();
    }

    function testNB1_BuyBatchRejectsMalformedOwnerOfWithoutCleanup() public {
        _listToken();
        _setOwnerOfMode(1);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.buyBatch{value: SALE_PRICE}(address(malformed), tokenIds);

        _assertListingSurvives();
    }

    function testNB1_UpdateRejectsMalformedOwnerOfWithoutChange() public {
        _listToken();
        _setOwnerOfMode(1);

        vm.prank(seller);
        vm.expectRevert(MarketplaceCore.ListingNotFound.selector);
        marketplace.updateListingPrice(address(malformed), 1, uint128(SALE_PRICE * 2));

        _assertListingSurvives();
    }
}
