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

contract MarketplaceAccountingTest is TestSetup {
    using stdStorage for StdStorage;

    uint64 internal constant ONE_DAY = 1 days;

    function testWithdraw_SellerProceeds() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller =
            SALE_PRICE - (SALE_PRICE * MARKETPLACE_FEE) / 10_000 - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);

        uint256 before = seller.balance;

        vm.prank(seller);
        marketplace.withdraw();

        assertEq(seller.balance - before, expectedSeller);
        assertEq(core.pendingWithdrawals(seller), 0);
    }

    function testWithdraw_NoWithdrawal() public {
        vm.prank(seller);
        _expectRevert(MarketplaceCore.NoWithdrawal.selector);
        core.withdraw();
    }

    function testSweepExcessETH_CannotTouchPending() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 pending = core.totalPendingWithdrawals();
        assertEq(address(core).balance, pending);

        vm.prank(owner);
        vm.expectRevert(Marketplace.SweepFailed.selector);
        marketplace.sweepExcessETH(payable(owner));
    }

    function testSweepExcessETH_RecoversAccidentalETH() public {
        // Marketplace.sweepExcessETH delegates to both components, and both
        // components require actual excess ETH to sweep successfully.
        vm.deal(address(core), 1 ether);
        vm.deal(address(bids), 1 ether);

        uint256 before = owner.balance;

        vm.prank(owner);
        marketplace.sweepExcessETH(payable(owner));

        assertEq(owner.balance - before, 2 ether);
        assertEq(address(core).balance, 0);
        assertEq(address(bids).balance, 0);
    }

    function testPendingWithdrawalsAggregatesBothComponents() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        (uint256 coreAmount, uint256 bidsAmount) = marketplace.pendingWithdrawals(seller);

        assertGt(coreAmount, 0);
        assertEq(bidsAmount, 0);
    }

    function testWithdrawThroughRouter() public {
        _setupListing();

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expected = SALE_PRICE - (SALE_PRICE * MARKETPLACE_FEE) / 10_000 - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        uint256 before = seller.balance;

        vm.prank(seller);
        marketplace.withdraw();

        assertEq(seller.balance - before, expected);
    }

    function testCoreCreditUpdatesTotalPendingWithdrawals() public {
        _setupListing();
        // Test that _credit updates totalPendingWithdrawals
        uint256 initialTotalPending = core.totalPendingWithdrawals();

        // Direct call to _credit (internal function) - need to test via sale
        vm.deal(buyer, SALE_PRICE);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // Check that totalPendingWithdrawals increased by sale price
        assertEq(core.totalPendingWithdrawals(), initialTotalPending + SALE_PRICE);

        // Check pending withdrawals for each account
        (uint256 corePending,) = marketplace.pendingWithdrawals(feeReceiverAddr);
        assertTrue(corePending > 0);
    }

    function testBidsCreditUpdatesTotalPendingWithdrawals() public {
        _registerCollection(address(nft), 0, royaltyReceiverAddr);

        // Place a token bid
        vm.deal(bidder, SALE_PRICE);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);

        uint256 initialTotalPending = bids.totalPendingWithdrawals();

        // Cancel bid to trigger _credit
        vm.prank(bidder);
        marketplace.cancelTokenBid(address(nft), 1);

        // Check that totalPendingWithdrawals increased
        assertEq(bids.totalPendingWithdrawals(), initialTotalPending + SALE_PRICE);
    }

    function testWithdrawFailureReaddsToTotalPendingWithdrawals() public {
        // Route the marketplace fee to a contract that rejects ETH.
        RejectETH rejecter = new RejectETH();
        vm.prank(owner);
        marketplace.updateFeeReceiver(address(rejecter));

        _setupListing();
        // Make a sale
        vm.deal(buyer, SALE_PRICE);
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 initialTotalPending = core.totalPendingWithdrawals();
        uint256 feeReceiverBalance = core.pendingWithdrawals(address(rejecter));
        assertGt(feeReceiverBalance, 0);

        // Try to withdraw - should revert TransferFailed
        vm.expectRevert(MarketplaceCore.TransferFailed.selector);
        vm.prank(address(rejecter));
        core.withdraw();

        // Check totalPendingWithdrawals restored
        assertEq(core.totalPendingWithdrawals(), initialTotalPending);
        assertEq(core.pendingWithdrawals(address(rejecter)), feeReceiverBalance);
    }

    function testInvariantTotalPendingEqualsSumOfIndividualPending() public {
        // Register a zero-royalty collection so pending equals fee + seller proceeds.
        _registerCollection(address(nft), 0, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _mintNFT(seller, 2);
        _approveOnCore(address(nft), seller);

        vm.startPrank(seller);
        marketplace.createListing(address(nft), 1, uint128(SALE_PRICE), _listingExpiry());
        marketplace.createListing(address(nft), 2, uint128(SALE_PRICE), _listingExpiry());
        vm.stopPrank();

        // Make multiple sales
        vm.deal(buyer, SALE_PRICE * 2);
        vm.prank(buyer);
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;
        marketplace.buyBatch{value: SALE_PRICE * 2}(address(nft), tokenIds);

        // Calculate sum of all pending withdrawals
        uint256 sumPending = 0;
        address[] memory accounts = new address[](3);
        accounts[0] = feeReceiverAddr;
        accounts[1] = seller;
        accounts[2] = makeAddr("other");

        for (uint256 i = 0; i < accounts.length; i++) {
            sumPending += core.pendingWithdrawals(accounts[i]);
        }

        // Check invariant
        assertEq(core.totalPendingWithdrawals(), sumPending);
    }

    function testBidsInvariantBalanceGeTotalPendingPlusEscrow() public {
        _registerCollection(address(nft), 0, royaltyReceiverAddr);

        // Place bids
        uint128 bidPrice = 0.5 ether;
        vm.deal(bidder, bidPrice * 2);
        vm.prank(bidder);
        marketplace.placeTokenBid{value: bidPrice}(address(nft), 1, bidPrice, 0);
        vm.prank(bidder);
        marketplace.placeCollectionBid{value: bidPrice}(address(nft), uint128(bidPrice), 1, 0);

        uint256 totalObligations = bids.totalPendingWithdrawals() + bids.totalBidEscrow();
        uint256 contractBalance = address(bids).balance;

        // Check invariant: balance >= totalPendingWithdrawals + totalBidEscrow
        assertGe(contractBalance, totalObligations);

        // Force ETH via vm.deal and check invariant still holds
        vm.deal(address(bids), contractBalance + 1 ether);
        uint256 newTotalObligations = bids.totalPendingWithdrawals() + bids.totalBidEscrow();
        uint256 newContractBalance = address(bids).balance;

        assertGe(newContractBalance, newTotalObligations);
    }

    function testM03_FeeIncreaseAfterListingDoesNotAffectSeller() public {
        _setupListing();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller =
            SALE_PRICE - (SALE_PRICE * MARKETPLACE_FEE) / 10_000 - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);
    }

    function testM03_LowerCurrentFeeIsUsed() public {
        _setupListing();

        vm.prank(owner);
        marketplace.updateMarketplaceFee(100);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 expectedSeller = SALE_PRICE - (SALE_PRICE * 100) / 10_000 - (SALE_PRICE * ROYALTY_FEE) / 10_000;

        assertEq(core.pendingWithdrawals(seller), expectedSeller);
    }

    function _listAndBuyRoyaltyNft() internal {
        _registerCollection(address(nftWithRoyalty), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);

        vm.prank(seller);
        marketplace.createListing(address(nftWithRoyalty), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nftWithRoyalty), 1);
    }

    function testM04_ExcessiveTokenRoyaltyFallsBackToCollectionRoyalty() public {
        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 5_000);

        _listAndBuyRoyaltyNft();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_ZeroReceiverFallsBackToCollectionRoyalty() public {
        // ERC-2981 returns a zero receiver (mock reports amount 0 in this case);
        // the stored collection royalty must be used instead.
        nftWithRoyalty.setTokenRoyalty(1, address(0), 5_000);

        _listAndBuyRoyaltyNft();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_RevertingRoyaltyFallsBackToCollectionRoyalty() public {
        _registerCollection(address(revertingRoyaltyNFT), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintRevertingRoyaltyNFT(seller, 1);
        _approveOnCore(address(revertingRoyaltyNFT), seller);

        vm.prank(seller);
        marketplace.createListing(address(revertingRoyaltyNFT), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(revertingRoyaltyNFT), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testM04_UpdateRoyaltyRejectsZeroReceiverWithFee() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        _expectRevert(MarketplaceCore.InvalidAddress.selector);
        marketplace.updateCollectionRoyalty(address(nft), address(0), 500);
    }

    function testM02_CollectionBidCreditsEachRoyaltyReceiver() public {
        _registerCollection(address(nftWithRoyalty), 0, royaltyReceiverAddr);

        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 500);
        nftWithRoyalty.setTokenRoyalty(2, newOwner, 1_000);

        _mintNFTWithRoyalty(seller, 1);
        _mintNFTWithRoyalty(seller, 2);
        _approveOnCore(address(nftWithRoyalty), seller);

        vm.prank(bidder);
        marketplace.placeCollectionBid{value: 2 ether}(address(nftWithRoyalty), 1 ether, 2, 0);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.prank(seller);
        marketplace.acceptCollectionBid(address(nftWithRoyalty), bidder, ids, 0, 0);

        assertEq(bids.pendingWithdrawals(royaltyReceiverAddr), 0.05 ether);
        assertEq(bids.pendingWithdrawals(newOwner), 0.1 ether);
        assertEq(bids.pendingWithdrawals(seller), 1.75 ether);
    }

    function _expiry() internal view returns (uint64) {
        return uint64(block.timestamp + ONE_DAY);
    }

    function _list(uint256 tokenId, uint128 price, uint64 expiresAt) internal {
        vm.prank(seller);
        marketplace.createListing(address(nft), tokenId, price, expiresAt);
    }

    function _buy(uint256 tokenId, uint128 price) internal {
        vm.deal(buyer, price);
        vm.prank(buyer);
        marketplace.buy{value: price}(address(nft), tokenId);
    }

    function testRoyaltyIncreaseAfterListingUsesSnapshot() public {
        _registerCollection(address(nft), 200, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, uint128(SALE_PRICE), _expiry());

        (,,,,, uint16 snapshotBps) = core.listings(address(nft), 1);
        assertEq(snapshotBps, 200, "snapshot must record the listing-time royalty");

        // Collection owner raises the royalty from 2% to 20% after listing.
        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 2_000);

        _buy(1, uint128(SALE_PRICE));

        uint256 expectedRoyalty = (SALE_PRICE * 200) / 10_000;
        uint256 raisedRoyalty = (SALE_PRICE * 2_000) / 10_000;
        uint256 paidRoyalty = core.pendingWithdrawals(royaltyReceiverAddr);

        assertEq(paidRoyalty, expectedRoyalty, "sale must use the snapshot");
        assertLt(paidRoyalty, raisedRoyalty, "raise must not affect the live listing");
    }

    function testRoyaltyDecreaseAfterListingIsHonored() public {
        _registerCollection(address(nft), 2_000, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, uint128(SALE_PRICE), _expiry());

        (,,,,, uint16 snapshotBps) = core.listings(address(nft), 1);
        assertEq(snapshotBps, 2_000);

        // Collection owner lowers the royalty from 20% to 2% after listing.
        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(nft), royaltyReceiverAddr, 200);

        _buy(1, uint128(SALE_PRICE));

        uint256 expectedRoyalty = (SALE_PRICE * 200) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testTinyPricesNeverExceedPrice() public {
        vm.prank(owner);
        marketplace.updateMarketplaceFee(1_000); // 10%, the maximum fee

        _registerCollection(address(nft), 2_000, royaltyReceiverAddr); // 20%, the maximum royalty

        uint128[2] memory prices = [uint128(1), uint128(3)];
        for (uint256 i; i < prices.length; ++i) {
            uint256 tokenId = i + 1;
            _mintNFT(seller, tokenId);
            _approveOnCore(address(nft), seller);
            _list(tokenId, prices[i], _expiry());

            uint256 feesBefore = core.pendingWithdrawals(feeReceiverAddr);
            uint256 royaltyBefore = core.pendingWithdrawals(royaltyReceiverAddr);

            _buy(tokenId, prices[i]);

            uint256 feeDelta = core.pendingWithdrawals(feeReceiverAddr) - feesBefore;
            uint256 royaltyDelta = core.pendingWithdrawals(royaltyReceiverAddr) - royaltyBefore;

            assertLe(feeDelta + royaltyDelta, prices[i], "fee + royalty must never exceed price");
        }
    }

    function testFuzzFeeAndRoyaltyNeverExceedPrice(uint128 priceSeed, uint16 feeBpsSeed, uint16 royaltyBpsSeed) public {
        uint16 feeBps = uint16(bound(feeBpsSeed, 0, 1_000));
        uint16 royaltyBps = uint16(bound(royaltyBpsSeed, 0, 2_000));
        uint128 price = uint128(bound(priceSeed, 1, 1e30));

        vm.prank(owner);
        marketplace.updateMarketplaceFee(feeBps);
        _registerCollection(address(nft), royaltyBps, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);
        _list(1, price, _expiry());

        _buy(1, price);

        uint256 fee = core.pendingWithdrawals(feeReceiverAddr);
        uint256 royalty = core.pendingWithdrawals(royaltyReceiverAddr);
        uint256 sellerProceeds = core.pendingWithdrawals(seller);

        assertLe(fee + royalty, price, "fee + royalty must never exceed price");
        assertEq(fee + royalty + sellerProceeds, price, "proceeds must sum to price");
        assertEq(core.totalPendingWithdrawals(), price, "accounting must match the sale");
    }

    function testListingStorageLayout() public {
        _registerCollection(address(nft), 500, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        uint128 price = uint128(SALE_PRICE);
        uint64 expiresAt = _expiry();
        _list(1, price, expiresAt);

        uint256 baseSlot = stdstore.target(address(core)).sig(core.listings.selector).with_key(address(nft))
            .with_key(uint256(1)).find();

        bytes32 slot0 = vm.load(address(core), bytes32(baseSlot));
        bytes32 slot1 = vm.load(address(core), bytes32(baseSlot + 1));
        bytes32 slot2 = vm.load(address(core), bytes32(baseSlot + 2));

        // Slot 1: seller.
        assertEq(address(uint160(uint256(slot0))), seller);

        // Slot 2: price, listedAt, expiresAt, feeBps and royaltyBps.
        assertEq(uint128(uint256(slot1)), price);
        assertEq(uint48(uint256(slot1) >> 128), uint48(block.timestamp));
        assertEq(uint48(uint256(slot1) >> 176), expiresAt);
        assertEq(uint16(uint256(slot1) >> 224), MARKETPLACE_FEE);
        assertEq(uint16(uint256(slot1) >> 240), 500, "royaltyBps lives in the second slot");

        // No third slot is consumed.
        assertEq(slot2, bytes32(0));
    }

    function _registerRoyaltyNft(uint16 storedRoyalty) internal {
        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 500);
        _registerCollection(address(nftWithRoyalty), storedRoyalty, royaltyReceiverAddr);
        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);
    }

    function _initialSnapshotBps() internal view returns (uint16 bps) {
        (,,,,, bps) = core.listings(address(nftWithRoyalty), 1);
    }

    function _updatedSnapshotBps() internal view returns (uint16 bps) {
        (,,,,, bps) = core.listings(address(nftWithRoyalty), 1);
    }

    function test_H01_dustThenUpdateCannotEvadeRoyalty() public {
        _registerRoyaltyNft(uint16(ROYALTY_FEE));

        vm.prank(seller);
        marketplace.createListing(address(nftWithRoyalty), 1, 1 wei, _listingExpiry());

        assertEq(_initialSnapshotBps(), 0, "dust listing floors the snapshot to zero");

        vm.prank(seller);
        marketplace.updateListingPrice(address(nftWithRoyalty), 1, 100 ether);

        uint16 updatedBps = _updatedSnapshotBps();
        assertGe(updatedBps, 1, "snapshot must be recomputed after a price update");
        assertEq(updatedBps, 500, "5% ERC-2981 royalty must be snapshotted as 500 bps");

        uint256 royaltyBefore = core.pendingWithdrawals(royaltyReceiverAddr);

        vm.prank(buyer);
        marketplace.buy{value: 100 ether}(address(nftWithRoyalty), 1);

        uint256 royaltyPaid = core.pendingWithdrawals(royaltyReceiverAddr) - royaltyBefore;
        assertGt(royaltyPaid, 0, "royalty receiver must be paid");
        assertApproxEqAbs(royaltyPaid, 5 ether, 1, "royalty must be ~5% of the sale");
    }

    function test_H01_zeroRoyaltyCollectionStaysZeroAfterUpdate() public {
        _registerCollection(address(nft), 0, royaltyReceiverAddr);
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, 1 wei, _listingExpiry());

        vm.prank(seller);
        marketplace.updateListingPrice(address(nft), 1, 100 ether);

        (,,,,, uint16 updatedBps) = core.listings(address(nft), 1);
        assertEq(updatedBps, 0, "a genuine zero-royalty collection must stay at zero");
    }

    function testWithdraw_RevertsWhenNoPending() public {
        vm.prank(buyer);
        vm.expectRevert(Marketplace.NoWithdrawal.selector);
        marketplace.withdraw();
    }

    function testWithdraw_SucceedsWithCoreCreditOnly() public {
        _setupListing();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        uint256 before = buyer.balance;
        uint256 pending = core.pendingWithdrawals(seller);
        assertGt(pending, 0);
        assertEq(bids.pendingWithdrawals(seller), 0);

        vm.prank(seller);
        marketplace.withdraw();

        uint256 afterBal = seller.balance;
        assertGt(afterBal, before);
        assertEq(core.pendingWithdrawals(seller), 0);
    }

    function testWithdraw_SucceedsWithBidsCreditOnly() public {
        // register collection
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        vm.prank(buyer);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 1, uint128(SALE_PRICE), 0);
        vm.prank(buyer);
        marketplace.cancelTokenBid(address(nft), 1);

        uint256 pending = bids.pendingWithdrawals(buyer);
        assertGt(pending, 0);
        assertEq(core.pendingWithdrawals(buyer), 0);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        marketplace.withdraw();
        uint256 afterBal = buyer.balance;
        assertGt(afterBal, before);
        assertEq(bids.pendingWithdrawals(buyer), 0);
    }

    function testWithdraw_SucceedsWithBothCredits() public {
        // create pending in core
        _setupListing();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        // create pending in bids (use token 2)
        vm.prank(unauthorized);
        marketplace.placeTokenBid{value: SALE_PRICE}(address(nft), 2, uint128(SALE_PRICE), 0);
        vm.prank(unauthorized);
        marketplace.cancelTokenBid(address(nft), 2);

        uint256 corePending = core.pendingWithdrawals(seller);
        uint256 bidsPending = bids.pendingWithdrawals(unauthorized);
        assertGt(corePending, 0);
        assertGt(bidsPending, 0);

        uint256 beforeSeller = seller.balance;
        uint256 beforeUnauth = unauthorized.balance;

        vm.prank(seller);
        marketplace.withdraw();
        vm.prank(unauthorized);
        marketplace.withdraw();

        assertGt(seller.balance, beforeSeller);
        assertGt(unauthorized.balance, beforeUnauth);
        assertEq(core.pendingWithdrawals(seller), 0);
        assertEq(bids.pendingWithdrawals(unauthorized), 0);
    }

    function testG09_WithdrawalTotalsAccumulateOncePerSale() public {
        _setupListing();

        uint256 gasBefore = gasleft();
        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);
        uint256 gasUsed = gasBefore - gasleft();

        uint256 expectedFee = (SALE_PRICE * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        uint256 expectedSeller = SALE_PRICE - expectedFee - expectedRoyalty;

        assertEq(core.pendingWithdrawals(feeReceiverAddr), expectedFee);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
        assertEq(core.pendingWithdrawals(seller), expectedSeller);
        assertEq(
            core.totalPendingWithdrawals(),
            core.pendingWithdrawals(feeReceiverAddr) + core.pendingWithdrawals(royaltyReceiverAddr)
                + core.pendingWithdrawals(seller)
        );
        assertLt(gasUsed, 600_000);
    }

    function _setupExpensiveSupportsInterfaceListing(uint256 iterations) internal returns (MockMalformedNFT) {
        MockMalformedNFT expensiveNft = new MockMalformedNFT();
        expensiveNft.setExpensiveRoyaltyInfo(true, iterations);

        // Register collection with royalty fee
        vm.prank(owner);
        marketplace.registerCollection(address(expensiveNft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        // Mint, approve, create listing
        vm.prank(seller);
        expensiveNft.mint(seller, 1);
        vm.prank(seller);
        expensiveNft.setApprovalForAll(address(core), true);
        vm.prank(seller);
        marketplace.createListing(address(expensiveNft), 1, uint128(SALE_PRICE), _listingExpiry());

        return expensiveNft;
    }

    function testNB3_SufficientGasPaysRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(nft), 1);

        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }

    function testNB3_LowGasViaRouterRevertsInsufficientGas() public {
        _setupListing();

        vm.prank(buyer);
        vm.expectRevert(MarketplaceCore.InsufficientGas.selector);
        marketplace.buy{value: SALE_PRICE, gas: 60_000}(address(nft), 1);
    }

    function testNB3_SufficientGasViaRouterPaysRoyalty() public {
        _setupListing();

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE, gas: 500_000}(address(nft), 1);

        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}

