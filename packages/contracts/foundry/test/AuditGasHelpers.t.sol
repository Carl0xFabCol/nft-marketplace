// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BoundedStaticCall} from "../src/BoundedStaticCall.sol";
import {MockMalformedNFT} from "./MockMalformedReturn.sol";

contract BoundedStaticCallHarness is BoundedStaticCall {
    // expose internal functions for testing
    function exposedStaticcallBounded(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) public view returns (bool ok, uint256 word) {
        return _staticcallBounded(target, callData, gasLimit);
    }

    function exposedStaticcallBounded2(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) public view returns (bool ok, uint256 word0, uint256 word1) {
        return _staticcallBounded2(target, callData, gasLimit);
    }

    function exposedStaticcallBoundedRaw(
        address target,
        bytes memory callData
    ) public view returns (bool success, bool valid, uint256 word) {
        return _staticcallBoundedRaw(target, callData);
    }

    function exposedIsAddressWord(uint256 word) public pure returns (bool) {
        return _isAddressWord(word);
    }
}

/// @notice NB-5: dedicated tests for GasHelpers library (P‑6)
contract AuditGasHelpersTest is Test {
    BoundedStaticCallHarness internal harness;
    MockMalformedNFT internal mock;

    function setUp() public {
        harness = new BoundedStaticCallHarness();
        mock = new MockMalformedNFT();
    }

    function test_SingleWord_OOG() public {
        mock.setExpensiveRoyaltyInfo(true, 5_000); // will burn gas
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 10_000);
        assertFalse(ok);
        assertEq(word, 0);
    }

    function test_SingleWord_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 50_000);
        assertFalse(ok);
        assertEq(word, 0);
    }

    function test_SingleWord_ValidReturn() public {
        mock.setMalformedOwner(false);
        bytes memory callData = abi.encodeWithSelector(mock.owner.selector);
        (bool ok, uint256 word) = harness.exposedStaticcallBounded(address(mock), callData, 50_000);
        assertTrue(ok);
        // owner returns address (single word)
        assertEq(word, uint256(uint160(address(mock.owner()))));
    }

    function test_DoubleWord_OOG() public {
        mock.setExpensiveRoyaltyInfo(true, 5_000);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 10_000);
        assertFalse(ok);
        assertEq(word0, 0);
        assertEq(word1, 0);
    }

    function test_DoubleWord_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 50_000);
        assertFalse(ok);
        assertEq(word0, 0);
        assertEq(word1, 0);
    }

    function test_DoubleWord_ValidReturn() public {
        mock.setTokenRoyalty(1, address(0x123), 500);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool ok, uint256 word0, uint256 word1) = harness.exposedStaticcallBounded2(address(mock), callData, 50_000);
        assertTrue(ok);
        assertTrue(word0 != 0 || word1 != 0);
    }

    function test_Raw_MalformedReturnSize() public {
        mock.setMalformedRoyaltyInfoSize(true);
        bytes memory callData = abi.encodeWithSelector(mock.royaltyInfo.selector, 1, 100);
        (bool success, bool valid, uint256 word) = harness.exposedStaticcallBoundedRaw(address(mock), callData);
        assertTrue(success);
        assertFalse(valid);
        assertEq(word, 0);
    }

    function test_Raw_ValidReturn() public {
        // Use owner() which returns a single address
        bytes memory callData = abi.encodeWithSelector(mock.owner.selector);
        (bool success, bool valid, uint256 word) = harness.exposedStaticcallBoundedRaw(address(mock), callData);
        assertTrue(success);
        assertTrue(valid);
        // owner returns address (single word)
        assertEq(word, uint256(uint160(address(mock.owner()))));
    }

    function test_IsAddressWord() public {
        uint256 max160 = type(uint160).max;
        assertTrue(harness.exposedIsAddressWord(0));
        assertTrue(harness.exposedIsAddressWord(max160));
        assertFalse(harness.exposedIsAddressWord(max160 + 1));
        assertFalse(harness.exposedIsAddressWord(type(uint256).max));
    }
}