// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IMarketplaceCore {
    function collections(address) external view returns (address royaltyReceiver, uint16 royaltyFee, uint256 totalVolume, uint32 totalSales, bool isVerified, bool exists);

    function executeSaleFromBid(
        address collection,
        uint256 tokenId,
        address seller,
        address buyer,
        uint128 price
    ) external returns (uint128 marketplaceFeeAmount, address royaltyReceiver, uint256 royaltyAmount);

    function feeReceiver() external view returns (address);

    function paused() external view returns (bool);
}

/**
 * @title MarketplaceBids
 * @notice Handles collection-wide and token-specific bidding
 */
contract MarketplaceBids is ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    uint128 public constant MIN_LISTING_PRICE = 1 wei;

    // ═══════════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    IMarketplaceCore public immutable core;
    address public owner;
    address public marketplace;

    mapping(address => mapping(address => CollectionBid)) public collectionBids;
    mapping(address => mapping(uint256 => mapping(address => TokenBid))) public tokenBids;

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event CollectionBidPlaced(address indexed collection, address indexed bidder, uint128 pricePerItem, uint32 quantity, uint64 expiresAt);
    event CollectionBidAccepted(address indexed collection, address indexed bidder, address indexed seller, uint256[] tokenIds, uint128 totalPrice);
    event CollectionBidCancelled(address indexed collection, address indexed bidder);
    event TokenBidPlaced(address indexed collection, uint256 indexed tokenId, address indexed bidder, uint128 price, uint64 expiresAt);
    event TokenBidAccepted(address indexed collection, uint256 indexed tokenId, address indexed bidder, address seller, uint128 price);
    event TokenBidCancelled(address indexed collection, uint256 indexed tokenId, address indexed bidder);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    error CollectionNotRegistered();
    error InvalidPrice();
    error InvalidQuantity();
    error NotTokenOwner();
    error NotApproved();
    error BidNotFound();
    error BidExpired();
    error InsufficientValue();
    error TransferFailed();
    error NotBidder();
    error ArrayLengthMismatch();
    error OnlyOwner();
    error OnlyMarketplace();

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenCoreNotPaused() {
        require(!core.paused(), "Core paused");
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert OnlyMarketplace();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address _core) {
        core = IMarketplaceCore(_core);
        owner = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeCollectionBid(address collection, uint128 pricePerItem, uint32 quantity, uint64 expiresAt, address bidder) external payable whenNotPaused whenCoreNotPaused onlyMarketplace {
        (, , , , , bool exists) = core.collections(collection);
        if (!exists) revert CollectionNotRegistered();
        if (pricePerItem < MIN_LISTING_PRICE) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BidExpired();

        uint256 totalValue = uint256(pricePerItem) * quantity;
        if (msg.value != totalValue) revert InsufficientValue();

        CollectionBid storage existingBid = collectionBids[collection][bidder];
        if (existingBid.quantity > 0) {
            uint256 refund = uint256(existingBid.pricePerItem) * existingBid.quantity;
            _refund(bidder, refund);
        }

        collectionBids[collection][bidder] = CollectionBid({bidder: bidder, pricePerItem: pricePerItem, quantity: quantity, expiresAt: expiresAt});

        emit CollectionBidPlaced(collection, bidder, pricePerItem, quantity, expiresAt);
    }

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds, address seller) external whenNotPaused whenCoreNotPaused nonReentrant onlyMarketplace {
        CollectionBid storage bid = collectionBids[collection][bidder];
        if (bid.quantity == 0) revert BidNotFound();
        if (bid.expiresAt != 0 && bid.expiresAt < block.timestamp) revert BidExpired();
        if (tokenIds.length == 0 || tokenIds.length > bid.quantity) revert InvalidQuantity();

        _verifyOwnershipAndApproval(collection, tokenIds, seller);

        uint128 pricePerItem = bid.pricePerItem;
        uint128 totalPrice = pricePerItem * uint128(tokenIds.length);

        if (bid.quantity == tokenIds.length) {
            delete collectionBids[collection][bidder];
        } else {
            bid.quantity -= uint32(tokenIds.length);
        }

        (uint128 totalMarketplaceFee, address royaltyReceiver, uint256 totalRoyalty) = _executeCollectionBidSales(collection, tokenIds, bidder, pricePerItem, seller);

        uint128 sellerProceeds = totalPrice - totalMarketplaceFee - uint128(totalRoyalty);
        _distributePayments(seller, sellerProceeds, totalMarketplaceFee, royaltyReceiver, totalRoyalty);

        emit CollectionBidAccepted(collection, bidder, seller, tokenIds, totalPrice);
    }

    function _verifyOwnershipAndApproval(address collection, uint256[] calldata tokenIds, address _owner) internal view {
        IERC721 nft = IERC721(collection);
        if (!nft.isApprovedForAll(_owner, address(core))) revert NotApproved();

        for (uint256 i; i < tokenIds.length; ) {
            if (nft.ownerOf(tokenIds[i]) != _owner) revert NotTokenOwner();
            unchecked {
                ++i;
            }
        }
    }

    function _executeCollectionBidSales(
        address collection,
        uint256[] calldata tokenIds,
        address bidder,
        uint128 pricePerItem,
        address seller
    ) internal returns (uint128 totalMarketplaceFee, address royaltyReceiver, uint256 totalRoyalty) {
        for (uint256 i; i < tokenIds.length; ) {
            (uint128 fee, address receiver, uint256 royalty) = core.executeSaleFromBid(collection, tokenIds[i], seller, bidder, pricePerItem);

            totalMarketplaceFee += fee;
            totalRoyalty += royalty;
            royaltyReceiver = receiver;

            unchecked {
                ++i;
            }
        }
    }

    function _distributePayments(address seller, uint128 sellerProceeds, uint128 marketplaceFee, address royaltyReceiver, uint256 royaltyAmount) internal {
        _safeTransferETH(core.feeReceiver(), marketplaceFee);
        _safeTransferETH(seller, sellerProceeds);
        if (royaltyAmount > 0) {
            _safeTransferETH(royaltyReceiver, royaltyAmount);
        }
    }

    function cancelCollectionBid(address collection, address bidder) external nonReentrant onlyMarketplace {
        CollectionBid memory bid = collectionBids[collection][bidder];
        if (bid.quantity == 0) revert BidNotFound();

        delete collectionBids[collection][bidder];

        uint256 refund = uint256(bid.pricePerItem) * bid.quantity;
        _refund(bidder, refund);

        emit CollectionBidCancelled(collection, bidder);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // TOKEN BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeTokenBid(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address bidder) external payable whenNotPaused whenCoreNotPaused onlyMarketplace {
        (, , , , , bool exists) = core.collections(collection);
        if (!exists) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BidExpired();
        if (msg.value != price) revert InsufficientValue();

        TokenBid storage existingBid = tokenBids[collection][tokenId][bidder];
        if (existingBid.price > 0) {
            _refund(bidder, existingBid.price);
        }

        tokenBids[collection][tokenId][bidder] = TokenBid({bidder: bidder, price: price, expiresAt: expiresAt});

        emit TokenBidPlaced(collection, tokenId, bidder, price, expiresAt);
    }

    function placeTokenBidBatch(
        address collection,
        uint256[] calldata tokenIds,
        uint128[] calldata prices,
        uint64[] calldata expiresAts,
        address bidder
    ) external payable whenNotPaused whenCoreNotPaused onlyMarketplace {
        uint256 length = tokenIds.length;
        if (length != prices.length || length != expiresAts.length) revert ArrayLengthMismatch();

        uint256 totalNewValue;
        uint256 totalRefunds;

        for (uint256 i; i < length; ) {
            totalNewValue += prices[i];
            TokenBid storage existingBid = tokenBids[collection][tokenIds[i]][bidder];
            if (existingBid.price > 0) {
                totalRefunds += existingBid.price;
            }
            unchecked {
                ++i;
            }
        }

        uint256 netRequired = totalNewValue > totalRefunds ? totalNewValue - totalRefunds : 0;
        if (msg.value != netRequired) revert InsufficientValue();

        uint256 excessRefund = totalRefunds > totalNewValue ? totalRefunds - totalNewValue : 0;

        for (uint256 i; i < length; ) {
            _placeTokenBidNoRefund(collection, tokenIds[i], prices[i], expiresAts[i], bidder);
            unchecked {
                ++i;
            }
        }

        if (excessRefund > 0) {
            _safeTransferETH(bidder, excessRefund);
        }
    }

    function _placeTokenBidNoRefund(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address bidder) internal {
        (, , , , , bool exists) = core.collections(collection);
        if (!exists) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BidExpired();

        // ✅ Sobreescribir sin refund (ya se calculó y gestionó en el batch)
        tokenBids[collection][tokenId][bidder] = TokenBid({bidder: bidder, price: price, expiresAt: expiresAt});

        emit TokenBidPlaced(collection, tokenId, bidder, price, expiresAt);
    }

    function acceptTokenBid(address collection, uint256 tokenId, address bidder, address seller) external whenNotPaused whenCoreNotPaused nonReentrant onlyMarketplace {
        TokenBid memory bid = tokenBids[collection][tokenId][bidder];
        if (bid.price == 0) revert BidNotFound();
        if (bid.expiresAt != 0 && bid.expiresAt < block.timestamp) revert BidExpired();

        IERC721 nft = IERC721(collection);
        if (nft.ownerOf(tokenId) != seller) revert NotTokenOwner();
        if (!nft.isApprovedForAll(seller, address(core))) revert NotApproved();

        uint128 price = bid.price;
        delete tokenBids[collection][tokenId][bidder];

        (uint128 marketplaceFeeAmount, address royaltyReceiver, uint256 royaltyAmount) = core.executeSaleFromBid(collection, tokenId, seller, bidder, price);

        uint128 sellerProceeds = price - marketplaceFeeAmount - uint128(royaltyAmount);
        _distributePayments(seller, sellerProceeds, marketplaceFeeAmount, royaltyReceiver, royaltyAmount);

        emit TokenBidAccepted(collection, tokenId, bidder, seller, price);
    }

    function cancelTokenBid(address collection, uint256 tokenId, address bidder) external nonReentrant onlyMarketplace {
        TokenBid memory bid = tokenBids[collection][tokenId][bidder];
        if (bid.price == 0) revert BidNotFound();

        delete tokenBids[collection][tokenId][bidder];
        _refund(bidder, bid.price);

        emit TokenBidCancelled(collection, tokenId, bidder);
    }

    function cancelTokenBidBatch(address[] calldata collections_, uint256[] calldata tokenIds, address bidder) external nonReentrant onlyMarketplace {
        uint256 length = collections_.length;
        if (length != tokenIds.length) revert ArrayLengthMismatch();

        for (uint256 i; i < length; ) {
            TokenBid memory bid = tokenBids[collections_[i]][tokenIds[i]][bidder];
            if (bid.price > 0) {
                delete tokenBids[collections_[i]][tokenIds[i]][bidder];
                _refund(bidder, bid.price);
                emit TokenBidCancelled(collections_[i], tokenIds[i], bidder);
            }
            unchecked {
                ++i;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "Invalid address");
        owner = _owner;
    }

    function setMarketplaceAddress(address _marketplace) external onlyOwner {
        require(_marketplace != address(0), "Invalid address");
        marketplace = _marketplace;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _refund(address _user, uint256 _amount) internal {
        _safeTransferETH(_user, _amount);
    }

    function _safeTransferETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    receive() external payable {}
}
