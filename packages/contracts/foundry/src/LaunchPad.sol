// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./MERC721.sol";

interface IMarketplaceCoreRegistry {
    function registerCollectionFromLaunchpad(address collection, uint16 royaltyFee, address royaltyReceiver, address creator) external;
}
/**
 * @title LaunchPad
 * @notice Permissionless factory that deploys MiColeccion ERC721 collections and
 *         registers them in MarketplaceCore so they become immediately tradeable.
 */
contract LaunchPad is Ownable2Step, ReentrancyGuard, Pausable {
    uint16 public constant MAX_ROYALTY_FEE = 2_000;
    uint256 public constant MAX_PAGE_SIZE = 100;

    IMarketplaceCoreRegistry public immutable core;

    uint256 public launchFee;
    uint256 public accruedFees;

    mapping(address => address[]) private _collectionsByCreator;
    mapping(address => bool) public isLaunchpadCollection;

    event CollectionDeployed(address indexed collection, address indexed creator, string name, string symbol);
    event LaunchFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error FeeTooHigh();
    error InsufficientLaunchFee();
    error InvalidAddress();
    error TransferFailed();
    error NoFees();
    error PageTooLarge();
    error RenounceOwnershipDisabled();

    struct DeployParams {
        string name;
        string symbol;
        address creator;
        uint16 royaltyFee;
        address royaltyReceiver;
        uint256 maxSupply;
        string baseURI;
        uint256 mintPrice;
        uint256 mintDuration;
    }

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidAddress();
        core = IMarketplaceCoreRegistry(_core);
        launchFee = 10 ether; // Default launch fee
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTION CREATION
    // ═══════════════════════════════════════════════════════════════════════════════

    function createCollection(
        string calldata name,
        string calldata symbol,
        uint16 royaltyFee,
        address royaltyReceiver,
        uint256 maxSupply,
        string calldata baseURI,
        uint256 mintPrice,
        uint256 mintDuration
    ) external payable whenNotPaused nonReentrant returns (address collection) {
        if (msg.value < launchFee) revert InsufficientLaunchFee();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0)) royaltyReceiver = msg.sender;

        collection = deployCollection(
            DeployParams({
                name: name,
                symbol: symbol,
                creator: msg.sender,
                royaltyFee: royaltyFee,
                royaltyReceiver: royaltyReceiver,
                maxSupply: maxSupply,
                baseURI: baseURI,
                mintPrice: mintPrice,
                mintDuration: mintDuration
            })
        );

        _collectionsByCreator[msg.sender].push(collection);
        isLaunchpadCollection[collection] = true;

        core.registerCollectionFromLaunchpad(collection, royaltyFee, royaltyReceiver, msg.sender);
        if (msg.value != 0) {
            accruedFees += msg.value;
        }

        emit CollectionDeployed(collection, msg.sender, name, symbol);
    }

    function deployCollection(DeployParams memory p) internal returns (address collection) {
        collection = address(new Hyperc(p.name, p.symbol, p.creator, p.royaltyFee, p.royaltyReceiver, p.maxSupply, p.baseURI, p.mintPrice, p.mintDuration));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function getCollectionsCreatedBy(address creator) external view returns (address[] memory) {
        return _collectionsByCreator[creator];
    }

    /// @notice Paginated view over a creator's collections.
    /// @dev Reverts if `limit` exceeds MAX_PAGE_SIZE. Offsets past the end and
    ///      a zero limit return an empty page; the final page is clamped.
    function getCollectionsCreatedByPage(address creator, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        if (limit > MAX_PAGE_SIZE) revert PageTooLarge();

        address[] storage all = _collectionsByCreator[creator];
        uint256 length = all.length;
        if (offset >= length || limit == 0) return new address[](0);

        uint256 end = length - offset < limit ? length : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = all[i];
        }
    }

    function getCollectionsCreatedCount(address creator) external view returns (uint256) {
        return _collectionsByCreator[creator].length;
    }

    function isCollection(address collection) external view returns (bool) {
        return isLaunchpadCollection[collection];
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function setLaunchFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = launchFee;
        launchFee = newFee;
        emit LaunchFeeUpdated(oldFee, newFee);
    }

    function withdrawFees(address payable recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) recipient = payable(owner());

        uint256 amount = accruedFees;
        if (amount == 0) revert NoFees();

        accruedFees = 0;
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FeesWithdrawn(recipient, amount);
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
