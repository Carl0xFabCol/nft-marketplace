// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./TestSetup.sol";

interface IMintableERC721 is IERC721 {
    function mint(address to, uint256 tokenId) external;
}

/// @notice Stateful handler covering listings, sales, bids, withdrawals,
///         sweeps, stale cleanup, external transfers and direct-call attacks.
contract MarketplaceHandler is Test {
    TestSetup internal immutable setup;
    Marketplace internal immutable marketplace;
    MarketplaceCore internal immutable core;
    MarketplaceBids internal immutable bids;
    IMintableERC721 internal immutable nft;
    IMintableERC721 internal immutable nftRoyalty;

    uint256 public constant MAX_TOKEN_ID = 8;

    address[] private _actors;
    address[] private _royaltyReceivers;
    address[] private _bidders;
    address[] private _collections;

    mapping(address => mapping(uint256 => bool)) public minted;
    mapping(address => mapping(uint256 => address)) public expectedOwner;

    uint256 public ghost_salePriceSum;
    uint256 public ghost_saleFeeSum;
    uint256 public ghost_saleRoyaltySum;
    uint256 public ghost_saleSellerSum;
    uint256 public ghost_saleCount;

    uint256 public ghost_forcedCoreEth;
    uint256 public ghost_forcedBidsEth;

    constructor(TestSetup _setup) {
        setup = _setup;
        marketplace = _setup.marketplace();
        core = _setup.core();
        bids = _setup.bids();
        nft = IMintableERC721(address(_setup.nft()));
        nftRoyalty = IMintableERC721(address(_setup.nftWithRoyalty()));

        _actors.push(_setup.owner());
        _actors.push(_setup.seller());
        _actors.push(_setup.buyer());
        _actors.push(_setup.bidder());
        _actors.push(_setup.unauthorized());
        _actors.push(makeAddr("launchpad"));

        _bidders.push(_setup.bidder());
        _bidders.push(_setup.unauthorized());

        _collections.push(address(_setup.nft()));
        _collections.push(address(_setup.nftWithRoyalty()));

        _royaltyReceivers.push(_setup.royaltyReceiverAddr());
        _royaltyReceivers.push(address(0x1001));
        _royaltyReceivers.push(address(0x2002));
        _royaltyReceivers.push(address(0x3003));

        for (uint256 i = 1; i <= MAX_TOKEN_ID; ++i) {
            address receiver = _royaltyReceivers[1 + ((i - 1) % 3)];
            uint96 fee = uint96(100 * (1 + ((i - 1) % 5)));
            _setup.nftWithRoyalty().setTokenRoyalty(i, receiver, fee);
        }

        for (uint256 i; i < _actors.length; ++i) {
            vm.deal(_actors[i], 1_000 ether);
        }
    }


    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function royaltyReceivers() external view returns (address[] memory) {
        return _royaltyReceivers;
    }

    function bidders() external view returns (address[] memory) {
        return _bidders;
    }

    function collections() external view returns (address[] memory) {
        return _collections;
    }

    function selectors() external pure returns (bytes4[] memory s) {
        s = new bytes4[](24);
        s[0] = MarketplaceHandler.list.selector;
        s[1] = MarketplaceHandler.updatePrice.selector;
        s[2] = MarketplaceHandler.cancel.selector;
        s[3] = MarketplaceHandler.buy.selector;
        s[4] = MarketplaceHandler.buyBatch.selector;
        s[5] = MarketplaceHandler.placeTokenBid.selector;
        s[6] = MarketplaceHandler.placeCollectionBid.selector;
        s[7] = MarketplaceHandler.placeTokenBidBatch.selector;
        s[8] = MarketplaceHandler.cancelTokenBid.selector;
        s[9] = MarketplaceHandler.cancelCollectionBid.selector;
        s[10] = MarketplaceHandler.acceptTokenBid.selector;
        s[11] = MarketplaceHandler.acceptCollectionBid.selector;
        s[12] = MarketplaceHandler.withdraw.selector;
        s[13] = MarketplaceHandler.withdrawForViaRouter.selector;
        s[14] = MarketplaceHandler.sweep.selector;
        s[15] = MarketplaceHandler.forceEth.selector;
        s[16] = MarketplaceHandler.cleanStaleListing.selector;
        s[17] = MarketplaceHandler.transferToken.selector;
        s[18] = MarketplaceHandler.warp.selector;
        s[19] = MarketplaceHandler.attackOwnerDirectBuy.selector;
        s[20] = MarketplaceHandler.attackLaunchpadDirectExecuteSale.selector;
        s[21] = MarketplaceHandler.attackAttackerTransferFrom.selector;
        s[22] = MarketplaceHandler.attackOwnerCreateListing.selector;
        s[23] = MarketplaceHandler.attackOwnerWithdrawFor.selector;
    }


    function _collection(uint256 seed) internal view returns (address) {
        return _collections[seed % _collections.length];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    function _bidder(uint256 seed) internal view returns (address) {
        return _bidders[seed % _bidders.length];
    }

    function _token(uint256 seed) internal pure returns (uint256) {
        return bound(seed, 1, MAX_TOKEN_ID);
    }

    function _ensureMinted(address collection, uint256 tokenId, address to) internal returns (bool) {
        if (!minted[collection][tokenId]) {
            try IMintableERC721(collection).mint(to, tokenId) {} catch {
                return false;
            }
            minted[collection][tokenId] = true;
            expectedOwner[collection][tokenId] = to;
        }
        return expectedOwner[collection][tokenId] != address(0);
    }

    function _prepareToken(address collection, uint256 tokenId, address owner) internal returns (bool) {
        if (!_ensureMinted(collection, tokenId, owner)) return false;
        if (expectedOwner[collection][tokenId] != owner) return false;

        vm.prank(owner);
        try IERC721(collection).setApprovalForAll(address(core), true) {} catch {
            return false;
        }
        return true;
    }

    function _ensureListing(
        address collection,
        uint256 tokenId,
        uint128 price,
        uint256 expirySeed
    ) internal returns (bool) {
        if (expectedOwner[collection][tokenId] == address(0)) {
            if (!_ensureMinted(collection, tokenId, setup.seller())) return false;
        }
        if (expectedOwner[collection][tokenId] != setup.seller()) return false;
        if (!_prepareToken(collection, tokenId, setup.seller())) return false;

        uint64 expiresAt = uint64(block.timestamp + 1 days + (expirySeed % 20 days));
        vm.prank(setup.seller());
        try marketplace.createListing(collection, tokenId, price, expiresAt) {} catch {
            return false;
        }

        (address listingSeller, uint128 listingPrice, , , , ) = core.listings(collection, tokenId);
        return listingPrice > 0 && listingSeller == setup.seller();
    }

    function _ensureTokenBid(
        address collection,
        uint256 tokenId,
        address bidder,
        uint128 price
    ) internal returns (uint128 bidPrice) {
        (address storedBidder, uint128 storedPrice, ) = bids.tokenBids(collection, tokenId, bidder);
        if (storedBidder == bidder && storedPrice > 0) return storedPrice;

        vm.deal(bidder, price);
        vm.prank(bidder);
        try marketplace.placeTokenBid{value: price}(collection, tokenId, price, 0) {} catch {
            return 0;
        }
        (, bidPrice, ) = bids.tokenBids(collection, tokenId, bidder);
    }

    function _ensureCollectionBid(
        address collection,
        address bidder,
        uint128 price,
        uint32 quantity
    ) internal returns (uint128 bidPrice) {
        (address storedBidder, uint128 storedPrice, uint32 storedQuantity, ) =
            bids.collectionBids(collection, bidder);
        if (storedBidder == bidder && storedQuantity > 0) return storedPrice;

        uint256 value = uint256(price) * quantity;
        vm.deal(bidder, value);
        vm.prank(bidder);
        try marketplace.placeCollectionBid{value: value}(collection, price, quantity, 0) {} catch {
            return 0;
        }
        (, uint128 livePrice, uint32 liveQuantity, ) =
            bids.collectionBids(collection, bidder);
        if (liveQuantity == 0) return 0;
        bidPrice = livePrice;
    }

    function _pending(address account) internal view returns (uint256) {
        return core.pendingWithdrawals(account) + bids.pendingWithdrawals(account);
    }

    function _snapshot()
        internal
        view
        returns (uint256 fee, uint256 royalty, uint256 sellerTotal)
    {
        fee = _pending(setup.feeReceiverAddr());
        for (uint256 i; i < _royaltyReceivers.length; ++i) {
            royalty += _pending(_royaltyReceivers[i]);
        }
        for (uint256 i; i < _actors.length; ++i) {
            sellerTotal += _pending(_actors[i]);
        }
    }

    function _recordSale(
        uint256 price,
        uint256 feeBefore,
        uint256 royaltyBefore,
        uint256 sellerBefore
    ) internal {
        (uint256 feeAfter, uint256 royaltyAfter, uint256 sellerAfter) = _snapshot();
        ghost_salePriceSum += price;
        ghost_saleFeeSum += feeAfter - feeBefore;
        ghost_saleRoyaltySum += royaltyAfter - royaltyBefore;
        ghost_saleSellerSum += sellerAfter - sellerBefore;
        ++ghost_saleCount;
    }

    function _sellerWithTokens(address collection, address exclude)
        internal
        view
        returns (address seller)
    {
        for (uint256 i = 1; i <= MAX_TOKEN_ID; ++i) {
            address owner = expectedOwner[collection][i];
            if (owner != address(0) && owner != exclude) return owner;
        }
    }

    function _tokensOwnedBy(address collection, address owner, uint256 maxCount)
        internal
        view
        returns (uint256[] memory ids)
    {
        uint256[] memory buffer = new uint256[](MAX_TOKEN_ID);
        uint256 count;
        for (uint256 i = 1; i <= MAX_TOKEN_ID && count < maxCount; ++i) {
            if (expectedOwner[collection][i] == owner) {
                buffer[count++] = i;
            }
        }
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = buffer[i];
        }
    }


    function list(
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed,
        uint256 expirySeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        uint128 price = uint128(bound(priceSeed, 1, 5 ether));
        _ensureListing(collection, tokenId, price, expirySeed);
    }

    function updatePrice(
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 newPriceSeed,
        uint256 expirySeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        if (!_ensureListing(collection, tokenId, 1 ether, expirySeed)) return;

        uint128 newPrice = uint128(bound(newPriceSeed, 1, 5 ether));
        vm.prank(setup.seller());
        try marketplace.updateListingPrice(collection, tokenId, newPrice) {} catch {}
    }

    function cancel(uint256 tokenSeed, uint256 collectionSeed) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        (address listingSeller, uint128 listingPrice, , , , ) = core.listings(collection, tokenId);
        if (listingPrice == 0 || listingSeller != setup.seller()) return;

        vm.prank(setup.seller());
        try marketplace.cancelListing(collection, tokenId) {} catch {}
    }

    function buy(
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed,
        uint256 actorSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        uint128 price = uint128(bound(priceSeed, 1, 5 ether));
        if (!_ensureListing(collection, tokenId, price, 0)) return;

        (address listingSeller, uint128 listingPrice, , , , ) = core.listings(collection, tokenId);
        if (listingPrice == 0 || listingSeller != setup.seller()) return;

        address buyer = actorSeed % 2 == 0 ? setup.buyer() : setup.unauthorized();
        if (buyer == listingSeller) return;

        vm.deal(buyer, listingPrice);
        (uint256 feeBefore, uint256 royaltyBefore, uint256 sellerBefore) = _snapshot();

        bool ok;
        vm.prank(buyer);
        try marketplace.buy{value: listingPrice}(collection, tokenId) {
            ok = true;
        } catch {}

        if (!ok) return;
        expectedOwner[collection][tokenId] = buyer;
        _recordSale(listingPrice, feeBefore, royaltyBefore, sellerBefore);
    }

    function buyBatch(
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed,
        uint256 actorSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenA = _token(tokenSeed);
        uint256 tokenB = (tokenA % MAX_TOKEN_ID) + 1;
        uint128 priceA = uint128(bound(priceSeed, 1, 5 ether));
        uint128 priceB = uint128(bound(priceSeed / 2 + 1, 1, 5 ether));

        if (!_ensureListing(collection, tokenA, priceA, 0)) return;
        if (!_ensureListing(collection, tokenB, priceB, 0)) return;

        (uint256 feeBefore, uint256 royaltyBefore, uint256 sellerBefore) = _snapshot();

        (bool ok, uint256 totalPrice, address buyer) = _tryBuyBatch(collection, tokenA, tokenB, actorSeed);
        if (!ok) return;
        expectedOwner[collection][tokenA] = buyer;
        expectedOwner[collection][tokenB] = buyer;
        _recordSale(totalPrice, feeBefore, royaltyBefore, sellerBefore);
    }

    function _tryBuyBatch(
        address collection,
        uint256 tokenA,
        uint256 tokenB,
        uint256 actorSeed
    ) internal returns (bool ok, uint256 totalPrice, address buyer) {
        (address sellerA, uint128 liveA, , , , ) = core.listings(collection, tokenA);
        (address sellerB, uint128 liveB, , , , ) = core.listings(collection, tokenB);
        if (liveA == 0 || liveB == 0 || sellerA != setup.seller() || sellerB != setup.seller()) {
            return (false, 0, address(0));
        }

        buyer = actorSeed % 2 == 0 ? setup.buyer() : setup.unauthorized();
        totalPrice = uint256(liveA) + liveB;
        vm.deal(buyer, totalPrice);

        uint256[] memory ids = new uint256[](2);
        ids[0] = tokenA;
        ids[1] = tokenB;

        vm.prank(buyer);
        try marketplace.buyBatch{value: totalPrice}(collection, ids) {
            ok = true;
        } catch {}
    }


    function placeTokenBid(
        uint256 bidderSeed,
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed
    ) external {
        address bidder = _bidder(bidderSeed);
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        uint128 price = uint128(bound(priceSeed, 1, 5 ether));

        vm.deal(bidder, price);
        vm.prank(bidder);
        try marketplace.placeTokenBid{value: price}(collection, tokenId, price, 0) {} catch {}
    }

    function placeCollectionBid(
        uint256 bidderSeed,
        uint256 collectionSeed,
        uint128 priceSeed,
        uint256 quantitySeed
    ) external {
        address bidder = _bidder(bidderSeed);
        address collection = _collection(collectionSeed);
        uint128 price = uint128(bound(priceSeed, 1, 5 ether));
        uint32 quantity = uint32(bound(quantitySeed, 1, 3));
        uint256 value = uint256(price) * quantity;

        vm.deal(bidder, value);
        vm.prank(bidder);
        try marketplace.placeCollectionBid{value: value}(collection, price, quantity, 0) {} catch {}
    }

    function placeTokenBidBatch(
        uint256 bidderSeed,
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed
    ) external {
        address bidder = _bidder(bidderSeed);
        address collection = _collection(collectionSeed);
        uint256 tokenA = _token(tokenSeed);
        uint256 tokenB = (tokenA % MAX_TOKEN_ID) + 1;

        uint256[] memory ids = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);
        ids[0] = tokenA;
        ids[1] = tokenB;
        prices[0] = uint128(bound(priceSeed, 1, 5 ether));
        prices[1] = uint128(bound(priceSeed / 2 + 1, 1, 5 ether));

        uint256 value = uint256(prices[0]) + prices[1];
        vm.deal(bidder, value);
        vm.prank(bidder);
        try
            marketplace.placeTokenBidBatch{value: value}(
                collection, ids, prices, expiries
            )
        {} catch {}
    }

    function cancelTokenBid(
        uint256 bidderSeed,
        uint256 tokenSeed,
        uint256 collectionSeed
    ) external {
        address bidder = _bidder(bidderSeed);
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);

        vm.prank(bidder);
        try marketplace.cancelTokenBid(collection, tokenId) {} catch {}
    }

    function cancelCollectionBid(uint256 bidderSeed, uint256 collectionSeed) external {
        address bidder = _bidder(bidderSeed);
        address collection = _collection(collectionSeed);

        vm.prank(bidder);
        try marketplace.cancelCollectionBid(collection) {} catch {}
    }

    function acceptTokenBid(
        uint256 bidderSeed,
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint128 priceSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        address bidder = _bidder(bidderSeed);

        address seller = expectedOwner[collection][tokenId];
        if (seller == address(0)) {
            if (!_ensureMinted(collection, tokenId, setup.seller())) return;
            seller = setup.seller();
        }
        if (seller == bidder) return;

        uint128 price = uint128(bound(priceSeed, 1, 5 ether));
        uint128 bidPrice = _ensureTokenBid(collection, tokenId, bidder, price);
        if (bidPrice == 0) return;
        if (!_prepareToken(collection, tokenId, seller)) return;

        (uint256 feeBefore, uint256 royaltyBefore, uint256 sellerBefore) = _snapshot();

        bool ok;
        vm.prank(seller);
        try marketplace.acceptTokenBid(collection, tokenId, bidder, 0, 0) {
            ok = true;
        } catch {}

        if (!ok) return;
        expectedOwner[collection][tokenId] = bidder;
        _recordSale(bidPrice, feeBefore, royaltyBefore, sellerBefore);
    }

    function acceptCollectionBid(
        uint256 bidderSeed,
        uint256 collectionSeed,
        uint128 priceSeed,
        uint256 quantitySeed,
        uint256 partialSeed
    ) external {
        address collection = _collection(collectionSeed);
        address bidder = _bidder(bidderSeed);
        uint128 price = uint128(bound(priceSeed, 1, 5 ether));
        uint32 quantity = uint32(bound(quantitySeed, 1, 3));

        uint128 bidPrice = _ensureCollectionBid(collection, bidder, price, quantity);
        if (bidPrice == 0) return;

        (, , uint32 liveQuantity, ) = bids.collectionBids(collection, bidder);
        if (liveQuantity == 0) return;

        _acceptCollectionBid(collection, bidder, bidPrice, liveQuantity, partialSeed);
    }

    function _acceptCollectionBid(
        address collection,
        address bidder,
        uint128 bidPrice,
        uint32 liveQuantity,
        uint256 partialSeed
    ) internal {
        address seller = _sellerWithTokens(collection, bidder);
        if (seller == address(0)) return;

        uint256[] memory ids = _prepareCollectionBidIds(collection, seller, liveQuantity, partialSeed);
        if (ids.length == 0) return;

        _executeAndRecordCollectionBid(collection, bidder, seller, ids, uint256(bidPrice) * ids.length);
    }

    function _prepareCollectionBidIds(
        address collection,
        address seller,
        uint32 liveQuantity,
        uint256 partialSeed
    ) internal returns (uint256[] memory ids) {
        uint256[] memory owned = _tokensOwnedBy(collection, seller, liveQuantity);
        if (owned.length == 0) return ids;

        uint256 requested = partialSeed % 2 == 0 ? 1 : owned.length;
        if (requested > owned.length) requested = owned.length;

        ids = new uint256[](requested);
        for (uint256 i; i < requested; ++i) {
            ids[i] = owned[i];
            if (!_prepareToken(collection, ids[i], seller)) return new uint256[](0);
        }
    }

    function _executeAndRecordCollectionBid(
        address collection,
        address bidder,
        address seller,
        uint256[] memory ids,
        uint256 totalPrice
    ) internal {
        (uint256 feeBefore, uint256 royaltyBefore, uint256 sellerBefore) = _snapshot();

        if (!_executeAcceptCollectionBid(collection, bidder, seller, ids)) return;
        for (uint256 i; i < ids.length; ++i) {
            expectedOwner[collection][ids[i]] = bidder;
        }
        _recordSale(totalPrice, feeBefore, royaltyBefore, sellerBefore);
    }

    function _executeAcceptCollectionBid(
        address collection,
        address bidder,
        address seller,
        uint256[] memory ids
    ) internal returns (bool ok) {
        vm.prank(seller);
        try marketplace.acceptCollectionBid(collection, bidder, ids, 0, 0) {
            ok = true;
        } catch {}
    }


    function withdraw(uint256 actorSeed) external {
        address account = _actor(actorSeed);
        vm.prank(account);
        try marketplace.withdraw() {} catch {}
    }

    function withdrawForViaRouter(uint256 actorSeed) external {
        address account = _actor(actorSeed);
        vm.prank(address(marketplace));
        try core.withdrawFor(account) {} catch {}
        vm.prank(address(marketplace));
        try bids.withdrawFor(account) {} catch {}
    }

    function sweep() external {
        uint256 coreBefore = address(core).balance;
        uint256 bidsBefore = address(bids).balance;

        vm.prank(setup.owner());
        try marketplace.sweepExcessETH(payable(setup.owner())) {} catch {
            return;
        }

        uint256 coreDelta = coreBefore - address(core).balance;
        uint256 bidsDelta = bidsBefore - address(bids).balance;
        ghost_forcedCoreEth = ghost_forcedCoreEth > coreDelta ? ghost_forcedCoreEth - coreDelta : 0;
        ghost_forcedBidsEth = ghost_forcedBidsEth > bidsDelta ? ghost_forcedBidsEth - bidsDelta : 0;
    }

    function forceEth(uint256 targetSeed, uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1 ether);
        if (targetSeed % 2 == 0) {
            vm.deal(address(core), address(core).balance + amount);
            ghost_forcedCoreEth += amount;
        } else {
            vm.deal(address(bids), address(bids).balance + amount);
            ghost_forcedBidsEth += amount;
        }
    }


    function cleanStaleListing(uint256 tokenSeed, uint256 collectionSeed) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);

        vm.prank(setup.unauthorized());
        try marketplace.cleanStaleListing(collection, tokenId) {} catch {}
    }

    function transferToken(
        uint256 tokenSeed,
        uint256 collectionSeed,
        uint256 recipientSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        if (!_ensureMinted(collection, tokenId, setup.seller())) return;

        address from = expectedOwner[collection][tokenId];
        address to = _actor(recipientSeed);
        if (from == address(0) || from == to) return;

        vm.prank(from);
        try IERC721(collection).transferFrom(from, to, tokenId) {
            expectedOwner[collection][tokenId] = to;
        } catch {}
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1 hours, 10 days));
    }


    function attackOwnerDirectBuy(uint256 tokenSeed, uint256 collectionSeed) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        (, uint128 price, , , , ) = core.listings(collection, tokenId);
        if (price == 0) return;

        vm.deal(setup.owner(), price);
        vm.prank(setup.owner());
        try core.buy{value: price}(collection, tokenId, setup.unauthorized()) {} catch {}
    }

    function attackLaunchpadDirectExecuteSale(
        uint256 tokenSeed,
        uint256 collectionSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        address seller = expectedOwner[collection][tokenId];
        if (seller == address(0)) return;

        address launchpad = _actors[5];
        vm.prank(launchpad);
        try core.executeSaleFromBid(collection, tokenId, seller, launchpad, 1) {} catch {}
    }

    function attackAttackerTransferFrom(
        uint256 tokenSeed,
        uint256 collectionSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        address currentOwner = expectedOwner[collection][tokenId];
        address attacker = setup.unauthorized();
        if (currentOwner == address(0) || currentOwner == attacker) return;

        vm.prank(attacker);
        try IERC721(collection).transferFrom(currentOwner, attacker, tokenId) {} catch {}
    }

    function attackOwnerCreateListing(
        uint256 tokenSeed,
        uint256 collectionSeed
    ) external {
        address collection = _collection(collectionSeed);
        uint256 tokenId = _token(tokenSeed);
        address seller = expectedOwner[collection][tokenId];
        if (seller == address(0)) return;

        vm.prank(setup.owner());
        try
            core.createListing(
                collection,
                tokenId,
                uint128(1 ether),
                uint64(block.timestamp + 1 days),
                seller
            )
        {} catch {}
    }

    function attackOwnerWithdrawFor(uint256 actorSeed) external {
        address account = _actor(actorSeed);
        vm.prank(setup.owner());
        try core.withdrawFor(account) {} catch {}
        vm.prank(setup.owner());
        try bids.withdrawFor(account) {} catch {}
    }
}