contract AuditM04RoyaltyOverrideTest is TestSetup {
    address internal erc2981Receiver = vm.addr(10);
    address internal overrideReceiver = vm.addr(11);

    function _deployHyperc(address royaltyReceiver) internal returns (MiColeccion collection) {
        collection =
            new MiColeccion("Hyperc Collection", "HYPERC", owner, uint16(ROYALTY_FEE), royaltyReceiver, 100, "", 0, 0);
    }

    function _listAndBuy(MiColeccion collection) internal {
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(seller);
        collection.mint(seller);

        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);
    }

    function test_M04_overrideWinsOverERC2981() public {
        MiColeccion collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);

        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * 300) / 10_000;
        assertEq(core.pendingWithdrawals(overrideReceiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(erc2981Receiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }

    function test_M04_fallbackStillUsesERC2981WhenNotOverridden() public {
        MiColeccion collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        assertFalse(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(erc2981Receiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }

    function test_M04_clearOverrideRestoresERC2981() public {
        MiColeccion collection = _deployHyperc(erc2981Receiver);
        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);
        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(owner);
        marketplace.clearRoyaltyOverride(address(collection));
        assertFalse(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(erc2981Receiver), expectedRoyalty);
        assertEq(core.pendingWithdrawals(overrideReceiver), 0);
    }

    function test_M04_royaltyInfoRevertStillFallsBack() public {
        _registerCollection(address(revertingRoyaltyNFT), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _mintRevertingRoyaltyNFT(seller, 1);
        _approveOnCore(address(revertingRoyaltyNFT), seller);

        vm.prank(seller);
        marketplace.createListing(address(revertingRoyaltyNFT), 1, uint128(SALE_PRICE), _listingExpiry());

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(revertingRoyaltyNFT), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}

contract AuditIntegrationH01M04Test is TestSetup {
    address internal erc2981Receiver = vm.addr(10);
    address internal overrideReceiver = vm.addr(11);

    function test_integration_H01_and_M04_combined() public {
        MiColeccion collection =
            new MiColeccion("Hyperc Collection", "HYPERC", owner, uint16(ROYALTY_FEE), erc2981Receiver, 100, "", 0, 0);

        _registerCollection(address(collection), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.updateCollectionRoyalty(address(collection), overrideReceiver, 300);
        assertTrue(core.royaltyOverridden(address(collection)));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(address(collection), 1, 1, _listingExpiry());

        uint256 finalPrice = 100 ether;
        vm.prank(seller);
        marketplace.updateListingPrice(address(collection), 1, uint128(finalPrice));

        (address sellerSnapshot, uint128 priceSnapshot,,, uint16 feeBps, uint16 royaltyBps) =
            core.listings(address(collection), 1);
        assertEq(sellerSnapshot, seller);
        assertEq(priceSnapshot, finalPrice);
        assertEq(feeBps, uint16(MARKETPLACE_FEE));
        assertEq(royaltyBps, 300);

        vm.deal(buyer, 200 ether);
        vm.prank(buyer);
        marketplace.buy{value: finalPrice}(address(collection), 1);

        uint256 expectedFee = (finalPrice * MARKETPLACE_FEE) / 10_000;
        uint256 expectedRoyalty = (finalPrice * 300) / 10_000;
        uint256 expectedSeller = finalPrice - expectedFee - expectedRoyalty;

        uint256 sellerCredit = core.pendingWithdrawals(seller);
        uint256 feeCredit = core.pendingWithdrawals(feeReceiverAddr);
        uint256 royaltyCredit = core.pendingWithdrawals(overrideReceiver);

        assertEq(sellerCredit, expectedSeller);
        assertEq(feeCredit, expectedFee);
        assertEq(royaltyCredit, expectedRoyalty);
        assertEq(sellerCredit + feeCredit + royaltyCredit, finalPrice);

        assertEq(core.pendingWithdrawals(erc2981Receiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), 0);
    }
}

contract AuditIN3Test is TestSetup {
    MockMalformedNFT internal malformed;

    function setUp() public override {
        super.setUp();
        malformed = new MockMalformedNFT();
    }

    function testIN3_ExpensiveRoyaltyQueryFallsBack() public {
        assertEq(core.ROYALTY_QUERY_GAS(), 50_000);

        address expensiveReceiver = address(0xBEEF);
        malformed.setTokenRoyalty(1, expensiveReceiver, uint96(ROYALTY_FEE));
        _registerCollection(address(malformed), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        malformed.mint(seller, 1);
        _approveOnCore(address(malformed), seller);

        vm.prank(seller);
        marketplace.createListing(address(malformed), 1, uint128(SALE_PRICE), _listingExpiry());

        malformed.setExpensiveRoyaltyInfo(true, 5_000);

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(malformed), 1);

        uint256 expectedRoyalty = (SALE_PRICE * ROYALTY_FEE) / 10_000;
        assertEq(core.pendingWithdrawals(expensiveReceiver), 0);
        assertEq(core.pendingWithdrawals(royaltyReceiverAddr), expectedRoyalty);
    }
}

contract MarketplaceCoreAccountingHarness is MarketplaceCore {
    constructor() MarketplaceCore(0, address(this)) {}

    function setTotalListings(uint256 value) external {
        totalListings = value;
    }

    function setTotalPendingWithdrawals(uint256 value) external {
        totalPendingWithdrawals = value;
    }

    function setPendingWithdrawal(address account, uint256 value) external {
        pendingWithdrawals[account] = value;
    }

    function setListing(address collection, uint256 tokenId, address seller, uint128 price) external {
        listings[collection][tokenId] = Listing({
            seller: seller,
            price: price,
            listedAt: uint48(block.timestamp),
            expiresAt: uint48(block.timestamp + 1 days),
            feeBps: 0,
            royaltyBps: 0
        });
    }

    function cancelListingTest(address collection, uint256 tokenId, address seller) external {
        _cancelListing(collection, tokenId, seller);
    }

    function withdrawTest(address account) external {
        _withdraw(account);
    }
}

contract AuditR1Test is Test {
    MarketplaceCoreAccountingHarness internal harness;

    function setUp() public {
        harness = new MarketplaceCoreAccountingHarness();
    }

    function testR1_TotalListingsUnderflowReverts() public {
        harness.setTotalListings(0);
        harness.setListing(address(0x1234), 1, address(0x5678), 1 ether);

        vm.expectRevert(stdError.arithmeticError);
        harness.cancelListingTest(address(0x1234), 1, address(0x5678));
    }

    function testR1_TotalPendingWithdrawalsUnderflowReverts() public {
        address account = address(0x5678);
        harness.setTotalPendingWithdrawals(0);
        harness.setPendingWithdrawal(account, 1 ether);

        vm.expectRevert(stdError.arithmeticError);
        harness.withdrawTest(account);
    }
}

contract RejectETH {
    receive() external payable {
        revert("RejectETH");
    }
}
