// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IMarketplaceCore {
    // Structs
    struct Listing {
        address seller;
        uint128 price;
        uint48 listedAt;
        uint48 expiresAt;
        uint16 feeBps;
        uint16 royaltyBps;
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

    function listings(address, uint256) external view returns (address, uint128, uint48, uint48, uint16, uint16);

    // Listing functions
    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) external;

    function createListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts, address seller) external;

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice, address seller) external;

    function cancelListing(address collection, uint256 tokenId, address seller) external;

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, address seller) external;
    function cleanStaleListing(address collection, uint256 tokenId) external;

    // Buying functions
    function buy(address collection, uint256 tokenId, address buyer) external payable;

    function buyBatch(address collection, uint256[] calldata tokenIds, address buyer) external payable;

    // Collection management
    function registerCollectionFromRouter(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external;
    function registerCollectionFromLaunchpad(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external;
    function proposeRegisterCollectionFromRouter(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external;
    function proposeRegisterCollectionFromLaunchpad(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external;
    function executeRegisterCollection(address collection) external;
    function isRegistered(address collection) external view returns (bool);
    function emergencyUpdateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee) external;
    function proposeEmergencyUpdateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee) external;
    function executeEmergencyUpdateCollectionRoyalty(address collection) external;
    function pendingRegistrations(address collection) external view returns (uint16 royaltyFee, address royaltyReceiver, address creator, uint64 executableAt, bool exists);
    function pendingEmergencyRoyaltyUpdates(address collection) external view returns (address royaltyReceiver, uint16 royaltyFee, uint64 executableAt, bool exists);

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee, address sender) external;

    function clearRoyaltyOverride(address collection) external;
    function royaltyOverridden(address collection) external view returns (bool);

    function verifyCollection(address collection) external;
    function unverifyCollection(address collection) external;

    // Admin functions
    function updateMarketplaceFee(uint16 newFee) external;

    function updateFeeReceiver(address newReceiver) external;

    

    function setRouter(address newRouter) external;
    function setBidsContract(address newBids) external;

    function setAuthorizedLaunchpad(address launchpad, bool authorized) external;

    function authorizedLaunchpads(address launchpad) external view returns (bool);

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

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds, address seller, uint128 minPricePerItem, uint128 minSellerProceeds) external;

    function cancelCollectionBid(address collection, address bidder) external;

    // Token bid functions
    function placeTokenBid(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address bidder) external payable;

    function placeTokenBidBatch(address collection, uint256[] calldata tokenIds, uint128[] calldata prices, uint64[] calldata expiresAts, address bidder) external payable;

    function acceptTokenBid(address collection, uint256 tokenId, address bidder, address seller, uint128 minPrice, uint128 minSellerProceeds) external;

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

    function paused() external view returns (bool);
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
        uint48 listedAt;
        uint48 expiresAt;
        uint16 feeBps;
        uint16 royaltyBps;
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

    error SweepFailed();
    error NoWithdrawal();
    error RenounceOwnershipDisabled();
    error InvalidAddress();
    error ComponentsNotOwned();

    event ComponentOwnershipTransferStarted(address indexed newOwner);

    constructor(address _core, address _bids) Ownable(msg.sender) {
        if (_core == address(0) || _bids == address(0)) revert InvalidAddress();
        core = IMarketplaceCore(_core);
        bids = IMarketplaceBids(_bids);
    }

    // The deployer transfers Core and Bids ownership to this router first.
    // The router owner then calls this once so both components accept ownership.
    function acceptComponentOwnership() external onlyOwner {
        if (core.pendingOwner() == address(this)) core.acceptOwnership();
        if (bids.pendingOwner() == address(this)) bids.acceptOwnership();
        if (core.owner() != address(this) || bids.owner() != address(this)) revert ComponentsNotOwned();
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
        (address seller, uint128 price, uint48 listedAt, uint48 expiresAt, uint16 feeBps, uint16 royaltyBps) = core.listings(collection, tokenId);
        return Listing(seller, price, listedAt, expiresAt, feeBps, royaltyBps);
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

    function cleanStaleListing(address collection, uint256 tokenId) external {
        core.cleanStaleListing(collection, tokenId);
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

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds, uint128 minPricePerItem, uint128 minSellerProceeds) external {
        bids.acceptCollectionBid(collection, bidder, tokenIds, msg.sender, minPricePerItem, minSellerProceeds);
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

    function acceptTokenBid(address collection, uint256 tokenId, address bidder, uint128 minPrice, uint128 minSellerProceeds) external {
        bids.acceptTokenBid(collection, tokenId, bidder, msg.sender, minPrice, minSellerProceeds);
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

    /// @notice Legacy alias for `proposeRegisterCollection`. Restricted to the
    ///         owner/admin; registration only takes effect after the delay.
    function registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver) external onlyOwner {
        core.registerCollectionFromRouter(collection, royaltyFee, royaltyReceiver, msg.sender);
    }

    /// @notice M-03: propose an external collection registration. It becomes
    ///         effective only after Core's REGISTRATION_DELAY.
    function proposeRegisterCollection(address collection, uint16 royaltyFee, address royaltyReceiver) external onlyOwner {
        core.proposeRegisterCollectionFromRouter(collection, royaltyFee, royaltyReceiver, msg.sender);
    }

    /// @notice M-03: execute a queued registration after the delay.
    function executeRegisterCollection(address collection) external {
        core.executeRegisterCollection(collection);
    }

    function pendingRegistrations(address collection) external view returns (uint16 royaltyFee, address royaltyReceiver, address creator, uint64 executableAt, bool exists) {
        return core.pendingRegistrations(collection);
    }

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee) external {
        core.updateCollectionRoyalty(collection, royaltyReceiver, royaltyFee, msg.sender);
    }

    /// @notice M-04: clear a Core royalty override so ERC-2981 is used again.
    function clearRoyaltyOverride(address collection) external onlyOwner {
        core.clearRoyaltyOverride(collection);
    }

    function royaltyOverridden(address collection) external view returns (bool) {
        return core.royaltyOverridden(collection);
    }

    function verifyCollection(address collection) external onlyOwner {
        core.verifyCollection(collection);
    }

    function unverifyCollection(address collection) external onlyOwner {
        core.unverifyCollection(collection);
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

    

    function setAuthorizedLaunchpad(address launchpad, bool authorized) external onlyOwner {
        core.setAuthorizedLaunchpad(launchpad, authorized);
    }

    function authorizedLaunchpads(address launchpad) external view returns (bool) {
        return core.authorizedLaunchpads(launchpad);
    }

    function pause() external onlyOwner {
        // M-06: idempotent across components; one already-paused component must
        // not block pausing the other.
        if (!core.paused()) core.pause();
        if (!bids.paused()) bids.pause();
    }

    function unpause() external onlyOwner {
        if (core.paused()) core.unpause();
        if (bids.paused()) bids.unpause();
    }


    function emergencyUpdateCollectionRoyalty(
        address collection,
        address royaltyReceiver,
        uint16 royaltyFee
    ) external onlyOwner {
        core.emergencyUpdateCollectionRoyalty(collection, royaltyReceiver, royaltyFee);
    }

    /// @notice M-03: propose an emergency royalty update. It becomes effective
    ///         only after Core's REGISTRATION_DELAY.
    function proposeEmergencyUpdateCollectionRoyalty(
        address collection,
        address royaltyReceiver,
        uint16 royaltyFee
    ) external onlyOwner {
        core.proposeEmergencyUpdateCollectionRoyalty(collection, royaltyReceiver, royaltyFee);
    }

    function executeEmergencyUpdateCollectionRoyalty(address collection) external onlyOwner {
        core.executeEmergencyUpdateCollectionRoyalty(collection);
    }

    function pendingEmergencyRoyaltyUpdates(address collection) external view returns (address royaltyReceiver, uint16 royaltyFee, uint64 executableAt, bool exists) {
        return core.pendingEmergencyRoyaltyUpdates(collection);
    }

    function configureBidsMarketplace() external onlyOwner {
        core.setRouter(address(this));
        core.setBidsContract(address(bids));
        bids.setMarketplaceAddress(address(this));
    }

    /// @notice M-07: migrate the whole system to a new owner (e.g. a new
    ///         timelock) by starting the Ownable2Step handoff on both components.
    function transferComponentOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        core.transferOwnership(newOwner);
        bids.transferOwnership(newOwner);
        emit ComponentOwnershipTransferStarted(newOwner);
    }

    function pendingWithdrawals(address account) external view returns (uint256 coreAmount, uint256 bidsAmount) {
        coreAmount = core.pendingWithdrawals(account);
        bidsAmount = bids.pendingWithdrawals(account);
    }

    function withdraw() external {
        bool a = core.withdrawFor(msg.sender);
        bool b = bids.withdrawFor(msg.sender);
        if (!a && !b) revert NoWithdrawal();
    }

    function sweepExcessETH(address payable recipient) external onlyOwner {
        // M-06: a component without excess must not make the whole sweep fail.
        bool coreSwept;
        bool bidsSwept;
        try core.sweepExcessETH(recipient) {
            coreSwept = true;
        } catch {}
        try bids.sweepExcessETH(recipient) {
            bidsSwept = true;
        } catch {}
        if (!coreSwept && !bidsSwept) revert SweepFailed();
    }

    function renounceOwnership() public override {
        revert RenounceOwnershipDisabled();
    }
}
