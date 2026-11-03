// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

abstract contract BoundedStaticCall {
    // F-4: hard ceiling for untrusted external views that do not need a custom
    // budget (approval, supportsInterface, collection owner, factory checks).
    uint256 internal constant EXTERNAL_QUERY_GAS = 100_000;

    function _staticcallBounded(address target, bytes memory callData) internal view returns (bool ok, uint256 word) {
        return _staticcallBounded(target, callData, EXTERNAL_QUERY_GAS);
    }

    function _staticcallBounded(address target, bytes memory callData, uint256 gasLimit) internal view returns (bool ok, uint256 word) {
        assembly ("memory-safe") {
            // Memory-safe: out is the free memory pointer at 0x40. Only that
            // scratch area receives the callee's 32-byte return data, and the
            // pointer is not advanced. The word is copied to the stack before
            // this block ends, so no live Solidity memory is overwritten.
            let out := mload(0x40)
            ok := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), out, 0x20)
            ok := and(ok, eq(returndatasize(), 0x20))
            if ok {
                word := mload(out)
            }
        }
    }

    function _staticcallBoundedRaw(address target, bytes memory callData, uint256 gasLimit) internal view returns (uint256 status, uint256 word) {
        assembly ("memory-safe") {
            // Temporary 32-byte output buffer at the free-memory pointer.
            let ptr := mload(0x40)
            mstore(ptr, 0)

            // EVM copies at most 32 bytes into ptr, regardless of returndata size.
            let success := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), ptr, 0x20)

            let returnSize := returndatasize()

            // Bit 0: staticcall succeeded.
            if success {
                status := or(status, 1)
            }

            // Bit 1: returndata is exactly one ABI word.
            if eq(returnSize, 0x20) {
                status := or(status, 2)
                word := mload(ptr)
            }

            // Bit 2: call reverted and supplied revert data.
            if and(iszero(success), gt(returnSize, 0)) {
                status := or(status, 4)
            }
        }
    }

    function _isAddressWord(uint256 word) internal pure returns (bool) {
        return word <= type(uint160).max;
    }
}
