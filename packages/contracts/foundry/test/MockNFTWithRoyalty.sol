// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockNFTWithRoyalty
 * @notice ERC721 mock with royalty support for testing royalty paths.
 *         Implements a simplified ERC2981-like royalty mechanism.
 *         Uses hardcoded ERC2981 interface ID (0x2a552323) to avoid
 *         conflicts with the local IERC2981 defined in MarketplaceCore.sol.
 */
contract MockNFTWithRoyalty is ERC721, Ownable {
    mapping(uint256 => address) private _tokenRoyaltyReceiver;
    mapping(uint256 => uint96) private _tokenRoyaltyFee;
    address private _defaultRoyaltyReceiver;
    uint96 private _defaultRoyaltyFee;

    constructor() Ownable(msg.sender) ERC721("MockNFTWithRoyalty", "MNFTW") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external {
        _tokenRoyaltyReceiver[tokenId] = receiver;
        _tokenRoyaltyFee[tokenId] = feeNumerator;
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external {
        _defaultRoyaltyReceiver = receiver;
        _defaultRoyaltyFee = feeNumerator;
    }

    function resetTokenRoyalty(uint256 tokenId) external {
        delete _tokenRoyaltyReceiver[tokenId];
        delete _tokenRoyaltyFee[tokenId];
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view returns (address receiver, uint256 royaltyAmount) {
        address r = _tokenRoyaltyReceiver[tokenId];
        uint96 fee = _tokenRoyaltyFee[tokenId];
        if (r == address(0)) {
            r = _defaultRoyaltyReceiver;
            fee = _defaultRoyaltyFee;
        }
        if (r != address(0) && fee > 0) {
            royaltyAmount = (salePrice * fee) / 10_000;
        }
        return (r, royaltyAmount);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721) returns (bool) {
        return interfaceId == 0x2a552323 || super.supportsInterface(interfaceId);
    }
}
