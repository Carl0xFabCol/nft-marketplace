// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";

/**
 * @notice Shared safety and configuration helpers for Foundry deployment scripts.
 *
 * @dev Design rules enforced here:
 *
 *      1. Network selection is always explicit through NETWORK, and the selected
 *         network's chain id must match the connected RPC.
 *      2. Address resolution FAILS CLOSED. A missing deployment record is an
 *         error, never a silent downgrade to whatever happens to be in the
 *         ambient environment (`.env` is auto-loaded by Foundry, so an implicit
 *         fallback can silently target a previous deployment). Environment
 *         addresses are only ever used when USE_ENV_ADDRESSES=true is set.
 *      3. Every resolved address is checked for code and probed against the
 *         current contract interfaces, so an older/incompatible deployment is
 *         reported as such instead of failing with an opaque revert.
 *      4. Records have two distinct stages. `partial` records are written during
 *         the Foundry simulation pass and are UNCONFIRMED. Only VerifyDeployment,
 *         running as a separate process against real chain state, may promote a
 *         record to `verified` or write deployments/latest.json.
 */
abstract contract DeploymentConfig is Script {
    uint256 internal constant ELYSIUM_CHAIN_ID = 99801;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Written during simulation. Addresses are predicted, not confirmed.
    string internal constant STAGE_PARTIAL = "partial";
    /// @dev Written only by VerifyDeployment after reading real on-chain state.
    string internal constant STAGE_VERIFIED = "verified";

    struct NetworkConfig {
        string name;
        uint256 chainId;
    }

    struct DeploymentRecord {
        bool exists;
        address core;
        address bids;
        address marketplace;
        address launchpad;
        address feeReceiver;
        address deployer;
        uint256 marketplaceFee;
        uint256 launchFee;
        uint256 chainId;
        bool configured;
        string stage;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXECUTION CONTEXT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice True when this run is allowed to change state and persist records.
     * @dev Overridden by the test harnesses so the guard and record logic can be
     *      exercised on a local Anvil without a real broadcast. Production runs
     *      only ever return true under --broadcast / --resume.
     */
    function _isLive() internal view virtual returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    function _logDryRunNotice() internal view {
        if (!_isLive()) {
            console.log("");
            console.log("DRY RUN: no transactions are broadcast and no record is written.");
            console.log("Pass --broadcast to execute.");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NETWORK SELECTION
    // ═══════════════════════════════════════════════════════════════════════════

    function _selectedNetwork() internal view returns (NetworkConfig memory) {
        string memory name = _env("NETWORK");
        if (bytes(name).length == 0) revert("NETWORK is required (elysium|sepolia)");

        bytes32 nameHash = keccak256(bytes(name));
        if (nameHash == keccak256(bytes("elysium"))) {
            return NetworkConfig({name: name, chainId: ELYSIUM_CHAIN_ID});
        }
        if (nameHash == keccak256(bytes("sepolia"))) {
            return NetworkConfig({name: name, chainId: SEPOLIA_CHAIN_ID});
        }
        if (nameHash == keccak256(bytes("anvil"))) {
            // Local-only target used by the deployment test suite. Never a public chain.
            return NetworkConfig({name: name, chainId: block.chainid});
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
                    vm.toString(block.chainid),
                    ". Check --rpc-url and NETWORK."
                )
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OPTIONAL ENVIRONMENT VALUES
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // An empty value counts as unset. `FOO=` in a .env file otherwise parses as
    // a malformed number rather than as "no opinion", which turns an absent
    // setting into a confusing failure.

    /**
     * @notice Single point where configuration enters a script.
     * @dev Every environment read in every script goes through here. The test
     *      harnesses override it with an in-memory map, so the deployment tests
     *      need no process-global state: vm.setEnv is shared by the whole forge
     *      process and Foundry runs test suites in parallel, which would
     *      otherwise let one test's variables leak into another's.
     */
    function _env(string memory name) internal view virtual returns (string memory) {
        return vm.envOr(name, string(""));
    }

    function _envUintOpt(string memory name) internal view returns (bool isSet, uint256 value) {
        string memory raw = _env(name);
        if (bytes(raw).length == 0) return (false, 0);
        return (true, vm.parseUint(raw));
    }

    function _envAddressOpt(string memory name) internal view returns (bool isSet, address value) {
        string memory raw = _env(name);
        if (bytes(raw).length == 0) return (false, address(0));
        value = vm.parseAddress(raw);
        return (value != address(0), value);
    }

    function _envBool(string memory name) internal view returns (bool) {
        return _envBoolOr(name, false);
    }

    function _envBoolOr(string memory name, bool defaultValue) internal view returns (bool) {
        string memory raw = _env(name);
        if (bytes(raw).length == 0) return defaultValue;
        return vm.parseBool(raw);
    }

    function _envStringOr(string memory name, string memory defaultValue) internal view returns (string memory) {
        string memory raw = _env(name);
        return bytes(raw).length == 0 ? defaultValue : raw;
    }

    function _envUintOr(string memory name, uint256 defaultValue) internal view returns (uint256) {
        (bool isSet, uint256 value) = _envUintOpt(name);
        return isSet ? value : defaultValue;
    }

    function _envAddressOr(string memory name, address defaultValue) internal view returns (address) {
        (bool isSet, address value) = _envAddressOpt(name);
        return isSet ? value : defaultValue;
    }

    function _deployer() internal view returns (uint256 privateKey, address deployer) {
        (bool isSet, uint256 key) = _envUintOpt("PRIVATE_KEY");
        if (!isSet || key == 0) revert("PRIVATE_KEY is required");
        privateKey = key;
        deployer = vm.addr(privateKey);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECORD PATHS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Overridable through DEPLOYMENTS_DIR so tests never touch real records.
    function _deploymentsDir() internal view returns (string memory) {
        return _envStringOr("DEPLOYMENTS_DIR", "deployments");
    }

    function _deploymentPath(string memory network) internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/", network, ".json");
    }

    function _latestPath() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/latest.json");
    }

    function _archiveDir() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/archive");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECORD STORAGE SEAM
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // All record persistence goes through these five functions. In production
    // they are the filesystem. The deployment tests override them with an
    // in-memory store so record state lives in EVM storage, which Foundry
    // isolates and reverts per test case - the filesystem is neither isolated
    // nor sequenced across concurrently executing tests.

    function _fileExists(string memory path) internal view virtual returns (bool) {
        return vm.exists(path);
    }

    function _readFileRaw(string memory path) internal view virtual returns (string memory) {
        // Reading the deployment record is the whole point of this seam, and
        // fs access is scoped to ./deployments by fs_permissions.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        return vm.readFile(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal virtual {
        vm.writeJson(json, path);
    }

    function _copyFileRaw(string memory from, string memory to) internal virtual {
        vm.copyFile(from, to);
    }

    function _ensureDir(string memory path) internal virtual {
        vm.createDir(path, true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RECORD IO
    // ═══════════════════════════════════════════════════════════════════════════

    function _readRecord(string memory network) internal view returns (DeploymentRecord memory rec) {
        string memory path = _deploymentPath(network);
        if (!_fileExists(path)) return rec;

        string memory json = _readFileRaw(path);
        rec.exists = true;
        rec.core = _jsonAddressOrZero(json, ".core");
        rec.bids = _jsonAddressOrZero(json, ".bids");
        rec.marketplace = _jsonAddressOrZero(json, ".marketplace");
        rec.launchpad = _jsonAddressOrZero(json, ".launchpad");
        rec.feeReceiver = _jsonAddressOrZero(json, ".feeReceiver");
        rec.deployer = _jsonAddressOrZero(json, ".deployer");
        rec.marketplaceFee = _jsonUintOrZero(json, ".marketplaceFee");
        rec.launchFee = _jsonUintOrZero(json, ".launchFee");
        rec.chainId = _jsonUintOrZero(json, ".chainId");
        rec.configured = vm.keyExistsJson(json, ".configured") && vm.parseJsonBool(json, ".configured");
        rec.stage = vm.keyExistsJson(json, ".stage") ? vm.parseJsonString(json, ".stage") : "";
    }

    function _jsonAddressOrZero(string memory json, string memory key) private view returns (address) {
        if (!vm.keyExistsJson(json, key)) return address(0);
        return vm.parseJsonAddress(json, key);
    }

    function _jsonUintOrZero(string memory json, string memory key) private view returns (uint256) {
        if (!vm.keyExistsJson(json, key)) return 0;
        return vm.parseJsonUint(json, key);
    }

    function _isVerifiedStage(DeploymentRecord memory rec) internal pure returns (bool) {
        return keccak256(bytes(rec.stage)) == keccak256(bytes(STAGE_VERIFIED));
    }

    /**
     * @notice Serialises a record. `latest` is written only for verified records.
     * @dev A record is never silently promoted: `configured` is true only when
     *      the stage is `verified`, which only VerifyDeployment produces.
     */
    function _writeRecord(
        NetworkConfig memory net,
        DeploymentRecord memory rec,
        string memory stage,
        bool writeLatest
    ) internal {
        bool verified = keccak256(bytes(stage)) == keccak256(bytes(STAGE_VERIFIED));

        string memory obj = "deployment";
        vm.serializeAddress(obj, "core", rec.core);
        vm.serializeAddress(obj, "bids", rec.bids);
        vm.serializeAddress(obj, "marketplace", rec.marketplace);
        vm.serializeAddress(obj, "launchpad", rec.launchpad);
        vm.serializeAddress(obj, "feeReceiver", rec.feeReceiver);
        vm.serializeAddress(obj, "deployer", rec.deployer);
        vm.serializeUint(obj, "marketplaceFee", rec.marketplaceFee);
        vm.serializeUint(obj, "launchFee", rec.launchFee);
        vm.serializeUint(obj, "chainId", net.chainId);
        vm.serializeUint(obj, "updatedAt", block.timestamp);
        vm.serializeBool(obj, "configured", verified);
        vm.serializeString(obj, "stage", stage);
        string memory json = vm.serializeString(obj, "network", net.name);

        _ensureDir(_deploymentsDir());
        _writeFileRaw(_deploymentPath(net.name), json);
        console.log("");
        console.log(string.concat("Record written (stage=", stage, "):"), _deploymentPath(net.name));

        if (writeLatest && verified) {
            _writeFileRaw(_latestPath(), json);
            console.log("latest.json updated:", _latestPath());
        }
    }

    /**
     * @notice Copies the current record for `network` into deployments/archive/.
     * @dev History is preserved, never deleted. Returns the archive path, or an
     *      empty string when there was nothing to archive.
     */
    function _archiveRecord(string memory network, string memory reason) internal returns (string memory) {
        string memory path = _deploymentPath(network);
        if (!_fileExists(path)) return "";

        _ensureDir(_archiveDir());
        string memory dest =
            string.concat(_archiveDir(), "/", network, "-", vm.toString(block.timestamp), "-", reason, ".json");
        _copyFileRaw(path, dest);
        console.log("Previous record archived to:", dest);
        return dest;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CODE AND INTERFACE PROBES
    // ═══════════════════════════════════════════════════════════════════════════

    function _requireContract(address addr, string memory label) internal view {
        require(addr != address(0), string.concat(label, " is not set"));
        require(
            addr.code.length > 0,
            string.concat(
                label, " has no code at ", vm.toString(addr), " on chain ", vm.toString(block.chainid)
            )
        );
    }

    function _hasCode(address addr) internal view returns (bool) {
        return addr != address(0) && addr.code.length > 0;
    }

    /// @dev Non-reverting staticcall returning the first word of the response.
    function _probe(address target, bytes memory callData) internal view returns (bool ok, bytes32 word) {
        if (!_hasCode(target)) return (false, bytes32(0));
        (bool success, bytes memory ret) = target.staticcall(callData);
        if (!success || ret.length < 32) return (false, bytes32(0));
        return (true, abi.decode(ret, (bytes32)));
    }

    function _probeAddress(address target, string memory sig) internal view returns (bool ok, address value) {
        (bool success, bytes32 word) = _probe(target, abi.encodeWithSignature(sig));
        if (!success) return (false, address(0));
        // Reject dirty upper bits: a non-address word means the ABI does not match.
        if (uint256(word) >> 160 != 0) return (false, address(0));
        return (true, address(uint160(uint256(word))));
    }

    function _probeUint(address target, string memory sig) internal view returns (bool ok, uint256 value) {
        (bool success, bytes32 word) = _probe(target, abi.encodeWithSignature(sig));
        return (success, uint256(word));
    }

    function _probeBoolArg(address target, string memory sig, address arg)
        internal
        view
        returns (bool ok, bool value)
    {
        (bool success, bytes32 word) = _probe(target, abi.encodeWithSignature(sig, arg));
        return (success, uint256(word) != 0);
    }

    function _incompatible(address target, string memory label, string memory sig)
        private
        view
        returns (string memory)
    {
        return string.concat(
            "Incompatible deployment: ",
            label,
            " at ",
            vm.toString(target),
            " did not answer ",
            sig,
            ". This is not a current ",
            label,
            " build - it is most likely an older deployment. ",
            "Archive its record and deploy a fresh stack instead of reusing it."
        );
    }

    function _requireSelector(address target, string memory label, string memory sig) internal view {
        (bool ok,) = _probe(target, abi.encodeWithSignature(sig));
        if (!ok) revert(_incompatible(target, label, sig));
    }

    /**
     * @notice Rejects anything that is not a current build of each component.
     * @dev This is the check that distinguishes "not yet configured" (fine, the
     *      wiring getters return address(0)) from "old incompatible deployment"
     *      (the getters do not exist at all and the call reverts).
     */
    function _requireCurrentInterfaces(address core, address bids, address router, address launchpad) internal view {
        _requireContract(core, "CORE");
        _requireContract(bids, "BIDS");
        _requireContract(router, "MARKETPLACE");

        _requireSelector(core, "MarketplaceCore", "router()");
        _requireSelector(core, "MarketplaceCore", "bidsContract()");
        _requireSelector(core, "MarketplaceCore", "owner()");
        _requireSelector(core, "MarketplaceCore", "pendingOwner()");
        _requireSelector(core, "MarketplaceCore", "marketplaceFee()");
        _requireSelector(core, "MarketplaceCore", "feeReceiver()");
        _requireSelector(core, "MarketplaceCore", "MAX_MARKETPLACE_FEE()");
        _requireSelector(core, "MarketplaceCore", "MAX_ROYALTY_FEE()");
        _requireSelector(core, "MarketplaceCore", "paused()");

        _requireSelector(bids, "MarketplaceBids", "core()");
        _requireSelector(bids, "MarketplaceBids", "marketplace()");
        _requireSelector(bids, "MarketplaceBids", "owner()");
        _requireSelector(bids, "MarketplaceBids", "pendingOwner()");
        _requireSelector(bids, "MarketplaceBids", "paused()");

        _requireSelector(router, "Marketplace", "core()");
        _requireSelector(router, "Marketplace", "bids()");
        _requireSelector(router, "Marketplace", "owner()");
        _requireSelector(router, "Marketplace", "pendingOwner()");

        if (launchpad != address(0)) {
            _requireContract(launchpad, "LAUNCHPAD");
            _requireSelector(launchpad, "LaunchPad", "core()");
            _requireSelector(launchpad, "LaunchPad", "owner()");
            _requireSelector(launchpad, "LaunchPad", "launchFee()");
        }
    }

    /**
     * @notice Rejects address sets that come from different deployments.
     * @dev Immutable links (bids.core, router.core, router.bids, launchpad.core)
     *      must agree. Core's own wiring may still be unset at this point.
     */
    function _requireSameDeployment(address core, address bids, address router, address launchpad) internal view {
        (, address bidsCore) = _probeAddress(bids, "core()");
        require(
            bidsCore == core,
            string.concat(
                "Mixed deployment: BIDS.core() is ", vm.toString(bidsCore), " but CORE is ", vm.toString(core)
            )
        );

        (, address routerCore) = _probeAddress(router, "core()");
        require(
            routerCore == core,
            string.concat(
                "Mixed deployment: MARKETPLACE.core() is ",
                vm.toString(routerCore),
                " but CORE is ",
                vm.toString(core)
            )
        );

        (, address routerBids) = _probeAddress(router, "bids()");
        require(
            routerBids == bids,
            string.concat(
                "Mixed deployment: MARKETPLACE.bids() is ",
                vm.toString(routerBids),
                " but BIDS is ",
                vm.toString(bids)
            )
        );

        if (launchpad != address(0)) {
            (, address launchpadCore) = _probeAddress(launchpad, "core()");
            require(
                launchpadCore == core,
                string.concat(
                    "Mixed deployment: LAUNCHPAD.core() is ",
                    vm.toString(launchpadCore),
                    " but CORE is ",
                    vm.toString(core)
                )
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NON-REVERTING SHAPE CHECKS (used for reuse planning)
    // ═══════════════════════════════════════════════════════════════════════════

    function _looksLikeCore(address addr) internal view returns (bool) {
        if (!_hasCode(addr)) return false;
        (bool a,) = _probeAddress(addr, "router()");
        (bool b,) = _probeAddress(addr, "bidsContract()");
        (bool c,) = _probeAddress(addr, "owner()");
        (bool d,) = _probeUint(addr, "marketplaceFee()");
        (bool e,) = _probeUint(addr, "MAX_MARKETPLACE_FEE()");
        (bool f,) = _probeAddress(addr, "feeReceiver()");
        return a && b && c && d && e && f;
    }

    function _looksLikeBids(address addr, address core) internal view returns (bool) {
        if (!_hasCode(addr)) return false;
        (bool a, address bidsCore) = _probeAddress(addr, "core()");
        (bool b,) = _probeAddress(addr, "marketplace()");
        (bool c,) = _probeAddress(addr, "owner()");
        return a && b && c && bidsCore == core;
    }

    function _looksLikeRouter(address addr, address core, address bids) internal view returns (bool) {
        if (!_hasCode(addr)) return false;
        (bool a, address routerCore) = _probeAddress(addr, "core()");
        (bool b, address routerBids) = _probeAddress(addr, "bids()");
        (bool c,) = _probeAddress(addr, "owner()");
        return a && b && c && routerCore == core && routerBids == bids;
    }

    function _looksLikeLaunchPad(address addr, address core) internal view returns (bool) {
        if (!_hasCode(addr)) return false;
        (bool a, address lpCore) = _probeAddress(addr, "core()");
        (bool b,) = _probeAddress(addr, "owner()");
        (bool c,) = _probeUint(addr, "launchFee()");
        return a && b && c && lpCore == core;
    }

    /// @notice Non-reverting counterpart of _requireCurrentInterfaces.
    function _isCompatibleStack(address core, address bids, address router, address launchpad)
        internal
        view
        returns (bool)
    {
        if (!_looksLikeCore(core)) return false;
        if (!_looksLikeBids(bids, core)) return false;
        if (!_looksLikeRouter(router, core, bids)) return false;
        if (launchpad != address(0) && !_looksLikeLaunchPad(launchpad, core)) return false;
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FAIL-CLOSED ADDRESS RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════════

    struct Addresses {
        address core;
        address bids;
        address marketplace;
        address launchpad;
    }

    /**
     * @notice Resolves the full component set, failing closed.
     *
     * @dev Exactly one source is used, chosen explicitly:
     *      - default: deployments/<network>.json, which must exist;
     *      - USE_ENV_ADDRESSES=true: CORE_ADDRESS / BIDS_ADDRESS /
     *        MARKETPLACE_ADDRESS (+ optional LAUNCHPAD_ADDRESS), all required.
     *
     *      There is deliberately no fallback between the two. Foundry
     *      auto-loads `.env`, so an implicit fallback would let a stale
     *      MARKETPLACE_ADDRESS silently redirect a script at a previous
     *      deployment (audit finding C-1).
     */
    function _resolveAddresses(NetworkConfig memory net) internal view returns (Addresses memory addrs) {
        if (_envBool("USE_ENV_ADDRESSES")) {
            addrs.core = _requiredEnvAddress("CORE_ADDRESS");
            addrs.bids = _requiredEnvAddress("BIDS_ADDRESS");
            addrs.marketplace = _requiredEnvAddress("MARKETPLACE_ADDRESS");
            addrs.launchpad = _envAddressOr("LAUNCHPAD_ADDRESS", address(0));
            console.log("Address source: environment (USE_ENV_ADDRESSES=true)");
        } else {
            DeploymentRecord memory rec = _readRecord(net.name);
            require(
                rec.exists,
                string.concat(
                    "No deployment record at ",
                    _deploymentPath(net.name),
                    ". Run DeployMarketplace first, or set USE_ENV_ADDRESSES=true together with ",
                    "CORE_ADDRESS, BIDS_ADDRESS and MARKETPLACE_ADDRESS to target explicit addresses. ",
                    "Addresses are never taken from the environment implicitly."
                )
            );
            require(
                rec.chainId == net.chainId,
                string.concat(
                    "Record at ",
                    _deploymentPath(net.name),
                    " is for chain ",
                    vm.toString(rec.chainId),
                    " but the connected chain is ",
                    vm.toString(net.chainId)
                )
            );
            addrs.core = rec.core;
            addrs.bids = rec.bids;
            addrs.marketplace = rec.marketplace;
            addrs.launchpad = rec.launchpad;
            console.log("Address source:", _deploymentPath(net.name));
        }

        require(addrs.core != address(0), "Resolved CORE is zero");
        require(addrs.bids != address(0), "Resolved BIDS is zero");
        require(addrs.marketplace != address(0), "Resolved MARKETPLACE is zero");
    }

    /// @notice Resolves and fully validates the component set.
    function _resolveValidatedAddresses(NetworkConfig memory net) internal view returns (Addresses memory addrs) {
        addrs = _resolveAddresses(net);
        _requireCurrentInterfaces(addrs.core, addrs.bids, addrs.marketplace, addrs.launchpad);
        _requireSameDeployment(addrs.core, addrs.bids, addrs.marketplace, addrs.launchpad);
    }

    function _requiredEnvAddress(string memory name) internal view returns (address value) {
        (, value) = _envAddressOpt(name);
        require(value != address(0), string.concat(name, " is required when USE_ENV_ADDRESSES=true"));
    }

    /**
     * @notice Resolves only the router, failing closed.
     * @dev Used by the collection scripts. Still validates the whole component
     *      set so a router from an older deployment is rejected up front.
     */
    function _resolveRouter(NetworkConfig memory net) internal view returns (address) {
        Addresses memory addrs = _resolveValidatedAddresses(net);
        return addrs.marketplace;
    }
}
