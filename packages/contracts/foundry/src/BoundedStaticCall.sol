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
        assembly {
            let out := mload(0x40)
            ok := staticcall(
                gasLimit,
                target,
                add(callData, 0x20),
                mload(callData),
                out,
                0x20
            )
            if or(iszero(ok), iszero(eq(returndatasize(), 0x20))) {
                ok := 0
                word := 0
            }
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
            if or(iszero(ok), iszero(eq(returndatasize(), 0x40))) {
                ok := 0
                word0 := 0
                word1 := 0
            }
            if ok {
                word0 := mload(out)
                word1 := mload(add(out, 0x20))
            }
        }
    }

    function _staticcallBoundedRaw(
        address target,
        bytes memory callData,
        uint256 gasLimit
    ) internal view returns (bool success, bool valid, uint256 word, bool reverted) {
        assembly {
            let out := mload(0x40)
            success := staticcall(
                gasLimit,
                target,
                add(callData, 0x20),
                mload(callData),
                out,
                0x20
            )
            let size := returndatasize()
            reverted := and(iszero(success), gt(size, 0))
            if and(success, eq(size, 0x20)) {
                valid := 1
                word := mload(out)
            }
        }
    }

    function _isAddressWord(uint256 word) internal pure returns (bool) {
        return word <= type(uint160).max;
    }
}
