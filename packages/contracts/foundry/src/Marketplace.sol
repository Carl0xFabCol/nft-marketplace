// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IMarketplaceCore {
    // Structs
    struct Listing {
        address seller;
        uint128 price;
        uint64 listedAt;
        uint64 expiresAt;
    }

    struct CollectionInfo {
        address royaltyReceiver;
        uint16 royaltyFee;
        uint256 totalVolume;
        uint32 totalSales;
        bool isVerified;
        bool exists;
    }

    // State variables
    function feeReceiver() external view returns (address);

    function marketplaceFee() external view returns (uint16);

    function totalVolume() external view returns (uint256);

    function totalSales() external view returns (uint256);

    function totalListings() external view returns (uint256);

    function collections(address) external view returns (address, uint16, uint256, uint32, bool, bool);

    function listings(address, uint256) external view returns (address, uint128, uint64, uint64);

    // Listing functions
    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) external;

    function createListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts, address seller) external;

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice, address seller) external;

    function cancelListing(address collection, uint256 tokenId, address seller) external;

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, address seller) external;

    // Buying functions
    function buy(address collection, uint256 tokenId, address buyer) external payable;

    function buyBatch(address collection, uint256[] calldata tokenIds, address buyer) external payable;

    // Collection management
    function registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver, address sender) external;
    function emergencyUpdateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee) external;

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee, address sender) external;

    function verifyCollection(address collection) external;

    // Admin functions
    function updateMarketplaceFee(uint16 newFee) external;

    function updateFeeReceiver(address newReceiver) external;

    function setAuthorizedContract(address contractAddr, bool authorized) external;

    function pause() external;

    function unpause() external;

    function owner() external view returns (address);

    function transferOwnership(address newOwner) external;
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;

    // View functions
    function getCollectionStats(address collection) external view returns (uint256, uint32, bool, bool);
    function pendingWithdrawals(address account) external view returns (uint256);
    function withdrawFor(address account) external returns (bool);
    function withdraw() external;
    function sweepExcessETH(address payable recipient) external;

    function paused() external view returns (bool);
}

interface IMarketplaceBids {
    // Structs
    struct CollectionBid {
        address bidder;
        uint128 pricePerItem;
        uint32 quantity;
        uint64 expiresAt;
    }

    struct TokenBid {
        address bidder;
        uint128 price;
        uint64 expiresAt;
    }

    function collectionBids(address, address) external view returns (address, uint128, uint32, uint64);

    function tokenBids(address, uint256, address) external view returns (address, uint128, uint64);

    // Collection bid functions
    function placeCollectionBid(address collection, uint128 pricePerItem, uint32 quantity, uint64 expiresAt, address bidder) external payable;

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds, address seller) external;

    function cancelCollectionBid(address collection, address bidder) external;

    // Token bid functions
    function placeTokenBid(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address bidder) external payable;

    function placeTokenBidBatch(address collection, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts, address bidder) external payable;

    function acceptTokenBid(address collection, uint256 tokenId, address bidder, address seller) external;

    function cancelTokenBid(address collection, uint256 tokenId, address bidder) external;

    function cancelTokenBidBatch(address[] calldata collections_, uint256[] calldata tokenIds, address bidder) external;

    function owner() external view returns (address);

    function transferOwnership(address newOwner) external;
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function pendingWithdrawals(address account) external view returns (uint256);
    function withdrawFor(address account) external returns (bool);
    function withdraw() external;
    function sweepExcessETH(address payable recipient) external;
    function setMarketplaceAddress(address _marketplace) external;

    function pause() external;

    function unpause() external;
}

/**
 * @title Marketplace
 * @notice Main marketplace contract - maintains original API, delegates to Core and Bids
 * @dev Acts as a proxy/router to maintain backwards compatibility
 */
