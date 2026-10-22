// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MiColeccion
 * @notice Mintable ERC721 collection with configurable supply, royalties and metadata.
 * @dev Deployed by the LaunchPad factory. The creator becomes the owner and can mint,
 *      manage the base URI and update royalties. Royalties are exposed via ERC-2981.
 */
contract MiColeccion is ERC721, ERC721Enumerable, ERC2981, Ownable2Step, ReentrancyGuard {
    /// @notice Maximum number of tokens that can ever be minted (0 = unlimited).
    uint256 public maxSupply;

    /// @notice Price in wei required per token when minting (0 = free).
    uint256 public mintPrice;

    /// @notice Timestamp when minting ends. 0 = minting never ends.
    uint256 public mintEndsAt;

    string private _baseTokenURI;

    event BaseURIUpdated(string newBaseURI);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event MintEndsAtUpdated(uint256 oldEndsAt, uint256 newEndsAt);
    event RoyaltyUpdated(address indexed receiver, uint96 royaltyFee);

    error InvalidOwner();
    error MaxSupplyExceeded();
    error InvalidMaxSupply();
    error InvalidAmount();
    error InsufficientPayment();
    error MintEnded();
    error TransferFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner_,
        uint16 royaltyFee_,
        address royaltyReceiver_,
        uint256 maxSupply_,
        string memory baseURI_,
        uint256 mintPrice_,
        uint256 mintDuration_
    ) ERC721(name_, symbol_) Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) revert InvalidOwner();

        maxSupply = maxSupply_;
        _baseTokenURI = baseURI_;
        mintPrice = mintPrice_;
        if (mintDuration_ != 0) {
            mintEndsAt = block.timestamp + mintDuration_;
        }

        if (royaltyFee_ > 0) {
            address receiver = royaltyReceiver_ == address(0) ? initialOwner_ : royaltyReceiver_;
            _setDefaultRoyalty(receiver, royaltyFee_);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MINTING
    // ═══════════════════════════════════════════════════════════════════════════════

    function mint(address to) external payable nonReentrant returns (uint256 tokenId) {
        if (!isMintActive()) revert MintEnded();
        if (msg.value != mintPrice) revert InsufficientPayment();
        if (maxSupply != 0 && totalSupply() >= maxSupply) revert MaxSupplyExceeded();

        tokenId = _nextTokenId();
        _safeMint(to, tokenId);
    }

    function batchMint(address to, uint256 amount) external payable nonReentrant returns (uint256[] memory tokenIds) {
        if (amount == 0) revert InvalidAmount();
        if (!isMintActive()) revert MintEnded();
        if (msg.value != mintPrice * amount) revert InsufficientPayment();
        if (maxSupply != 0 && totalSupply() + amount > maxSupply) revert MaxSupplyExceeded();

        tokenIds = new uint256[](amount);
        for (uint256 i; i < amount; ) {
            uint256 tokenId = _nextTokenId();
            _safeMint(to, tokenId);
            tokenIds[i] = tokenId;
            unchecked {
                ++i;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // OWNER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function setMintPrice(uint256 newPrice) external onlyOwner {
        uint256 oldPrice = mintPrice;
        mintPrice = newPrice;
        emit MintPriceUpdated(oldPrice, newPrice);
    }

    /// @notice Update the minting window from now. A duration of 0 makes minting eternal.
    function setMintDuration(uint256 durationSeconds) external onlyOwner {
        uint256 oldEndsAt = mintEndsAt;
        mintEndsAt = durationSeconds == 0 ? 0 : block.timestamp + durationSeconds;
        emit MintEndsAtUpdated(oldEndsAt, mintEndsAt);
    }

    function setRoyalty(address receiver, uint96 royaltyFee) external onlyOwner {
        _setDefaultRoyalty(receiver, royaltyFee);
        emit RoyaltyUpdated(receiver, royaltyFee);
    }

    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        if (newMaxSupply != 0 && newMaxSupply < totalSupply()) revert InvalidMaxSupply();
        maxSupply = newMaxSupply;
    }

    function withdraw(address payable recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) recipient = payable(owner());
        uint256 balance = address(this).balance;
        (bool success, ) = recipient.call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId();
    }

    /// @notice True while the collection is within its minting window.
    function isMintActive() public view returns (bool) {
        return mintEndsAt == 0 || block.timestamp <= mintEndsAt;
    }

    function tokensOfOwner(address account) external view returns (uint256[] memory tokens) {
        uint256 balance = balanceOf(account);
        tokens = new uint256[](balance);
        for (uint256 i; i < balance; ) {
            tokens[i] = tokenOfOwnerByIndex(account, i);
            unchecked {
                ++i;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _nextTokenId() internal view returns (uint256) {
        return totalSupply() + 1;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // REQUIRED OVERRIDES
    // ═══════════════════════════════════════════════════════════════════════════════

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721Enumerable, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }
}
