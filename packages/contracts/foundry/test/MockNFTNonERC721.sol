// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockNFTNonERC721
 * @notice A contract that does NOT implement IERC721 or IERC165.
 *         Calling supportsInterface on this contract will revert, which
 *         triggers the catch block in registerCollection → InvalidCollection.
 */
contract MockNFTNonERC721 {
    // Intentionally empty — no functions, no fallback.
}
