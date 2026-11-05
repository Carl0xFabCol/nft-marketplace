// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/**
 * @notice Shared safety and configuration helpers for Foundry deployment scripts.
 * @dev Network selection is always explicit through NETWORK. Only testnets listed
 *      in foundry.toml / the repository deployment history are accepted.
 */
abstract contract DeploymentConfig is Script {
    uint256 internal constant ELYSIUM_CHAIN_ID = 99801;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    struct NetworkConfig {
        string name;
        uint256 chainId;
    }

    function _selectedNetwork() internal view returns (NetworkConfig memory net) {
        string memory name = vm.envOr("NETWORK", string(""));
        if (bytes(name).length == 0) revert("NETWORK is required (elysium|sepolia)");

        bytes32 nameHash = keccak256(bytes(name));
        if (nameHash == keccak256(bytes("elysium"))) {
            return NetworkConfig({name: name, chainId: ELYSIUM_CHAIN_ID});
        }
        if (nameHash == keccak256(bytes("sepolia"))) {
            return NetworkConfig({name: name, chainId: SEPOLIA_CHAIN_ID});
        }

        revert(string.concat("Unsupported NETWORK: ", name));
    }

    function _validateNetwork() internal view returns (NetworkConfig memory net) {
        net = _selectedNetwork();
        if (block.chainid != net.chainId) {
            revert(
                string.concat(
                    "Wrong chain id for ",
                    net.name,
                    ": expected ",
                    vm.toString(net.chainId),
                    " got ",
                    vm.toString(block.chainid)
                )
            );
        }
    }

    function _deployer() internal view returns (uint256 privateKey, address deployer) {
        privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (privateKey == 0) revert("PRIVATE_KEY is required");
        deployer = vm.addr(privateKey);
    }

    /// @notice True only when Foundry is actually broadcasting (or resuming a broadcast).
    function _isBroadcast() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    function _deploymentPath(string memory network) internal pure returns (string memory) {
        return string.concat("deployments/", network, ".json");
    }

    function _requireContract(address addr, string memory label) internal view {
        require(addr != address(0), string.concat(label, " is not set"));
        require(addr.code.length > 0, string.concat(label, " has no code on this chain"));
    }

    /// @notice Reads an address from deployments/<network>.json when available.
    function _deploymentAddressIfPresent(string memory network, string memory key) internal view returns (address) {
        string memory path = _deploymentPath(network);
        if (!vm.exists(path)) return address(0);

        string memory json = vm.readFile(path);
        if (!vm.keyExistsJson(json, key)) return address(0);
        return vm.parseJsonAddress(json, key);
    }

    /// @notice True when deployments/latest.json already describes this network.
    function _latestDeploymentMatches(NetworkConfig memory net) internal view returns (bool) {
        if (!vm.exists("deployments/latest.json")) return false;

        string memory json = vm.readFile("deployments/latest.json");
        if (!vm.keyExistsJson(json, ".chainId") || !vm.keyExistsJson(json, ".network")) return false;

        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        string memory network = vm.parseJsonString(json, ".network");
        return chainId == net.chainId && keccak256(bytes(network)) == keccak256(bytes(net.name));
    }
}
