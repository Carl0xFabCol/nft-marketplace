// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {LaunchPad} from "../src/LaunchPad.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title EventSignaturesTest
 * @notice Test #3 (INTEGRATION_AUDIT §10): pins topic0 of every event the
 *         off-chain stack can consume against committed constants.
 * @dev The indexer subscribes by topic0. Renaming an event, or changing its
 *      parameter types, silently turns a listener into dead code. Here it is
 *      a failing test instead: a rename no longer compiles and a type change
 *      no longer matches the constant. If a change is intentional, update the
 *      constant AND the indexer config/handlers in the same change.
 *      Constants were computed from the generated ABI (src/abis/*.generated.ts).
 */
contract EventSignaturesTest is Test {
    function test_EventSignaturesAreStable() public pure {
        // MarketplaceCore
        // BidsContractUpdated(address,address)
        assertEq(MarketplaceCore.BidsContractUpdated.selector, bytes32(0xba7cd007b5cdfca6437534a9dd4fe418791363c916ed2063ccfadc4d0d934833), "MarketplaceCore.BidsContractUpdated");
        // CollectionRegistered(address,address,uint16,bool)
        assertEq(MarketplaceCore.CollectionRegistered.selector, bytes32(0xde36fe0e16e21bba4166442f472aaf737775f24a59ae3943abd65bd9d2de405a), "MarketplaceCore.CollectionRegistered");
        // CollectionRegistrationExecuted(address,address)
        assertEq(MarketplaceCore.CollectionRegistrationExecuted.selector, bytes32(0x064a913e80e600097b17b58580ba78e02588ce377c80e4c16ae14bcd14974866), "MarketplaceCore.CollectionRegistrationExecuted");
        // CollectionRoyaltyUpdated(address,address,uint16)
        assertEq(MarketplaceCore.CollectionRoyaltyUpdated.selector, bytes32(0x4293a7bbc2256fc1721b61e20f2471d0ca09fe20eb2678c18ee6001be0fbe00d), "MarketplaceCore.CollectionRoyaltyUpdated");
        // CollectionUnverified(address)
        assertEq(MarketplaceCore.CollectionUnverified.selector, bytes32(0x7403a0e4f4850762f1201c07ff352e8cb5cacb21e1cdb51424f685ca60ce3818), "MarketplaceCore.CollectionUnverified");
        // CollectionVerified(address)
        assertEq(MarketplaceCore.CollectionVerified.selector, bytes32(0x5e0a07f8a1b8fe74cef346cd40f37e962e499bb7fbbb3ca3e0527d2948f69847), "MarketplaceCore.CollectionVerified");
        // ExcessETHSwept(address,uint256)
        assertEq(MarketplaceCore.ExcessETHSwept.selector, bytes32(0x1ea188f022ac3b70f32d79ec309e9f82387a54cfd70f2d9ef3d293c2f3911c06), "MarketplaceCore.ExcessETHSwept");
        // FeeReceiverUpdated(address,address)
        assertEq(MarketplaceCore.FeeReceiverUpdated.selector, bytes32(0xa92ff4390fe6943f0b30e8fe715dde86f85ab79b2b2c640a10fc094cc4036cc8), "MarketplaceCore.FeeReceiverUpdated");
        // LaunchpadAuthorized(address,bool)
        assertEq(MarketplaceCore.LaunchpadAuthorized.selector, bytes32(0x7db07a5682bfa310a4ed445d489844a258ecb960d3e034bd098469efdfa0aa1d), "MarketplaceCore.LaunchpadAuthorized");
        // ListingCancelled(address,uint256,address)
        assertEq(MarketplaceCore.ListingCancelled.selector, bytes32(0x8526cb6d400b8a551983c99e6d6fb1775b7a0deeb5d1e39d3ee65bc59e5eac27), "MarketplaceCore.ListingCancelled");
        // ListingCreated(address,uint256,address,uint128,uint64)
        assertEq(MarketplaceCore.ListingCreated.selector, bytes32(0x18bd4d0a491da1b1ad020805b5020d525aad251d720f7ad16f55b23d5fea4d85), "MarketplaceCore.ListingCreated");
        // ListingUpdated(address,uint256,uint128)
        assertEq(MarketplaceCore.ListingUpdated.selector, bytes32(0x262ec20088f69b4c81047303e4af9e72dd75cc97f55de636e774d02887d44ed0), "MarketplaceCore.ListingUpdated");
        // MarketplaceFeeUpdated(uint16,uint16)
        assertEq(MarketplaceCore.MarketplaceFeeUpdated.selector, bytes32(0x67809071c3a33224505860697ea490469fe6418630ac364aa0aae5a9a548b557), "MarketplaceCore.MarketplaceFeeUpdated");
        // OwnershipTransferStarted(address,address)
        assertEq(Ownable2Step.OwnershipTransferStarted.selector, bytes32(0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700), "MarketplaceCore.OwnershipTransferStarted");
        // OwnershipTransferred(address,address)
        assertEq(Ownable.OwnershipTransferred.selector, bytes32(0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0), "MarketplaceCore.OwnershipTransferred");
        // Paused(address)
        assertEq(Pausable.Paused.selector, bytes32(0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258), "MarketplaceCore.Paused");
        // RouterUpdated(address,address)
        assertEq(MarketplaceCore.RouterUpdated.selector, bytes32(0x02dc5c233404867c793b749c6d644beb2277536d18a7e7974d3f238e4c6f1684), "MarketplaceCore.RouterUpdated");
        // RoyaltyOverrideCleared(address)
        assertEq(MarketplaceCore.RoyaltyOverrideCleared.selector, bytes32(0x402a3030579ef9237b24dca851426035a873c5c706f41adf8dc8de27bafe40c9), "MarketplaceCore.RoyaltyOverrideCleared");
        // RoyaltySourceUsed(address,uint256,uint256,uint8)
        assertEq(MarketplaceCore.RoyaltySourceUsed.selector, bytes32(0x842382e85116f073684492d95d3ac8b7862d6895294877355d685faab4e036c8), "MarketplaceCore.RoyaltySourceUsed");
        // Sale(address,uint256,address,address,uint128,uint128,uint128)
        assertEq(MarketplaceCore.Sale.selector, bytes32(0xabc64087683bc03711246c01fbc574128e5ae430432e2252431b3125f728b3e1), "MarketplaceCore.Sale");
        // Unpaused(address)
        assertEq(Pausable.Unpaused.selector, bytes32(0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa), "MarketplaceCore.Unpaused");
        // Withdrawal(address,uint256)
        assertEq(MarketplaceCore.Withdrawal.selector, bytes32(0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65), "MarketplaceCore.Withdrawal");
        // MarketplaceBids
        // CollectionBidAccepted(address,address,address,uint256[],uint128)
        assertEq(MarketplaceBids.CollectionBidAccepted.selector, bytes32(0x19563096453be68d659be7ed5b784dbee7a94766edc0f28aa7a14a9b5944387f), "MarketplaceBids.CollectionBidAccepted");
        // CollectionBidCancelled(address,address)
        assertEq(MarketplaceBids.CollectionBidCancelled.selector, bytes32(0xf5913151c29e184e3a477be2274f0b06b63cd67c1ab11e1cc103d25701cfbdf2), "MarketplaceBids.CollectionBidCancelled");
        // CollectionBidPlaced(address,address,uint128,uint32,uint64)
        assertEq(MarketplaceBids.CollectionBidPlaced.selector, bytes32(0x99b78bb0a35c8bed7a9d0dff56c0769bc0cb5534025d8238badd230847e24c5d), "MarketplaceBids.CollectionBidPlaced");
        // ExcessETHSwept(address,uint256)
        assertEq(MarketplaceBids.ExcessETHSwept.selector, bytes32(0x1ea188f022ac3b70f32d79ec309e9f82387a54cfd70f2d9ef3d293c2f3911c06), "MarketplaceBids.ExcessETHSwept");
        // MarketplaceAddressUpdated(address,address)
        assertEq(MarketplaceBids.MarketplaceAddressUpdated.selector, bytes32(0x920f4de0e7427ce5cf5551817fae8bbb29975314ec846a00f7a363831f0e5012), "MarketplaceBids.MarketplaceAddressUpdated");
        // OwnershipTransferStarted(address,address)
        assertEq(Ownable2Step.OwnershipTransferStarted.selector, bytes32(0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700), "MarketplaceBids.OwnershipTransferStarted");
        // OwnershipTransferred(address,address)
        assertEq(Ownable.OwnershipTransferred.selector, bytes32(0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0), "MarketplaceBids.OwnershipTransferred");
        // Paused(address)
        assertEq(Pausable.Paused.selector, bytes32(0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258), "MarketplaceBids.Paused");
        // TokenBidAccepted(address,uint256,address,address,uint128)
        assertEq(MarketplaceBids.TokenBidAccepted.selector, bytes32(0x4c08350ac84bd843beae9f3ffa9dfc9989544a67e0e00f0c83d0eb08a2c76250), "MarketplaceBids.TokenBidAccepted");
        // TokenBidCancelled(address,uint256,address)
        assertEq(MarketplaceBids.TokenBidCancelled.selector, bytes32(0x8ecb239d9d4e498535cb673c0ce897f15d862c9e2d51f8aaa236dd0f2835d047), "MarketplaceBids.TokenBidCancelled");
        // TokenBidPlaced(address,uint256,address,uint128,uint64)
        assertEq(MarketplaceBids.TokenBidPlaced.selector, bytes32(0x4a0cbef2881c6bc4d6b0205b46b4127c21957aa9241ccef3ab65276b8894821b), "MarketplaceBids.TokenBidPlaced");
        // Unpaused(address)
        assertEq(Pausable.Unpaused.selector, bytes32(0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa), "MarketplaceBids.Unpaused");
        // Withdrawal(address,uint256)
        assertEq(MarketplaceBids.Withdrawal.selector, bytes32(0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65), "MarketplaceBids.Withdrawal");
        // ERC721
        // Transfer(address,address,uint256)
        assertEq(IERC721.Transfer.selector, bytes32(0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef), "ERC721.Transfer");
        // LaunchPad
        // CollectionDeployed(address,address,string,string)
        assertEq(LaunchPad.CollectionDeployed.selector, bytes32(0x42805f304977dde16425c6a05d5bec1836888a4efc9a847f2ab450923d350c26), "LaunchPad.CollectionDeployed");
    }
}
