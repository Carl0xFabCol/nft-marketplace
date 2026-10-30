// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {Marketplace} from "../src/Marketplace.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReentrantBidder is IERC721Receiver {
    enum Action {
        None,
        PlaceTokenBid,
        CancelTokenBid
    }

    Marketplace public immutable router;
    address public immutable collection;
    uint256 public immutable tokenId;

    Action public action;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    constructor(Marketplace _router, address _collection, uint256 _tokenId) {
        router = _router;
        collection = _collection;
        tokenId = _tokenId;
    }

    function setAction(Action newAction) external {
        action = newAction;
        reentrySucceeded = false;
        reentryError = bytes4(0);
    }

    function placeBid(uint128 price) external payable {
        router.placeTokenBid{value: msg.value}(collection, tokenId, price, 0);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        Action currentAction = action;

        if (currentAction == Action.PlaceTokenBid) {
            (bool success, bytes memory returnData) = address(router).call{value: 1}(
                abi.encodeWithSelector(
                    Marketplace.placeTokenBid.selector,
                    collection,
                    tokenId + 1,
                    uint128(1),
                    uint64(0)
                )
            );
            _record(success, returnData);
        } else if (currentAction == Action.CancelTokenBid) {
            (bool success, bytes memory returnData) = address(router).call(
                abi.encodeWithSelector(
                    Marketplace.cancelTokenBid.selector,
                    collection,
                    tokenId
                )
            );
            _record(success, returnData);
        }

        return IERC721Receiver.onERC721Received.selector;
    }

    function _record(bool success, bytes memory returnData) internal {
        reentrySucceeded = success;
        if (!success && returnData.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(returnData, 0x20))
            }
            reentryError = selector;
        }
    }
}

/// @notice R-4: place-bid entrypoints are guarded against receiver-hook reentry.
contract AuditR4Test is TestSetup {
    ReentrantBidder internal attacker;

    function setUp() public override {
        super.setUp();
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);
        nft.mint(seller, 1);
        _approveOnCore(address(nft), seller);

        attacker = new ReentrantBidder(marketplace, address(nft), 1);
        vm.deal(address(attacker), SALE_PRICE + 1);

        attacker.placeBid{value: SALE_PRICE}(uint128(SALE_PRICE));
        assertEq(bids.totalBidEscrow(), SALE_PRICE);
    }

    function _acceptTokenBid() internal {
        vm.prank(seller);
        marketplace.acceptTokenBid(address(nft), 1, address(attacker), 0, 0);
    }

    function _assertAccounting() internal view {
        assertEq(bids.totalBidEscrow(), 0);
        assertEq(bids.totalPendingWithdrawals(), SALE_PRICE);
        assertGe(
            address(bids).balance,
            bids.totalPendingWithdrawals() + bids.totalBidEscrow()
        );
        assertEq(nft.ownerOf(1), address(attacker));
    }

    function testR4_PlaceBidReentryBlocked() public {
        attacker.setAction(ReentrantBidder.Action.PlaceTokenBid);

        _acceptTokenBid();

        assertFalse(attacker.reentrySucceeded());
        assertEq(
            attacker.reentryError(),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        _assertAccounting();
    }

    function testR4_CancelBidReentryBlocked() public {
        attacker.setAction(ReentrantBidder.Action.CancelTokenBid);

        _acceptTokenBid();

        assertFalse(attacker.reentrySucceeded());
        assertEq(
            attacker.reentryError(),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        _assertAccounting();
    }
}
