// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockRevertingRoyaltyNFT
 * @notice ERC721 whose royaltyInfo always reverts.
 *         Used to test the catch {} fallback in _getRoyalty — when royaltyInfo
 *         reverts, the marketplace falls back to collection-level royalty.
 *         Uses hardcoded ERC2981 interface ID (0x2a552323) to avoid
 *         conflicts with the local IERC2981 defined in MarketplaceCore.sol.
 */
contract MockRevertingRoyaltyNFT is ERC721, Ownable {
    constructor() Ownable(msg.sender) ERC721("MockRevertingRoyaltyNFT", "MRRNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view returns (address, uint256) {
        revert("Royalty info failed");
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721) returns (bool) {
        return interfaceId == 0x2a552323 || super.supportsInterface(interfaceId);
    }
}