contract Marketplace is Ownable2Step {
    // ═══════════════════════════════════════════════════════════════════════════════
    // IMMUTABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    IMarketplaceCore public immutable core;
    IMarketplaceBids public immutable bids;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS - for backwards compatibility
    // ═══════════════════════════════════════════════════════════════════════════════

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_MARKETPLACE_FEE = 1_000;
    uint256 public constant MAX_ROYALTY_FEE = 2_000;
    uint128 public constant MIN_LISTING_PRICE = 1 wei;

    // ═══════════════════════════════════════════════════════════════════════════════
    // STRUCTS - for backwards compatibility
    // ═══════════════════════════════════════════════════════════════════════════════

    struct Listing {
        address seller;
        uint128 price;
        uint64 listedAt;
        uint64 expiresAt;
    }

    struct CollectionBid {
        address bidder;
        uint128 pricePerItem;
        uint32 quantity;
        uint64 expiresAt;
    }

    struct TokenBid {
        address bidder;
        uint128 price;
        uint64 expiresAt;
    }

    struct CollectionInfo {
        address royaltyReceiver;
        uint16 royaltyFee;
        uint256 totalVolume;
        uint32 totalSales;
        bool isVerified;
        bool exists;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address _core, address _bids) Ownable(msg.sender) {
        if (_core == address(0) || _bids == address(0)) revert("Invalid addresses");
        core = IMarketplaceCore(_core);
        bids = IMarketplaceBids(_bids);
    }

    // The deployer transfers Core and Bids ownership to this router first.
    // The router owner then calls this once so both components accept ownership.
    function acceptComponentOwnership() external onlyOwner {
        if (core.pendingOwner() == address(this)) core.acceptOwnership();
        if (bids.pendingOwner() == address(this)) bids.acceptOwnership();
        require(core.owner() == address(this) && bids.owner() == address(this), "Components not owned");
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS - Delegate to Core
    // ═══════════════════════════════════════════════════════════════════════════════

    function feeReceiver() external view returns (address) {
        return core.feeReceiver();
    }

    function marketplaceFee() external view returns (uint16) {
        return core.marketplaceFee();
    }

    function totalVolume() external view returns (uint256) {
        return core.totalVolume();
    }

    function totalSales() external view returns (uint256) {
        return core.totalSales();
    }

    function totalListings() external view returns (uint256) {
        return core.totalListings();
    }

    function collections(address collection) external view returns (CollectionInfo memory) {
        (address royaltyReceiver, uint16 royaltyFee, uint256 totalVol, uint32 totalSale, bool verified, bool exists) = core.collections(collection);
        return CollectionInfo(royaltyReceiver, royaltyFee, totalVol, totalSale, verified, exists);
    }

    function listings(address collection, uint256 tokenId) external view returns (Listing memory) {
        (address seller, uint128 price, uint64 listedAt, uint64 expiresAt) = core.listings(collection, tokenId);
        return Listing(seller, price, listedAt, expiresAt);
    }

    function collectionBids(address collection, address bidder) external view returns (CollectionBid memory) {
        (address bidderAddr, uint128 pricePerItem, uint32 quantity, uint64 expiresAt) = bids.collectionBids(collection, bidder);
        return CollectionBid(bidderAddr, pricePerItem, quantity, expiresAt);
    }

    function tokenBids(address collection, uint256 tokenId, address bidder) external view returns (TokenBid memory) {
        (address bidderAddr, uint128 price, uint64 expiresAt) = bids.tokenBids(collection, tokenId, bidder);
        return TokenBid(bidderAddr, price, expiresAt);
    }

    function getCollectionStats(address collection) external view returns (uint256, uint32, bool, bool) {
        return core.getCollectionStats(collection);
    }

    function paused() external view returns (bool) {
        return core.paused();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LISTING FUNCTIONS - Delegate to Core
    // ═══════════════════════════════════════════════════════════════════════════════

    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt) external {
        core.createListing(collection, tokenId, price, expiresAt, msg.sender);
    }

    function createListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts) external {
        core.createListingBatch(collections_, tokenIds, prices, expiresAts, msg.sender);
    }

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice) external {
        core.updateListingPrice(collection, tokenId, newPrice, msg.sender);
    }

    function cancelListing(address collection, uint256 tokenId) external {
        core.cancelListing(collection, tokenId, msg.sender);
    }

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds) external {
        core.cancelListingBatch(collections_, tokenIds, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BUYING FUNCTIONS - Delegate to Core
    // ═══════════════════════════════════════════════════════════════════════════════

    function buy(address collection, uint256 tokenId) external payable {
        core.buy{value: msg.value}(collection, tokenId, msg.sender);
    }

    function buyBatch(address collection, uint256[] calldata tokenIds) external payable {
        core.buyBatch{value: msg.value}(collection, tokenIds, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION BID FUNCTIONS - Delegate to Bids
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeCollectionBid(address collection, uint128 pricePerItem, uint32 quantity, uint64 expiresAt) external payable {
        bids.placeCollectionBid{value: msg.value}(collection, pricePerItem, quantity, expiresAt, msg.sender);
    }

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds) external {
        bids.acceptCollectionBid(collection, bidder, tokenIds, msg.sender);
    }

    function cancelCollectionBid(address collection) external {
        bids.cancelCollectionBid(collection, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // TOKEN BID FUNCTIONS - Delegate to Bids
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeTokenBid(address collection, uint256 tokenId, uint128 price, uint64 expiresAt) external payable {
        bids.placeTokenBid{value: msg.value}(collection, tokenId, price, expiresAt, msg.sender);
    }

    function placeTokenBidBatch(address collection, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts) external payable {
        bids.placeTokenBidBatch{value: msg.value}(collection, tokenIds, prices, expiresAts, msg.sender);
    }

    function acceptTokenBid(address collection, uint256 tokenId, address bidder) external {
        bids.acceptTokenBid(collection, tokenId, bidder, msg.sender);
    }

    function cancelTokenBid(address collection, uint256 tokenId) external {
        bids.cancelTokenBid(collection, tokenId, msg.sender);
    }

    function cancelTokenBidBatch(address[] calldata collections_, uint256[] calldata tokenIds) external {
        bids.cancelTokenBidBatch(collections_, tokenIds, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION MANAGEMENT - Delegate to Core
    // ═══════════════════════════════════════════════════════════════════════════════

    function registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver) external {
        core.registerCollection(collection, royaltyFee, royaltyReceiver, msg.sender);
    }

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee) external {
        core.updateCollectionRoyalty(collection, royaltyReceiver, royaltyFee, msg.sender);
    }

    function verifyCollection(address collection) external onlyOwner {
        core.verifyCollection(collection);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS - Delegate to Core/Bids
    // ═══════════════════════════════════════════════════════════════════════════════

    function updateMarketplaceFee(uint16 newFee) external onlyOwner {
        core.updateMarketplaceFee(newFee);
    }

    function updateFeeReceiver(address newReceiver) external onlyOwner {
        core.updateFeeReceiver(newReceiver);
    }

    function pause() external onlyOwner {
        core.pause();
        bids.pause();
    }

    function unpause() external onlyOwner {
        core.unpause();
        bids.unpause();
    }


    function emergencyUpdateCollectionRoyalty(
        address collection,
        address royaltyReceiver,
        uint16 royaltyFee
    ) external onlyOwner {
        core.emergencyUpdateCollectionRoyalty(collection, royaltyReceiver, royaltyFee);
    }

    function configureBidsMarketplace() external onlyOwner {
        bids.setMarketplaceAddress(address(this));
    }

    function pendingWithdrawals(address account) external view returns (uint256 coreAmount, uint256 bidsAmount) {
        coreAmount = core.pendingWithdrawals(account);
        bidsAmount = bids.pendingWithdrawals(account);
    }

    function withdraw() external {
        core.withdrawFor(msg.sender);
        bids.withdrawFor(msg.sender);
    }

    function sweepExcessETH(address payable recipient) external onlyOwner {
        core.sweepExcessETH(recipient);
        bids.sweepExcessETH(recipient);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // RECEIVE & FALLBACK
    // ═══════════════════════════════════════════════════════════════════════════════

    receive() external payable {}

    fallback() external payable {
        revert("Invalid call");
    }
}
