// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./BoundedStaticCall.sol";

interface IERC173 {
    function owner() external view returns (address);
}

/**
 * @title MarketplaceCore
 * @notice Core marketplace functionality: listings, sales, and collection management
 */
contract MarketplaceCore is BoundedStaticCall, Ownable2Step, ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_MARKETPLACE_FEE = 1_000; // 10%
    uint256 public constant MAX_ROYALTY_FEE = 2_000; // 20%
    uint128 public constant MIN_LISTING_PRICE = 1 wei;
    uint256 public constant ROYALTY_QUERY_GAS = 50_000;
    uint256 public constant OWNER_QUERY_GAS = 150_000;
    uint256 public constant CLEANUP_OWNER_QUERY_GAS = 30_000;

    uint256 public constant MAX_BATCH_SIZE = 50;
    uint256 public constant MAX_LISTING_DURATION = 30 days;

    // ═══════════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════

    struct Listing {
        // M-03: two storage slots. The fee is snapshotted at listing time so an
        // admin fee change cannot front-run a pending sale.
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

    enum RoyaltySource {
        ERC2981,
        Override
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    address public feeReceiver;
    uint16 public marketplaceFee;

    uint256 public totalVolume;
    uint256 public totalSales;
    uint256 public totalListings;

    mapping(address => CollectionInfo) public collections;
    mapping(address => mapping(uint256 => Listing)) public listings;

    // M-04: once governance/creator explicitly updates a collection's royalty,
    // Core values take precedence over the collection's ERC-2981 response.
    mapping(address => bool) public royaltyOverridden;

    // N-01: immutable router address, set once.
    address public router;

    // Dedicated bids executor. Bids are the only caller allowed to execute a
    // sale on behalf of a bid (H-02).
    address public bidsContract;

    // Authorized launchpad factories. Collections deployed by these contracts
    // are registered with the creator auto-filled by the factory.
    mapping(address => bool) public authorizedLaunchpads;

    // Pull-payment ledger. Sales never push ETH to arbitrary recipients.
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public totalPendingWithdrawals;

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event CollectionRegistered(address indexed collection, address indexed owner, uint16 royaltyFee, bool isVerified);
    event ListingCreated(address indexed collection, uint256 indexed tokenId, address indexed seller, uint128 price, uint64 expiresAt);
    event ListingUpdated(address indexed collection, uint256 indexed tokenId, uint128 newPrice);
    event ListingCancelled(address indexed collection, uint256 indexed tokenId, address indexed seller);
    event Sale(address indexed collection, uint256 indexed tokenId, address indexed seller, address buyer, uint128 price, uint128 marketplaceFeeAmount, uint128 royaltyAmount);
    event MarketplaceFeeUpdated(uint16 oldFee, uint16 newFee);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event CollectionVerified(address indexed collection);
    event CollectionUnverified(address indexed collection);
    event LaunchpadAuthorized(address indexed launchpad, bool authorized);
    event BidsContractUpdated(address indexed oldBids, address indexed newBids);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event CollectionRoyaltyUpdated(address indexed collection, address indexed royaltyReceiver, uint16 royaltyFee);
    event RoyaltySourceUsed(address indexed collection, uint256 indexed tokenId, uint256 price, RoyaltySource source);
    event RoyaltyOverrideCleared(address indexed collection);
    event CollectionRegistrationExecuted(address indexed collection, address indexed creator);
    event Withdrawal(address indexed account, uint256 amount);
    event ExcessETHSwept(address indexed recipient, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    error InvalidCollection();
    error RenounceOwnershipDisabled();
    error InvalidCall();
    error CollectionAlreadyRegistered();
    error CollectionNotRegistered();
    error NotCollectionOwner();
    error InvalidPrice();
    error NotTokenOwner();
    error NotApproved();
    error ListingNotFound();
    error ListingExpired();
    error InsufficientValue();
    error TransferFailed();
    error NotSeller();
    error FeeTooHigh();
    error ArrayLengthMismatch();
    error SelfPurchase();
    error Unauthorized();
    error InvalidAddress();
    error NoWithdrawal();
    error InsufficientExcess();
    error CorePaused();
    error BatchTooLarge();
    error DuplicateTokenId();
    error RoyaltyExceedsPrice();
    error AlreadySet();
    error ExpiryTooLarge();
    error InvalidExpiry();
    error InsufficientGas();

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    modifier onlyBids() {
        if (msg.sender != bidsContract) revert Unauthorized();
        _;
    }

    modifier onlyLaunchpad() {
        if (!authorizedLaunchpads[msg.sender]) revert Unauthorized();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(uint16 _marketplaceFee, address _feeReceiver) Ownable(msg.sender) {
        if (_marketplaceFee > MAX_MARKETPLACE_FEE) revert FeeTooHigh();
        if (_feeReceiver == address(0)) _feeReceiver = msg.sender;

        marketplaceFee = _marketplaceFee;
        feeReceiver = _feeReceiver;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LISTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) public whenNotPaused onlyRouter nonReentrant {
        _createListing(collection, tokenId, price, expiresAt, seller);
    }

    function _createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) internal {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (uint256(expiresAt) > type(uint48).max) revert ExpiryTooLarge();
        // L-N3: listings must expire and can live for at most 30 days. A zero
        // expiry stays valid only for bids, so an expired listing can never be
        // resurrected as an unlimited-duration listing.
        if (expiresAt == 0 || expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_LISTING_DURATION) revert InvalidExpiry();

        // F-3: ownership is read through the bounded helper; malformed or
        // reverting ownerOf implementations are rejected as not-the-owner.
        (bool valid, , address currentOwner) = _tryOwnerOf(collection, tokenId);
        if (!valid || currentOwner != seller) revert NotTokenOwner();
        if (!_isApproved(collection, seller, tokenId)) revert NotApproved();

        Listing memory existing = listings[collection][tokenId];
        if (existing.price > 0) {
            if (existing.seller != currentOwner) {
                // M-01: stale listing (the token moved). Replacing it must not
                // require the old seller's cooperation.
                delete listings[collection][tokenId];
                --totalListings;
                emit ListingCancelled(collection, tokenId, existing.seller);
            } else {
                _cancelListing(collection, tokenId, seller);
            }
        }

        // N-03: snapshot royalty at listing time
        uint16 royaltyBps = _royaltyBpsFor(collection, tokenId, uint256(price));

        listings[collection][tokenId] = Listing({
            seller: seller,
            price: price,
            listedAt: SafeCast.toUint48(block.timestamp),
            expiresAt: SafeCast.toUint48(uint256(expiresAt)),
            feeBps: marketplaceFee,
            royaltyBps: royaltyBps
        });

        ++totalListings;

        emit ListingCreated(collection, tokenId, seller, price, expiresAt);
    }

    function createListingBatch(
        address[] calldata collections_,
        uint256[] calldata tokenIds,
        uint128[] calldata prices,
        uint64[] calldata expiresAts,
        address seller
    ) external whenNotPaused onlyRouter {
        uint256 length = collections_.length;
        if (length != tokenIds.length || length != prices.length || length != expiresAts.length) revert ArrayLengthMismatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i; i < length; ) {
            _createListing(collections_[i], tokenIds[i], prices[i], expiresAts[i], seller);
            unchecked {
                ++i;
            }
        }
    }

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice, address seller) external whenNotPaused onlyRouter nonReentrant {
        Listing storage listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();
        if (listing.expiresAt != 0 && listing.expiresAt <= block.timestamp) revert ListingExpired();

        // N-02: check if listing is stale using safe ownerOf check
        (bool valid, , address currentOwner) = _tryOwnerOf(collection, tokenId);
        if (!valid || listing.seller != currentOwner) revert ListingNotFound();

        if (currentOwner != seller) revert NotTokenOwner();
        if (listing.seller != seller) revert NotSeller();
        if (newPrice < MIN_LISTING_PRICE) revert InvalidPrice();

        listing.price = newPrice;
        // H-01: the royalty snapshot must track the new price, otherwise a
        // 1-wei listing followed by a price update evades royalties entirely.
        listing.royaltyBps = _royaltyBpsFor(collection, tokenId, uint256(newPrice));
        emit ListingUpdated(collection, tokenId, newPrice);
    }

    function cancelListing(address collection, uint256 tokenId, address seller) external onlyRouter nonReentrant {
        _cancelListing(collection, tokenId, seller);
    }

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, address seller) external onlyRouter nonReentrant {
        uint256 length = collections_.length;
        if (length != tokenIds.length) revert ArrayLengthMismatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i; i < length; ) {
            _cancelListing(collections_[i], tokenIds[i], seller);
            unchecked {
                ++i;
            }
        }
    }

    function _cancelListing(address collection, uint256 tokenId, address seller) internal {
        Listing memory listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();
        if (listing.seller != seller) revert NotSeller();

        delete listings[collection][tokenId];
        --totalListings;

        emit ListingCancelled(collection, tokenId, seller);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BUYING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function buy(address collection, uint256 tokenId, address buyer) external payable whenNotPaused nonReentrant onlyRouter {
        Listing memory listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();
        if (listing.expiresAt != 0 && listing.expiresAt <= block.timestamp) revert ListingExpired();

        // N-02: check if listing is stale using safe ownerOf check
        (bool valid, , address currentOwner) = _tryOwnerOf(collection, tokenId);
        if (!valid || currentOwner != listing.seller) revert ListingNotFound();

        if (msg.value != listing.price) revert InsufficientValue();

        _executeSale(collection, tokenId, listing, buyer);
    }

    function buyBatch(address collection, uint256[] calldata tokenIds, address buyer) external payable whenNotPaused nonReentrant onlyRouter {
        uint256 totalPrice;
        uint256 length = tokenIds.length;
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();

        // G-06: read each listing from storage exactly once.
        Listing[] memory cached = new Listing[](length);

        for (uint256 i; i < length; ) {
            for (uint256 j; j < i; ) {
                if (tokenIds[j] == tokenIds[i]) revert DuplicateTokenId();
                unchecked {
                    ++j;
                }
            }

            Listing memory listing = listings[collection][tokenIds[i]];
            if (listing.price == 0) revert ListingNotFound();
            if (listing.expiresAt != 0 && listing.expiresAt <= block.timestamp) revert ListingExpired();

            // N-02: check if listing is stale
            (bool valid, , address currentOwner) = _tryOwnerOf(collection, tokenIds[i]);
            if (!valid || currentOwner != listing.seller) revert ListingNotFound();

            cached[i] = listing;
            totalPrice += listing.price;
            unchecked {
                ++i;
            }
        }

        if (msg.value != totalPrice) revert InsufficientValue();

        for (uint256 i; i < length; ) {
            // L-01: never execute a listing that was already cleared (duplicate
            // ids are rejected above, but this also protects future refactors).
            if (listings[collection][tokenIds[i]].price == 0) revert ListingNotFound();
            _executeSale(collection, tokenIds[i], cached[i], buyer);
            unchecked {
                ++i;
            }
        }
    }

    function _executeSale(address collection, uint256 tokenId, Listing memory listing, address buyer) internal {
        if (buyer == listing.seller) revert SelfPurchase();

        // M-03: never charge more than the fee that was in force when the
        // listing was created; a fee reduction still benefits the seller.
        uint16 effectiveFee = listing.feeBps < marketplaceFee ? listing.feeBps : marketplaceFee;
        uint128 marketplaceFeeAmount = SafeCast.toUint128((uint256(listing.price) * effectiveFee) / BASIS_POINTS);
        (address royaltyReceiver, uint256 royaltyAmount) = _getRoyalty(collection, tokenId, uint256(listing.price));

        // N-03: cap royalty at the snapshot value
        uint256 snapshotRoyalty = (uint256(listing.price) * listing.royaltyBps) / BASIS_POINTS;
        if (royaltyAmount > snapshotRoyalty) royaltyAmount = snapshotRoyalty;

        if (uint256(marketplaceFeeAmount) + royaltyAmount > listing.price) revert RoyaltyExceedsPrice();
        uint128 sellerProceeds = listing.price - marketplaceFeeAmount - SafeCast.toUint128(royaltyAmount);

        // Effects before interaction: clear the listing before ERC721 receiver code runs.
        delete listings[collection][tokenId];
        --totalListings;

        _credit(feeReceiver, marketplaceFeeAmount);
        _credit(listing.seller, sellerProceeds);
        if (royaltyAmount > 0) {
            _credit(royaltyReceiver, royaltyAmount);
        }

        IERC721(collection).safeTransferFrom(listing.seller, buyer, tokenId);

        totalVolume += listing.price;
        ++totalSales;
        collections[collection].totalVolume += listing.price;
        ++collections[collection].totalSales;

        emit Sale(collection, tokenId, listing.seller, buyer, listing.price, marketplaceFeeAmount, SafeCast.toUint128(royaltyAmount));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXTERNAL SALE EXECUTION (for bids contract)
    // ═══════════════════════════════════════════════════════════════════════════════

    function executeSaleFromBid(
        address collection,
        uint256 tokenId,
        address seller,
        address buyer,
        uint128 price
    ) external onlyBids nonReentrant returns (uint128 marketplaceFeeAmount, address royaltyReceiver, uint256 royaltyAmount) {
        if (seller == buyer) revert SelfPurchase();

        IERC721 nft = IERC721(collection);
        // F-3: never trust a direct ownerOf call; fail closed on malformed or
        // reverting implementations.
        (bool valid, , address currentOwner) = _tryOwnerOf(collection, tokenId);
        if (!valid || currentOwner != seller) revert NotTokenOwner();
        if (!_isApproved(collection, seller, tokenId)) revert NotApproved();

        marketplaceFeeAmount = SafeCast.toUint128((uint256(price) * marketplaceFee) / BASIS_POINTS);
        (royaltyReceiver, royaltyAmount) = _getRoyalty(collection, tokenId, uint256(price));
        if (uint256(marketplaceFeeAmount) + royaltyAmount > price) revert RoyaltyExceedsPrice();

        // Effects before interaction.
        if (listings[collection][tokenId].price > 0) {
            address listedSeller = listings[collection][tokenId].seller;
            delete listings[collection][tokenId];
            --totalListings;
            emit ListingCancelled(collection, tokenId, listedSeller);
        }

        nft.safeTransferFrom(seller, buyer, tokenId);

        totalVolume += price;
        ++totalSales;
        collections[collection].totalVolume += price;
        ++collections[collection].totalSales;

        emit Sale(collection, tokenId, seller, buyer, price, marketplaceFeeAmount, SafeCast.toUint128(royaltyAmount));

        return (marketplaceFeeAmount, royaltyReceiver, royaltyAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Registers immediately a collection deployed by an authorized LaunchPad.
     * @dev LaunchPad registrations bypass the registration delay because the
     *      factory is explicitly authorized and collection provenance is validated.
     */
    function registerCollectionFromLaunchpad(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external onlyLaunchpad {
        _registerCollectionFromLaunchpad(collection, royaltyFee, royaltyReceiver, creator);
    }

    function _registerCollectionFromLaunchpad(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) internal {
        _validateNewCollection(collection, royaltyFee, royaltyReceiver);

        if (creator == address(0)) revert InvalidAddress();

        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);

        if (!hasOwner || collectionOwner != creator) {
            revert NotCollectionOwner();
        }

        // Verify that this collection was deployed by the authorized LaunchPad.
        if (!_isFactoryCollection(msg.sender, collection)) {
            revert InvalidCollection();
        }

        _storeCollection(collection, royaltyFee, royaltyReceiver, creator);
    }

    /**
     * @notice Registers an externally-deployed collection via the router.
     *
     * @dev Registration is IMMEDIATE. The delayed-registration flow this used to
     *      schedule was removed; only the `CollectionRegistrationExecuted` event
     *      name still carries that history, and it is kept for ABI stability.
     *
     * @dev The royalty stored here is a FALLBACK, not an enforced override. This
     *      path does not set `royaltyOverridden`, so `_getRoyalty` prefers the
     *      collection's own ERC-2981 `royaltyInfo` whenever it answers with a
     *      non-zero receiver and an amount within MAX_ROYALTY_FEE. These values
     *      apply only when ERC-2981 is absent or unusable. The marketplace-side
     *      values become authoritative only via `updateCollectionRoyalty`, which
     *      is the sole writer of `royaltyOverridden`.
     */
    function registerCollectionFromRouter(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external onlyRouter {
        _registerCollectionFromRouter(collection, royaltyFee, royaltyReceiver, creator);
    }

    function _registerCollectionFromRouter(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) internal {
        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);
        if (hasOwner) {
            creator = collectionOwner;
        } else if (creator == address(0)) {
            creator = owner();
        }

        _validateNewCollection(collection, royaltyFee, royaltyReceiver);
        _storeCollection(collection, royaltyFee, royaltyReceiver, creator);
        emit CollectionRegistrationExecuted(collection, creator);
    }

    function _validateNewCollection(address collection, uint16 royaltyFee, address royaltyReceiver) internal view {
        if (collection == address(0)) revert InvalidCollection();
        if (collections[collection].exists) revert CollectionAlreadyRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0)) revert InvalidAddress();

        (bool ok165, bool ok721) = _supportsERC721(collection);
        if (!ok165 || !ok721) revert InvalidCollection();
    }

    function _storeCollection(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) internal {
        collections[collection] = CollectionInfo({royaltyReceiver: royaltyReceiver, royaltyFee: royaltyFee, totalVolume: 0, totalSales: 0, isVerified: false, exists: true});

        emit CollectionRegistered(collection, creator, royaltyFee, false);
    }

    function _supportsERC721(address collection) internal view returns (bool ok165, bool ok721) {
        (bool success, uint256 word) = _staticcallBounded(collection, abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IERC165).interfaceId));
        if (!success || word != 1) return (false, false);
        ok165 = true;

        (success, word) = _staticcallBounded(collection, abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IERC721).interfaceId));
        ok721 = success && word == 1;
    }

    function _isFactoryCollection(address factory, address collection) internal view returns (bool) {
        (bool success, uint256 word) = _staticcallBounded(factory, abi.encodeWithSelector(IFactory.isCollection.selector, collection));
        return success && word == 1;
    }

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee, address sender) external onlyRouter {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0) && royaltyFee != 0) revert InvalidAddress();

        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);
        if (!hasOwner || collectionOwner != sender) revert NotCollectionOwner();

        collections[collection].royaltyReceiver = royaltyReceiver;
        collections[collection].royaltyFee = royaltyFee;
        royaltyOverridden[collection] = true;
        emit CollectionRoyaltyUpdated(collection, royaltyReceiver, royaltyFee);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice M-04: undo a Core royalty override so ERC-2981 is used again.
    function clearRoyaltyOverride(address collection) external onlyOwner {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        royaltyOverridden[collection] = false;
        emit RoyaltyOverrideCleared(collection);
    }

    function verifyCollection(address collection) external onlyOwner {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        collections[collection].isVerified = true;
        emit CollectionVerified(collection);
    }

    function unverifyCollection(address collection) external onlyOwner {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        collections[collection].isVerified = false;
        emit CollectionUnverified(collection);
    }
    function updateMarketplaceFee(uint16 newFee) external onlyOwner {
        if (newFee > MAX_MARKETPLACE_FEE) revert FeeTooHigh();
        uint16 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit MarketplaceFeeUpdated(oldFee, newFee);
    }

    function updateFeeReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert InvalidAddress();
        address oldReceiver = feeReceiver;
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(oldReceiver, newReceiver);
    }

    function setRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert InvalidAddress();
        if (router != address(0)) revert AlreadySet();
        address oldRouter = router;
        router = newRouter;
        emit RouterUpdated(oldRouter, newRouter);
    }

    function setBidsContract(address newBids) external onlyOwner {
        if (newBids == address(0)) revert InvalidAddress();
        if (bidsContract != address(0)) revert AlreadySet();
        bidsContract = newBids;
        emit BidsContractUpdated(address(0), newBids);
    }

    function setAuthorizedLaunchpad(address launchpad, bool authorized) external onlyOwner {
        if (launchpad == address(0)) revert InvalidAddress();
        authorizedLaunchpads[launchpad] = authorized;
        emit LaunchpadAuthorized(launchpad, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function getCollectionStats(address collection) external view returns (uint256 totalColVolume, uint32 totalColSales, bool isVerified, bool exists) {
        CollectionInfo memory info = collections[collection];
        return (info.totalVolume, info.totalSales, info.isVerified, info.exists);
    }

    function isRegistered(address collection) external view returns (bool) {
        return collections[collection].exists;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _credit(address account, uint256 amount) internal {
        if (amount == 0) return;
        if (account == address(0)) revert InvalidAddress();

        pendingWithdrawals[account] += amount;
        totalPendingWithdrawals += amount;
    }

    function withdrawFor(address account) external nonReentrant onlyRouter returns (bool withdrawn) {
        if (pendingWithdrawals[account] == 0) return false;
        _withdraw(account);
        return true;
    }

    function withdraw() external nonReentrant {
        _withdraw(msg.sender);
    }

    function _withdraw(address account) internal {
        uint256 amount = pendingWithdrawals[account];
        if (amount == 0) revert NoWithdrawal();

        pendingWithdrawals[account] = 0;
        totalPendingWithdrawals -= amount;

        (bool success, ) = payable(account).call{value: amount}("");
        if (!success) {
            pendingWithdrawals[account] = amount;
            totalPendingWithdrawals += amount;
            revert TransferFailed();
        }

        emit Withdrawal(account, amount);
    }

    function sweepExcessETH(address payable recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance <= totalPendingWithdrawals) revert InsufficientExcess();

        uint256 amount = balance - totalPendingWithdrawals;
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ExcessETHSwept(recipient, amount);
    }

    function _isApproved(address collection, address tokenOwner, uint256 tokenId) internal view returns (bool) {
        (bool success, uint256 approvedWord) = _staticcallBounded(collection, abi.encodeWithSelector(IERC721.getApproved.selector, tokenId));
        if (success && _isAddressWord(approvedWord) && address(uint160(approvedWord)) == address(this)) {
            return true;
        }

        (success, approvedWord) = _staticcallBounded(collection, abi.encodeWithSelector(IERC721.isApprovedForAll.selector, tokenOwner, address(this)));
        return success && approvedWord == 1;
    }

    function _tryOwnerOf(address collection, uint256 tokenId) internal view returns (bool valid, bool reverted, address owner) {
        return _tryOwnerOfWithGas(collection, tokenId, OWNER_QUERY_GAS);
    }

    function _tryOwnerOfWithGas(address collection, uint256 tokenId, uint256 queryGas) internal view returns (bool valid, bool reverted, address owner) {
        // Account for EIP-150 and leave a small execution buffer.
        if (gasleft() < (queryGas * 64) / 63 + 5_000) {
            revert InsufficientGas();
        }

        (uint256 status, uint256 word) = _staticcallBoundedRaw(collection, abi.encodeWithSelector(IERC721.ownerOf.selector, tokenId), queryGas);

        if ((status & 1) == 0) {
            return (false, (status & 4) != 0, address(0));
        }

        if ((status & 2) == 0 || !_isAddressWord(word)) {
            return (false, false, address(0));
        }

        return (true, false, address(uint160(word)));
    }

    function _tryCollectionOwner(address collection) internal view returns (bool hasOwner, address collectionOwner) {
        (bool success, uint256 word) = _staticcallBounded(collection, abi.encodeWithSelector(IERC173.owner.selector));

        if (success && _isAddressWord(word)) {
            collectionOwner = address(uint160(word));
            hasOwner = true;
        }
    }

    function _requireRoyaltyQueryGas() internal view {
        if (gasleft() < (ROYALTY_QUERY_GAS * 64) / 63 + 5_000) {
            revert InsufficientGas();
        }
    }

    function _royaltyBpsFor(address collection, uint256 tokenId, uint256 price) internal returns (uint16) {
        (, uint256 amt) = _getRoyalty(collection, tokenId, price);
        if (amt == 0) return 0;
        uint256 bps = (amt * BASIS_POINTS + price - 1) / price;
        return SafeCast.toUint16(bps > MAX_ROYALTY_FEE ? MAX_ROYALTY_FEE : bps);
    }

    function _getRoyalty(address collection, uint256 tokenId, uint256 salePrice) internal returns (address receiver, uint256 amount) {
        // M-04: if Core values were explicitly set, they win over ERC-2981.
        if (royaltyOverridden[collection]) {
            CollectionInfo memory overrideInfo = collections[collection];
            receiver = overrideInfo.royaltyReceiver;
            amount = (salePrice * overrideInfo.royaltyFee) / BASIS_POINTS;
            if (receiver == address(0)) {
                amount = 0;
            }
            emit RoyaltySourceUsed(collection, tokenId, salePrice, RoyaltySource.Override);
            return (receiver, amount);
        }

        // M-04: query ERC-2981 defensively. A malicious collection must not be
        // able to grief or drain a sale via unbounded gas/revert/receiver tricks.
        _requireRoyaltyQueryGas();
        (bool success, uint256 word) = _staticcallBounded(collection, abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IMarketplaceRoyalty).interfaceId), ROYALTY_QUERY_GAS);

        if (success && word == 1) {
            _requireRoyaltyQueryGas();
            uint256 receiverWord;
            uint256 amountWord;
            (success, receiverWord, amountWord) = _staticcallBounded2(collection, abi.encodeWithSelector(IMarketplaceRoyalty.royaltyInfo.selector, tokenId, salePrice), ROYALTY_QUERY_GAS);

            if (success && _isAddressWord(receiverWord)) {
                address r = address(uint160(receiverWord));
                uint256 maxRoyalty = (salePrice * MAX_ROYALTY_FEE) / BASIS_POINTS;
                if (r != address(0) && amountWord <= maxRoyalty) {
                    emit RoyaltySourceUsed(collection, tokenId, salePrice, RoyaltySource.ERC2981);
                    return (r, amountWord);
                }
            }
        }

        CollectionInfo memory info = collections[collection];
        receiver = info.royaltyReceiver;
        amount = (salePrice * info.royaltyFee) / BASIS_POINTS;
        if (receiver == address(0)) {
            amount = 0;
        }
        emit RoyaltySourceUsed(collection, tokenId, salePrice, RoyaltySource.ERC2981);
    }

    receive() external payable {}

    fallback() external payable {
        revert InvalidCall();
    }

    function renounceOwnership() public override {
        revert RenounceOwnershipDisabled();
    }

    /// @notice Permissionless cleanup of stale or expired listings.
    function cleanStaleListing(address collection, uint256 tokenId) external nonReentrant {
        Listing storage listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();

        bool expired = listing.expiresAt != 0 && listing.expiresAt <= block.timestamp;
        if (!expired) {
            (bool valid, bool reverted, address currentOwner) = _tryOwnerOfWithGas(collection, tokenId, CLEANUP_OWNER_QUERY_GAS);

            if (reverted) {
                (valid, reverted, currentOwner) = _tryOwnerOf(collection, tokenId);
            }

            if (!reverted) {
                if (!valid) revert InvalidCall();
                if (currentOwner == listing.seller) revert InvalidCall();
            }
        }

        address staleSeller = listing.seller;
        delete listings[collection][tokenId];
        --totalListings;
        emit ListingCancelled(collection, tokenId, staleSeller);
    }
}

interface IMarketplaceRoyalty is IERC165 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount);
}

interface IFactory {
    function isCollection(address collection) external view returns (bool);
}
