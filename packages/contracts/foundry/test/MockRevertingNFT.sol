// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockRevertingNFT
 * @notice ERC721 whose safeTransferFrom always reverts.
 *         Used to test that _executeSale / executeSaleFromBid propagate
 *         the transfer failure (the marketplace does not catch safeTransferFrom
 *         errors — the revert bubbles up directly).
 */
contract MockRevertingNFT is ERC721, Ownable {
    constructor() Ownable(msg.sender) ERC721("MockRevertingNFT", "MRNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    // Override the 4-arg version (which is virtual) to always revert.
    // The 3-arg safeTransferFrom calls this internally, so it also reverts.
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public pure override(ERC721) {
        revert("Transfer failed");
    }
}
