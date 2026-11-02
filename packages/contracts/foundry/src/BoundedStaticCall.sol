// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

abstract contract BoundedStaticCall {
    // F-4: hard ceiling for untrusted external views that do not need a custom
    // budget (approval, supportsInterface, collection owner, factory checks).
    uint256 internal constant EXTERNAL_QUERY_GAS = 100_000;

    function _staticcallBounded(
        address target,
        bytes memory callData
    ) internal view returns (bool ok, uint256 word) {
        return _staticcallBounded(target, callData, EXTERNAL_QUERY_GAS);
    }

    function _staticcallBounded(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) internal view returns (bool ok, uint256 word) {
        assembly ("memory-safe") {
            // Memory-safe: out is the free memory pointer at 0x40. Only that
            // scratch area receives the callee's 32-byte return data, and the
            // pointer is not advanced. The word is copied to the stack before
            // this block ends, so no live Solidity memory is overwritten.
            let out := mload(0x40)
            ok := staticcall(
                gasLimit,
                target,
                add(callData, 0x20),
                mload(callData),
                out,
                0x20
            )
            ok := and(ok, eq(returndatasize(), 0x20))
            if ok {
                word := mload(out)
            }
        }
    }

    function _staticcallBounded2(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) internal view returns (bool ok, uint256 word0, uint256 word1) {
        // The scratch usage is identical to _staticcallBounded (0x40 holds the
        // 64-byte return tuple and is copied to the stack immediately). This
        // block is deliberately not annotated: annotating both assembly blocks
        // makes the via-IR optimizer fail with "too deep in the stack by 1
        // slots" in MarketplaceCore. No memory beyond the free pointer is read
        // later, so the unannotated block still only touches scratch memory.
        assembly {
            let out := mload(0x40)
            ok := staticcall(
                gasLimit,
                target,
                add(callData, 0x20),
                mload(callData),
                out,
                0x40
            )
            ok := and(ok, eq(returndatasize(), 0x40))
            if ok {
                word0 := mload(out)
                word1 := mload(add(out, 0x20))
            }
        }
    }

    /// @dev Returns a status word plus the returned word. Status bits:
    ///      0 = call succeeded, 1 = well-formed 32-byte return, 2 = call failed
    ///      with non-empty returndata.
    function _staticcallBoundedRaw(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) internal view returns (uint256 status, uint256 word) {
        (bool success, bytes memory returndata) = target.staticcall{gas: gasLimit}(callData);
        if (success) {
            status = 1;
            if (returndata.length == 0x20) {
                status = 3;
                word = abi.decode(returndata, (uint256));
            }
        } else if (returndata.length > 0) {
            status = 4;
        }
    }

    function _isAddressWord(uint256 word) internal pure returns (bool) {
        return word <= type(uint160).max;
    }
}