/// @notice Session-3 handler-based invariants.
contract MarketplaceInvariantS3Test is TestSetup {
    MarketplaceHandler internal handler;

    function setUp() public override {
        super.setUp();
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        _registerCollection(
            address(nftWithRoyalty),
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr
        );

        handler = new MarketplaceHandler(this);
        targetContract(address(handler));
        targetSelector(
            FuzzSelector({addr: address(handler), selectors: handler.selectors()})
        );

        handler.list(0, 0, uint128(1 ether), 0);
        handler.buy(0, 0, uint128(1 ether), 0);
        assertGt(handler.ghost_saleCount(), 0);
    }

    function _sumPending(bool coreSide) internal view returns (uint256 sum) {
        address[] memory accounts = handler.actors();
        for (uint256 i; i < accounts.length; ++i) {
            sum += coreSide
                ? core.pendingWithdrawals(accounts[i])
                : bids.pendingWithdrawals(accounts[i]);
        }

        address[] memory receivers = handler.royaltyReceivers();
        for (uint256 i; i < receivers.length; ++i) {
            sum += coreSide
                ? core.pendingWithdrawals(receivers[i])
                : bids.pendingWithdrawals(receivers[i]);
        }

        sum += coreSide
            ? core.pendingWithdrawals(feeReceiverAddr)
            : bids.pendingWithdrawals(feeReceiverAddr);
    }

    function invariant_corePendingAccounting() public view {
        assertEq(core.totalPendingWithdrawals(), _sumPending(true), "core pending mismatch");
    }

    function invariant_bidsPendingAccounting() public view {
        assertEq(bids.totalPendingWithdrawals(), _sumPending(false), "bids pending mismatch");
    }

    function invariant_coreSolvency() public view {
        assertGe(address(core).balance, core.totalPendingWithdrawals(), "core insolvent");
        assertEq(
            address(core).balance,
            core.totalPendingWithdrawals() + handler.ghost_forcedCoreEth(),
            "core balance mismatch"
        );
    }

    function invariant_bidsEscrowAccounting() public view {
        uint256 sum;
        address[] memory collections_ = handler.collections();
        address[] memory bidders_ = handler.bidders();
        uint256 maxToken = handler.MAX_TOKEN_ID();

        for (uint256 c; c < collections_.length; ++c) {
            for (uint256 b; b < bidders_.length; ++b) {
                (, uint128 pricePerItem, uint32 quantity, ) =
                    bids.collectionBids(collections_[c], bidders_[b]);
                if (quantity > 0) {
                    sum += uint256(pricePerItem) * quantity;
                }

                for (uint256 tokenId = 1; tokenId <= maxToken; ++tokenId) {
                    (, uint128 price, ) = bids.tokenBids(
                        collections_[c],
                        tokenId,
                        bidders_[b]
                    );
                    sum += price;
                }
            }
        }

        assertEq(bids.totalBidEscrow(), sum, "escrow mismatch");
    }

    function invariant_bidsSolvency() public view {
        uint256 obligations = bids.totalPendingWithdrawals() + bids.totalBidEscrow();
        assertGe(address(bids).balance, obligations, "bids insolvent");
        assertEq(
            address(bids).balance,
            obligations + handler.ghost_forcedBidsEth(),
            "bids balance mismatch"
        );
    }

    function invariant_saleConservation() public view {
        assertGt(handler.ghost_saleCount(), 0, "no sales exercised");
        assertEq(
            handler.ghost_salePriceSum(),
            handler.ghost_saleFeeSum() +
                handler.ghost_saleRoyaltySum() +
                handler.ghost_saleSellerSum(),
            "sale proceeds mismatch"
        );
    }

    function invariant_nftOwnership() public view {
        address[] memory collections_ = handler.collections();
        uint256 maxToken = handler.MAX_TOKEN_ID();

        for (uint256 c; c < collections_.length; ++c) {
            for (uint256 tokenId = 1; tokenId <= maxToken; ++tokenId) {
                address expected = handler.expectedOwner(collections_[c], tokenId);
                if (expected == address(0)) continue;
                assertEq(
                    IERC721(collections_[c]).ownerOf(tokenId),
                    expected,
                    "unauthorized NFT move"
                );
            }
        }
    }

    function invariant_totalListings() public view {
        uint256 count;
        address[] memory collections_ = handler.collections();
        uint256 maxToken = handler.MAX_TOKEN_ID();

        for (uint256 c; c < collections_.length; ++c) {
            for (uint256 tokenId = 1; tokenId <= maxToken; ++tokenId) {
                (, uint128 price, , , , ) = core.listings(collections_[c], tokenId);
                if (price > 0) ++count;
            }
        }

        assertEq(core.totalListings(), count, "totalListings mismatch");
    }
}
