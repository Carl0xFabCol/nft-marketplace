// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title MarketplaceCore
 * @notice Core marketplace functionality: listings, sales, and collection management
 */
contract MarketplaceCore is Ownable, ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_MARKETPLACE_FEE = 1_000; // 10%
    uint256 public constant MAX_ROYALTY_FEE = 2_000; // 20%
    uint128 public constant MIN_LISTING_PRICE = 1 wei;

    // ═══════════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════

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

    // Authorized contracts (bids contract)
    mapping(address => bool) public authorizedContracts;

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
    event ContractAuthorized(address indexed contractAddr, bool authorized);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    error InvalidCollection();
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender] && msg.sender != owner()) revert Unauthorized();
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

    function createListing(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address seller) public whenNotPaused onlyAuthorized {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert ListingExpired();

        IERC721 nft = IERC721(collection);
        if (nft.ownerOf(tokenId) != seller) revert NotTokenOwner();
        if (!nft.isApprovedForAll(seller, address(this))) revert NotApproved();

        if (listings[collection][tokenId].price > 0) {
            _cancelListing(collection, tokenId, seller);
        }

        listings[collection][tokenId] = Listing({seller: seller, price: price, listedAt: uint64(block.timestamp), expiresAt: expiresAt});

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
    ) external whenNotPaused onlyAuthorized {
        uint256 length = collections_.length;
        if (length != tokenIds.length || length != prices.length || length != expiresAts.length) revert ArrayLengthMismatch();

        for (uint256 i; i < length; ) {
            createListing(collections_[i], tokenIds[i], prices[i], expiresAts[i], seller);
            unchecked {
                ++i;
            }
        }
    }

    function updateListingPrice(address collection, uint256 tokenId, uint128 newPrice, address seller) external onlyAuthorized {
        Listing storage listing = listings[collection][tokenId];
        if (IERC721(collection).ownerOf(tokenId) != seller) revert NotTokenOwner();
        if (listing.seller != seller) revert NotSeller();
        if (newPrice < MIN_LISTING_PRICE) revert InvalidPrice();

        listing.price = newPrice;
        emit ListingUpdated(collection, tokenId, newPrice);
    }

    function cancelListing(address collection, uint256 tokenId, address seller) external {
        _cancelListing(collection, tokenId, seller);
    }

    function cancelListingBatch(address[] calldata collections_, uint256[] calldata tokenIds, address seller) external onlyAuthorized {
        uint256 length = collections_.length;
        if (length != tokenIds.length) revert ArrayLengthMismatch();

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

    function buy(address collection, uint256 tokenId, address buyer) external payable whenNotPaused nonReentrant onlyAuthorized {
        Listing memory listing = listings[collection][tokenId];
        if (listing.price == 0) revert ListingNotFound();
        if (listing.expiresAt != 0 && listing.expiresAt < block.timestamp) revert ListingExpired();
        if (msg.value != listing.price) revert InsufficientValue();

        _executeSale(collection, tokenId, listing, buyer);
    }

    function buyBatch(address collection, uint256[] calldata tokenIds, address buyer) external payable whenNotPaused nonReentrant onlyAuthorized {
        uint256 totalPrice;
        uint256 length = tokenIds.length;

        for (uint256 i; i < length; ) {
            Listing memory listing = listings[collection][tokenIds[i]];
            if (listing.price == 0) revert ListingNotFound();
            if (listing.expiresAt != 0 && listing.expiresAt < block.timestamp) revert ListingExpired();
            totalPrice += listing.price;
            unchecked {
                ++i;
            }
        }

        if (msg.value != totalPrice) revert InsufficientValue();

        for (uint256 i; i < length; ) {
            Listing memory listing = listings[collection][tokenIds[i]];
            _executeSale(collection, tokenIds[i], listing, buyer);
            unchecked {
                ++i;
            }
        }
    }

    function _executeSale(address collection, uint256 tokenId, Listing memory listing, address buyer) internal {
        if (buyer == listing.seller) revert SelfPurchase();

        uint128 marketplaceFeeAmount = uint128((uint256(listing.price) * marketplaceFee) / BASIS_POINTS);
        (address royaltyReceiver, uint256 royaltyAmount) = _getRoyalty(collection, tokenId, uint256(listing.price));
        uint128 sellerProceeds = listing.price - marketplaceFeeAmount - uint128(royaltyAmount);

        IERC721(collection).safeTransferFrom(listing.seller, buyer, tokenId);

        delete listings[collection][tokenId];
        unchecked {
            --totalListings;
        }

        _safeTransferETH(feeReceiver, marketplaceFeeAmount);
        _safeTransferETH(listing.seller, sellerProceeds);
        if (royaltyAmount > 0) {
            _safeTransferETH(royaltyReceiver, royaltyAmount);
        }

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
    ) external onlyAuthorized nonReentrant returns (uint128 marketplaceFeeAmount, address royaltyReceiver, uint256 royaltyAmount) {
        IERC721 nft = IERC721(collection);
        if (nft.ownerOf(tokenId) != seller) revert NotTokenOwner();

        marketplaceFeeAmount = uint128((uint256(price) * marketplaceFee) / BASIS_POINTS);
        (royaltyReceiver, royaltyAmount) = _getRoyalty(collection, tokenId, uint256(price));

        nft.safeTransferFrom(seller, buyer, tokenId);

        if (listings[collection][tokenId].price > 0) {
            delete listings[collection][tokenId];
            unchecked {
                --totalListings;
            }
        }

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

    function registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver) external onlyAuthorized {
        if (collection == address(0)) revert InvalidCollection();
        if (collections[collection].exists) revert CollectionAlreadyRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();

        try IERC165(collection).supportsInterface(type(IERC721).interfaceId) returns (bool ok) {
            if (!ok) revert InvalidCollection();
        } catch {
            revert InvalidCollection();
        }

        collections[collection] = CollectionInfo({royaltyReceiver: royaltyReceiver, royaltyFee: royaltyFee, totalVolume: 0, totalSales: 0, isVerified: false, exists: true});

        emit CollectionRegistered(collection, royaltyReceiver, royaltyFee, false);
    }

    function updateCollectionRoyalty(address collection, address royaltyReceiver, uint16 royaltyFee, address sender) external onlyAuthorized {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();

        address collectionOwner;
        try Ownable(collection).owner() returns (address owner) {
            collectionOwner = owner;
        } catch {
            revert NotCollectionOwner();
        }

        if (collectionOwner != sender) revert NotCollectionOwner();

        collections[collection].royaltyReceiver = royaltyReceiver;
        collections[collection].royaltyFee = royaltyFee;
    }



    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function verifyCollection(address collection) external onlyOwner {
        if (!collections[collection].exists) revert CollectionNotRegistered();
        collections[collection].isVerified = true;
        emit CollectionVerified(collection);
    }
    function updateMarketplaceFee(uint16 newFee) external onlyOwner {
        if (newFee > MAX_MARKETPLACE_FEE) revert FeeTooHigh();
        uint16 oldFee = marketplaceFee;
        marketplaceFee = newFee;
        emit MarketplaceFeeUpdated(oldFee, newFee);
    }

    function updateFeeReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert InvalidCollection();
        address oldReceiver = feeReceiver;
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(oldReceiver, newReceiver);
    }

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
        emit ContractAuthorized(contractAddr, authorized);
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _safeTransferETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _getRoyalty(address collection, uint256 tokenId, uint256 salePrice) internal view returns (address receiver, uint256 amount) {
        if (IERC165(collection).supportsInterface(type(IERC2981).interfaceId)) {
            try IERC2981(collection).royaltyInfo(tokenId, salePrice) returns (address r, uint256 a) {
                uint256 maxRoyalty = (salePrice * MAX_ROYALTY_FEE) / BASIS_POINTS;
                if (a <= maxRoyalty) {
                    return (r, a);
                }
            } catch {}
        }

        CollectionInfo memory info = collections[collection];
        receiver = info.royaltyReceiver;
        amount = (salePrice * info.royaltyFee) / BASIS_POINTS;
    }

    receive() external payable {}

    fallback() external payable {
        revert("Invalid call");
    }
}

interface IERC2981 is IERC165 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount);
}
