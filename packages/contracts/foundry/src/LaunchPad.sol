// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./MERC721.sol";

interface IMarketplaceCoreRegistry {
    function registerCollection(address collection, uint16 royaltyFee, address royaltyReceiver, address sender) external;
}

/**
 * @title LaunchPad
 * @notice Permissionless factory that deploys MiColeccion ERC721 collections and
 *         registers them in MarketplaceCore so they become immediately tradeable.
 */
contract LaunchPad is Ownable2Step, ReentrancyGuard, Pausable {
    uint16 public constant MAX_ROYALTY_FEE = 2_000;

    IMarketplaceCoreRegistry public immutable core;

    uint256 public launchFee;
    uint256 public accruedFees;

    mapping(address => address[]) private _collectionsByCreator;
    mapping(address => bool) public isLaunchpadCollection;

    event CollectionDeployed(address indexed collection, address indexed creator, string name, string symbol);
    event CollectionRegisteredOnMarketplace(address indexed collection, uint16 royaltyFee, address indexed royaltyReceiver);
    event LaunchFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error FeeTooHigh();
    error InsufficientLaunchFee();
    error InvalidAddress();
    error TransferFailed();
    error NoFees();

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidAddress();
        core = IMarketplaceCoreRegistry(_core);
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
        if (msg.value != launchFee) revert InsufficientLaunchFee();
        if (royaltyFee > MAX_ROYALTY_FEE) revert FeeTooHigh();
        if (royaltyReceiver == address(0)) royaltyReceiver = msg.sender;

        collection = deployCollection(
            name, symbol, msg.sender, royaltyFee, royaltyReceiver, maxSupply, baseURI, mintPrice, mintDuration
        );

        _collectionsByCreator[msg.sender].push(collection);
        isLaunchpadCollection[collection] = true;

        core.registerCollection(collection, royaltyFee, royaltyReceiver, msg.sender);

        if (msg.value != 0) {
            accruedFees += msg.value;
        }

        emit CollectionDeployed(collection, msg.sender, name, symbol);
        emit CollectionRegisteredOnMarketplace(collection, royaltyFee, royaltyReceiver);
    }

    function deployCollection(
        string calldata name,
        string calldata symbol,
        address creator,
        uint16 royaltyFee,
        address royaltyReceiver,
        uint256 maxSupply,
        string calldata baseURI,
        uint256 mintPrice,
        uint256 mintDuration
    ) internal returns (address collection) {
        collection = address(
            new MiColeccion(
                name, symbol, creator, royaltyFee, royaltyReceiver, maxSupply, baseURI, mintPrice, mintDuration
            )
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function getCollectionsCreatedBy(address creator) external view returns (address[] memory) {
        return _collectionsByCreator[creator];
    }

    function getCollectionsCreatedCount(address creator) external view returns (uint256) {
        return _collectionsByCreator[creator].length;
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
