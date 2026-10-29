// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface IMarketplaceCoreForBids {
    function isRegistered(address collection) external view returns (bool);

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
contract MarketplaceBids is Ownable2Step, ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    uint128 public constant MIN_LISTING_PRICE = 1 wei;
    uint256 public constant MAX_BATCH_SIZE = 50;

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

    IMarketplaceCoreForBids public immutable core;
    address public marketplace;

    mapping(address => mapping(address => CollectionBid)) public collectionBids;
    mapping(address => mapping(uint256 => mapping(address => TokenBid))) public tokenBids;

    mapping(address => uint256) public pendingWithdrawals;
    uint256 public totalPendingWithdrawals;

    // Total ETH currently held as escrow for live bids. Kept in sync with the
    // sum of all live collection/token bids so sweepExcessETH can never touch
    // funds backing an outstanding bid (H-01).
    uint256 public totalBidEscrow;

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event CollectionBidPlaced(address indexed collection, address indexed bidder, uint128 pricePerItem, uint32 quantity, uint64 expiresAt);
    event CollectionBidAccepted(address indexed collection, address indexed bidder, address indexed seller, uint256[] tokenIds, uint128 totalPrice);
    event CollectionBidCancelled(address indexed collection, address indexed bidder);
    event TokenBidPlaced(address indexed collection, uint256 indexed tokenId, address indexed bidder, uint128 price, uint64 expiresAt);
    event TokenBidAccepted(address indexed collection, uint256 indexed tokenId, address indexed bidder, address seller, uint128 price);
    event TokenBidCancelled(address indexed collection, uint256 indexed tokenId, address indexed bidder);
    event MarketplaceAddressUpdated(address indexed oldMarketplace, address indexed newMarketplace);
    event Withdrawal(address indexed account, uint256 amount);
    event ExcessETHSwept(address indexed recipient, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    error CollectionNotRegistered();
    error RenounceOwnershipDisabled();
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
    error InvalidAddress();
    error NoWithdrawal();
    error InsufficientExcess();
    error DuplicateTokenId();
    error PriceTooLow();
    error SellerProceedsTooLow();
    error SelfBid();
    error BatchTooLarge();
    error CorePaused();
    error AlreadySet();

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    modifier whenCoreNotPaused() {
        if (core.paused()) revert CorePaused();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert OnlyMarketplace();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidAddress();
        core = IMarketplaceCoreForBids(_core);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeCollectionBid(address collection, uint128 pricePerItem, uint32 quantity, uint64 expiresAt, address bidder) external payable whenNotPaused whenCoreNotPaused onlyMarketplace {
        if (!core.isRegistered(collection)) revert CollectionNotRegistered();
        if (pricePerItem < MIN_LISTING_PRICE) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BidExpired();

        uint256 totalValue = uint256(pricePerItem) * quantity;
        if (msg.value != totalValue) revert InsufficientValue();

        CollectionBid storage existingBid = collectionBids[collection][bidder];
        if (existingBid.quantity > 0) {
            uint256 refund = uint256(existingBid.pricePerItem) * existingBid.quantity;
            totalBidEscrow -= refund;
            _credit(bidder, refund);
        }

        totalBidEscrow += totalValue;
        collectionBids[collection][bidder] = CollectionBid({bidder: bidder, pricePerItem: pricePerItem, quantity: quantity, expiresAt: expiresAt});

        emit CollectionBidPlaced(collection, bidder, pricePerItem, quantity, expiresAt);
    }

    function acceptCollectionBid(address collection, address bidder, uint256[] calldata tokenIds, address seller, uint128 minPricePerItem, uint128 minSellerProceeds) external whenNotPaused whenCoreNotPaused nonReentrant onlyMarketplace {
        CollectionBid storage bid = collectionBids[collection][bidder];
        if (bid.quantity == 0) revert BidNotFound();
        if (bid.expiresAt != 0 && bid.expiresAt <= block.timestamp) revert BidExpired();
        if (bid.pricePerItem < minPricePerItem) revert PriceTooLow();
        if (tokenIds.length == 0 || tokenIds.length > bid.quantity) revert InvalidQuantity();
        if (tokenIds.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        // G-03: ownership/approval are validated inside Core.executeSaleFromBid.
        uint128 pricePerItem = bid.pricePerItem;
        uint128 totalPrice = SafeCast.toUint128(uint256(pricePerItem) * tokenIds.length);
        totalBidEscrow -= totalPrice;

        if (bid.quantity == tokenIds.length) {
            delete collectionBids[collection][bidder];
        } else {
            bid.quantity -= SafeCast.toUint32(tokenIds.length);
        }

        (uint128 totalMarketplaceFee, uint256 totalRoyalty) = _executeCollectionBidSales(collection, tokenIds, bidder, pricePerItem, seller);

        uint128 sellerProceeds = totalPrice - totalMarketplaceFee - SafeCast.toUint128(totalRoyalty);
        // M-03: the seller can bound the net proceeds to protect against fee or
        // royalty changes between signing and execution.
        if (sellerProceeds < minSellerProceeds) revert SellerProceedsTooLow();

        // G-07: read the fee receiver once per acceptance.
        _distributePayments(seller, sellerProceeds, totalMarketplaceFee, core.feeReceiver());

        emit CollectionBidAccepted(collection, bidder, seller, tokenIds, totalPrice);
    }

    function _executeCollectionBidSales(
        address collection,
        uint256[] calldata tokenIds,
        address bidder,
        uint128 pricePerItem,
        address seller
    ) internal returns (uint128 totalMarketplaceFee, uint256 totalRoyalty) {
        for (uint256 i; i < tokenIds.length; ) {
            (uint128 fee, address receiver, uint256 royalty) = core.executeSaleFromBid(collection, tokenIds[i], seller, bidder, pricePerItem);

            totalMarketplaceFee += fee;
            totalRoyalty += royalty;

            // M-02: credit each token's royalty to its own receiver immediately.
            // Different tokens in the same collection bid may nominate
            // different ERC-2981 receivers.
            if (royalty > 0) {
                _credit(receiver, royalty);
            }

            unchecked {
                ++i;
            }
        }
    }

    function _distributePayments(address seller, uint128 sellerProceeds, uint128 marketplaceFee, address feeRecipient) internal {
        _credit(feeRecipient, marketplaceFee);
        _credit(seller, sellerProceeds);
    }

    function cancelCollectionBid(address collection, address bidder) external nonReentrant onlyMarketplace {
        CollectionBid memory bid = collectionBids[collection][bidder];
        if (bid.quantity == 0) revert BidNotFound();

        delete collectionBids[collection][bidder];

        uint256 refund = uint256(bid.pricePerItem) * bid.quantity;
        totalBidEscrow -= refund;
        _credit(bidder, refund);

        emit CollectionBidCancelled(collection, bidder);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // TOKEN BID FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function placeTokenBid(address collection, uint256 tokenId, uint128 price, uint64 expiresAt, address bidder) external payable whenNotPaused whenCoreNotPaused onlyMarketplace {
        if (!core.isRegistered(collection)) revert CollectionNotRegistered();
        if (price < MIN_LISTING_PRICE) revert InvalidPrice();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BidExpired();
        if (msg.value != price) revert InsufficientValue();
        _revertIfOwnsToken(collection, tokenId, bidder);

        TokenBid storage existingBid = tokenBids[collection][tokenId][bidder];
        if (existingBid.price > 0) {
            totalBidEscrow -= existingBid.price;
            _credit(bidder, existingBid.price);
        }

        totalBidEscrow += price;
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
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();
        if (!core.isRegistered(collection)) revert CollectionNotRegistered();

        uint256 totalNewValue;

        for (uint256 i; i < length; ) {
            if (prices[i] < MIN_LISTING_PRICE) revert InvalidPrice();
            if (expiresAts[i] != 0 && expiresAts[i] <= block.timestamp) revert BidExpired();
            _revertIfOwnsToken(collection, tokenIds[i], bidder);

            for (uint256 j; j < i; ) {
                if (tokenIds[j] == tokenIds[i]) revert DuplicateTokenId();
                unchecked {
                    ++j;
                }
            }

            totalNewValue += prices[i];
            unchecked {
                ++i;
            }
        }

        // C-01: the batch re-escrows every new bid at full price. Replaced bids
        // are credited back in full, so the caller must fund the entire new
        // value; netting the refund out counted the old escrow twice.
        if (msg.value != totalNewValue) revert InsufficientValue();

        for (uint256 i; i < length; ) {
            TokenBid memory existingBid = tokenBids[collection][tokenIds[i]][bidder];
            if (existingBid.price > 0) {
                totalBidEscrow -= existingBid.price;
                _credit(bidder, existingBid.price);
            }

            totalBidEscrow += prices[i];
            tokenBids[collection][tokenIds[i]][bidder] = TokenBid({bidder: bidder, price: prices[i], expiresAt: expiresAts[i]});

            emit TokenBidPlaced(collection, tokenIds[i], bidder, prices[i], expiresAts[i]);

            unchecked {
                ++i;
            }
        }
    }

    function acceptTokenBid(address collection, uint256 tokenId, address bidder, address seller, uint128 minPrice, uint128 minSellerProceeds) external whenNotPaused whenCoreNotPaused nonReentrant onlyMarketplace {
        TokenBid memory bid = tokenBids[collection][tokenId][bidder];
        if (bid.price == 0) revert BidNotFound();
        if (bid.expiresAt != 0 && bid.expiresAt <= block.timestamp) revert BidExpired();
        if (bid.price < minPrice) revert PriceTooLow();

        // G-03: Core.executeSaleFromBid performs the ownership/approval checks.
        uint128 price = bid.price;
        totalBidEscrow -= price;
        delete tokenBids[collection][tokenId][bidder];

        (uint128 marketplaceFeeAmount, address royaltyReceiver, uint256 royaltyAmount) = core.executeSaleFromBid(collection, tokenId, seller, bidder, price);

        uint128 sellerProceeds = price - marketplaceFeeAmount - SafeCast.toUint128(royaltyAmount);
        if (sellerProceeds < minSellerProceeds) revert SellerProceedsTooLow();
        _credit(seller, sellerProceeds);
        // G-07: read the fee receiver once.
        _credit(core.feeReceiver(), marketplaceFeeAmount);
        if (royaltyAmount > 0) {
            _credit(royaltyReceiver, royaltyAmount);
        }

        emit TokenBidAccepted(collection, tokenId, bidder, seller, price);
    }

    function cancelTokenBid(address collection, uint256 tokenId, address bidder) external nonReentrant onlyMarketplace {
        TokenBid memory bid = tokenBids[collection][tokenId][bidder];
        if (bid.price == 0) revert BidNotFound();

        delete tokenBids[collection][tokenId][bidder];
        totalBidEscrow -= bid.price;
        _credit(bidder, bid.price);

        emit TokenBidCancelled(collection, tokenId, bidder);
    }

    function cancelTokenBidBatch(address[] calldata collections_, uint256[] calldata tokenIds, address bidder) external nonReentrant onlyMarketplace {
        uint256 length = collections_.length;
        if (length != tokenIds.length) revert ArrayLengthMismatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i; i < length; ) {
            TokenBid memory bid = tokenBids[collections_[i]][tokenIds[i]][bidder];
            if (bid.price > 0) {
                delete tokenBids[collections_[i]][tokenIds[i]][bidder];
                totalBidEscrow -= bid.price;
                _credit(bidder, bid.price);
                emit TokenBidCancelled(collections_[i], tokenIds[i], bidder);
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev M-05 best-effort wash-trading guard. Tokens may not exist yet, so
    ///      a failed ownerOf call is treated as "not owned".
    function _revertIfOwnsToken(address collection, uint256 tokenId, address bidder) internal view {
        (bool success, bytes memory data) = collection.staticcall(
            abi.encodeWithSelector(IERC721.ownerOf.selector, tokenId)
        );
        if (success && data.length >= 32 && abi.decode(data, (address)) == bidder) {
            revert SelfBid();
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

    function setMarketplaceAddress(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert InvalidAddress();
        if (marketplace != address(0)) revert AlreadySet();
        
        marketplace = _marketplace;
        emit MarketplaceAddressUpdated(address(0), _marketplace);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _credit(address account, uint256 amount) internal {
        if (amount == 0) return;
        if (account == address(0)) revert InvalidAddress();

        pendingWithdrawals[account] += amount;
        unchecked {
            totalPendingWithdrawals += amount;
        }
    }

    function withdrawFor(address account) external nonReentrant onlyMarketplace returns (bool withdrawn) {
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
        uint256 obligations = totalPendingWithdrawals + totalBidEscrow;
        if (balance <= obligations) revert InsufficientExcess();

        uint256 amount = balance - obligations;
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ExcessETHSwept(recipient, amount);
    }

    receive() external payable {}

    function renounceOwnership() public override {
        revert RenounceOwnershipDisabled();
    }
}
