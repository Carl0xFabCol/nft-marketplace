// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Stand-in for an older MarketplaceCore build that is still live on chain.
 *
 * @dev Modelled on the real contract observed at
 *      0x0726b653Bf5296FBA944263FaE162B949a2F75be on Elysium (chain 99801),
 *      which answers owner(), marketplaceFee() and feeReceiver() but has no
 *      router() or bidsContract() getter and reverts through its fallback with
 *      the string "Invalid call".
 *
 *      Used to prove that the deployment scripts reject an incompatible
 *      deployment with a precise diagnostic instead of an opaque revert.
 */
contract MockLegacyCore {
    address public owner;
    address public feeReceiver;
    uint16 public marketplaceFee = 100;

    constructor() {
        owner = msg.sender;
        feeReceiver = msg.sender;
    }

    fallback() external payable {
        revert("Invalid call");
    }
}

/// @notice A legacy Bids-like contract: answers core() but nothing else current.
contract MockLegacyBids {
    address public core;

    constructor(address core_) {
        core = core_;
    }

    fallback() external payable {
        revert("Invalid call");
    }
}
