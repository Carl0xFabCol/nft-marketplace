// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IERC173 {
    function owner() external view returns (address);
}

/**
 * @title MarketplaceCore
 * @notice Core marketplace functionality: listings, sales, and collection management
 */
contract MarketplaceCore is Ownable2Step, ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_MARKETPLACE_FEE = 1_000; // 10%
    uint256 public constant MAX_ROYALTY_FEE = 2_000; // 20%
    uint128 public constant MIN_LISTING_PRICE = 1 wei;
    uint256 public constant ROYALTY_QUERY_GAS = 50_000;
    uint256 public constant MAX_BATCH_SIZE = 50;

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
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    address public feeReceiver;
    uint16 public marketplaceFee;

    uint256 public totalVolume;
    uint256 public totalSales;
    uint256 public totalListings;

    mapping(address => CollectionInfo) public collections;
    mapping(address => mapping(uint256 => Listing)) public listings;

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
    event CollectionRoyaltyUpdated(address indexed collection, address indexed royaltyReceiver, uint16 royaltyFee);
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

    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) public whenNotPaused onlyRouter {
        _createListing(collection, tokenId, price, expiresAt, seller);
    }

    function _createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) internal {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert ListingExpired();

        IERC721 nft = IERC721(collection);
        address currentOwner = nft.ownerOf(tokenId);
        if (currentOwner != seller) revert NotTokenOwner();
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

        listings[collection][tokenId] = Listing({
            seller: seller,
            price: price,
            listedAt: uint48(block.timestamp),
            expiresAt: uint48(expiresAt),
            feeBps: marketplaceFee
        });

        unchecked {
            ++totalListings;
        }

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

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice, address seller) external whenNotPaused onlyRouter {
        Listing storage listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();

        address currentOwner = IERC721(collection).ownerOf(tokenId);
        if (listing.seller != currentOwner) {
            // M-01: stale listing. Drop it and fail the update. NOTE: the
            // revert rolls back the delete; cleanup happens the next time the
            // owner calls createListing (TODO(audit): optionally add an
            // explicit permissionless cleanup entrypoint).
            address staleSeller = listing.seller;
            delete listings[collection][tokenId];
            --totalListings;
            emit ListingCancelled(collection, tokenId, staleSeller);
            revert ListingNotFound();
        }

        if (currentOwner != seller) revert NotTokenOwner();
        if (listing.seller != seller) revert NotSeller();
        if (newPrice < MIN_LISTING_PRICE) revert InvalidPrice();

        listing.price = newPrice;
        emit ListingUpdated(collection, tokenId, newPrice);
    }

    function cancelListing(address collection, uint256 tokenId, address seller) external onlyRouter {
        _cancelListing(collection, tokenId, seller);
    }

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, address seller) external onlyRouter {
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
        unchecked {
            --totalListings;
        }

        emit ListingCancelled(collection, tokenId, seller);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BUYING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function buy(address collection, uint256 tokenId, address buyer) external payable whenNotPaused nonReentrant onlyRouter {
        Listing memory listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();
        if (listing.expiresAt != 0 && listing.expiresAt <= block.timestamp) revert ListingExpired();

        // M-01: never execute against a listing whose seller no longer owns the
        // token. NOTE: the revert rolls back the delete; the stale entry is
        // overwritten by createListing or ignored by future buyers.
        if (IERC721(collection).ownerOf(tokenId) != listing.seller) {
            delete listings[collection][tokenId];
            --totalListings;
            emit ListingCancelled(collection, tokenId, listing.seller);
            revert ListingNotFound();
        }

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
            if (buyer == listing.seller) revert SelfPurchase();
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
        uint128 marketplaceFeeAmount = uint128((uint256(listing.price) * effectiveFee) / BASIS_POINTS);
        (address royaltyReceiver, uint256 royaltyAmount) = _getRoyalty(collection, tokenId, uint256(listing.price));
        if (uint256(marketplaceFeeAmount) + royaltyAmount > listing.price) revert RoyaltyExceedsPrice();
        uint128 sellerProceeds = listing.price - marketplaceFeeAmount - uint128(royaltyAmount);

        // Effects before interaction: clear the listing before ERC721 receiver code runs.
        delete listings[collection][tokenId];
        unchecked {
            --totalListings;
        }

        IERC721(collection).safeTransferFrom(listing.seller, buyer, tokenId);

        _credit(feeReceiver, marketplaceFeeAmount);
        _credit(listing.seller, sellerProceeds);
        if (royaltyAmount > 0) {
            _credit(royaltyReceiver, royaltyAmount);
        }
        totalPendingWithdrawals += listing.price;

        unchecked {
            totalVolume += listing.price;
            ++totalSales;
            collections[collection].totalVolume += listing.price;
            ++collections[collection].totalSales;
        }

        emit Sale(collection, tokenId, listing.seller, buyer, listing.price, marketplaceFeeAmount, uint128(royaltyAmount));
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
        if (nft.ownerOf(tokenId) != seller) revert NotTokenOwner();
        if (!_isApproved(collection, seller, tokenId)) revert NotApproved();

        marketplaceFeeAmount = uint128((uint256(price) * marketplaceFee) / BASIS_POINTS);
        (royaltyReceiver, royaltyAmount) = _getRoyalty(collection, tokenId, uint256(price));
        if (uint256(marketplaceFeeAmount) + royaltyAmount > price) revert RoyaltyExceedsPrice();

        // Effects before interaction.
        if (listings[collection][tokenId].price > 0) {
            address listedSeller = listings[collection][tokenId].seller;
            delete listings[collection][tokenId];
            unchecked {
                --totalListings;
            }
            emit ListingCancelled(collection, tokenId, listedSeller);
        }

        nft.safeTransferFrom(seller, buyer, tokenId);

        unchecked {
            totalVolume += price;
            ++totalSales;
            collections[collection].totalVolume += price;
            ++collections[collection].totalSales;
        }

        return (marketplaceFeeAmount, royaltyReceiver, royaltyAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Registers a collection deployed by an authorized launchpad.
     * @dev H-02: launchpads get their own entrypoint. They can only register a
     *      collection they actually deployed and whose on-chain owner matches
     *      the factory-supplied creator.
     */
    function registerCollectionFromLaunchpad(
        address collection,
        uint16 royaltyFee,
        address royaltyReceiver,
        address creator
    ) external onlyLaunchpad {
        _validateNewCollection(collection, royaltyFee, royaltyReceiver);

        if (creator == address(0)) revert InvalidAddress();
        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);
        if (!hasOwner || collectionOwner != creator) revert NotCollectionOwner();

        // Factory provenance check. LaunchPad exposes isCollection(); other
        // factories must implement the same hook (TODO(audit): allow an
        // explicit factory allow-list if a launchpad has a different surface).
        if (!_isFactoryCollection(msg.sender, collection)) revert InvalidCollection();

        _storeCollection(collection, royaltyFee, royaltyReceiver, creator);
    }

    /**
     * @notice Registers an externally-deployed collection via the router.
     * @dev H-02: the router is the only path for arbitrary collections. The
     *      creator is derived from the collection owner when available.
     */
    function registerCollectionFromRouter(
        address collection,
        uint16 royaltyFee,
        address royaltyReceiver,
        address creator
    ) external onlyRouter {
        _validateNewCollection(collection, royaltyFee, royaltyReceiver);

        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);
        if (hasOwner) {
            creator = collectionOwner;
        } else if (creator == address(0)) {
            creator = owner();
        }

        _storeCollection(collection, royaltyFee, royaltyReceiver, creator);
    }

    function _validateNewCollection(address collection, uint16 royaltyFee, address royaltyReceiver) internal view {
        if (collection == address(0)) revert InvalidCollection();
        if (collections[collection].exists) revert CollectionAlreadyRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0) && royaltyFee != 0) revert InvalidAddress();

        (bool ok165, bool ok721) = _supportsERC721(collection);
        if (!ok165 || !ok721) revert InvalidCollection();
    }

    function _storeCollection(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) internal {
        collections[collection] = CollectionInfo({
            royaltyReceiver: royaltyReceiver,
            royaltyFee: royaltyFee,
            totalVolume: 0,
            totalSales: 0,
            isVerified: false,
            exists: true
        });

        emit CollectionRegistered(collection, creator, royaltyFee, false);
    }

    function _supportsERC721(address collection) internal view returns (bool ok165, bool ok721) {
        (bool success, bytes memory data) = collection.staticcall(
            abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IERC165).interfaceId)
        );
        if (!success || data.length < 32 || !abi.decode(data, (bool))) return (false, false);
        ok165 = true;

        (success, data) = collection.staticcall(
            abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IERC721).interfaceId)
        );
        ok721 = success && data.length >= 32 && abi.decode(data, (bool));
    }

    function _isFactoryCollection(address factory, address collection) internal view returns (bool) {
        (bool success, bytes memory data) = factory.staticcall(
            abi.encodeWithSelector(IFactory.isCollection.selector, collection)
        );
        if (!success || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee, address sender) external onlyRouter {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0) && royaltyFee != 0) revert InvalidAddress();

        (bool hasOwner, address collectionOwner) = _tryCollectionOwner(collection);
        if (!hasOwner || collectionOwner != sender) revert NotCollectionOwner();

        collections[collection].royaltyReceiver = royaltyReceiver;
        collections[collection].royaltyFee = royaltyFee;
        emit CollectionRoyaltyUpdated(collection, royaltyReceiver, royaltyFee);
    }



    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    // Admin recovery path for a bad/non-ownable registration.
    function emergencyUpdateCollectionRoyalty(
        address collection,
        address royaltyReceiver,
        uint16 royaltyFee
    ) external onlyOwner {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0) && royaltyFee != 0) revert InvalidAddress();

        collections[collection].royaltyReceiver = royaltyReceiver;
        collections[collection].royaltyFee = royaltyFee;
        emit CollectionRoyaltyUpdated(collection, royaltyReceiver, royaltyFee);
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
        router = newRouter;
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
        unchecked {
            totalPendingWithdrawals -= amount;
        }

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
        IERC721 nft = IERC721(collection);
        try nft.getApproved(tokenId) returns (address approved) {
            if (approved == address(this)) return true;
        } catch {}
        return nft.isApprovedForAll(tokenOwner, address(this));
    }

    function _tryCollectionOwner(address collection)
        internal
        view
        returns (bool hasOwner, address collectionOwner)
    {
        (bool success, bytes memory data) =
            collection.staticcall(abi.encodeWithSelector(IERC173.owner.selector));

        if (success && data.length >= 32) {
            collectionOwner = abi.decode(data, (address));
            hasOwner = true;
        }
    }

    function _getRoyalty(address collection, uint256 tokenId, uint256 salePrice) internal view returns (address receiver, uint256 amount) {
        // M-04: query ERC-2981 defensively. A malicious collection must not be
        // able to grief or drain a sale via unbounded gas/revert/receiver tricks.
        (bool success, bytes memory data) = collection.staticcall{gas: ROYALTY_QUERY_GAS}(
            abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IMarketplaceRoyalty).interfaceId)
        );

        if (success && data.length >= 32 && abi.decode(data, (bool))) {
            (success, data) = collection.staticcall{gas: ROYALTY_QUERY_GAS}(
                abi.encodeWithSelector(IMarketplaceRoyalty.royaltyInfo.selector, tokenId, salePrice)
            );

            if (success && data.length >= 64) {
                (address r, uint256 a) = abi.decode(data, (address, uint256));
                uint256 maxRoyalty = (salePrice * MAX_ROYALTY_FEE) / BASIS_POINTS;
                if (r != address(0) && a <= maxRoyalty) {
                    return (r, a);
                }
            }
        }

        CollectionInfo memory info = collections[collection];
        receiver = info.royaltyReceiver;
        amount = (salePrice * info.royaltyFee) / BASIS_POINTS;
        if (receiver == address(0)) {
            amount = 0;
        }
    }

    receive() external payable {}

    fallback() external payable {
        revert InvalidCall();
    }

    function renounceOwnership() public override {
        revert RenounceOwnershipDisabled();
    }
}

interface IMarketplaceRoyalty is IERC165 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount);
}

interface IFactory {
    function isCollection(address collection) external view returns (bool);
}
