// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {DeployMarketplace} from "../script/DeployMarketplace.s.sol";
import {ConfigureMarketplace} from "../script/ConfigureMarketplace.s.sol";
import {RegisterCollection} from "../script/RegisterCollection.s.sol";
import {CreateHypurr} from "../script/CreateHypurr.s.sol";
import {VerifyDeployment} from "../script/VerifyDeployment.s.sol";

import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {LaunchPad} from "../src/LaunchPad.sol";
import {MockNFT} from "./MockNFT.t.sol";
import {MockLegacyCore, MockLegacyBids} from "./MockLegacyCore.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// HARNESSES
// ═══════════════════════════════════════════════════════════════════════════════
//
// The scripts gate state changes and record writes on _isLive(), which is true
// only under --broadcast / --resume. Overriding it to true lets the guard and
// record logic run for real against a local Anvil-equivalent EVM, with no
// network access and nothing broadcast anywhere.

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY RECORD STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @notice Stands in for the deployments/ directory during tests.
 * @dev Record state lives in EVM storage, which Foundry snapshots after setUp
 *      and reverts after every test case. The real filesystem is neither
 *      isolated nor sequenced across concurrently executing tests, so using it
 *      made the suite race against itself.
 */
contract RecordStore {
    mapping(bytes32 => string) private _data;
    mapping(bytes32 => bool) private _present;

    function write(string memory path, string memory json) public {
        bytes32 key = keccak256(bytes(path));
        _data[key] = json;
        _present[key] = true;
    }

    function read(string memory path) public view returns (string memory) {
        require(_present[keccak256(bytes(path))], "RecordStore: missing file");
        return _data[keccak256(bytes(path))];
    }

    function exists(string memory path) public view returns (bool) {
        return _present[keccak256(bytes(path))];
    }

    function remove(string memory path) public {
        bytes32 key = keccak256(bytes(path));
        delete _data[key];
        _present[key] = false;
    }

    function copy(string memory from, string memory to) public {
        write(to, read(from));
    }
}

contract LiveDeploy is DeployMarketplace {
    mapping(bytes32 => string) private _vars;
    RecordStore public store;

    function setStore(RecordStore store_) external {
        store = store_;
    }

    function setVar(string calldata name, string calldata value) external {
        _vars[keccak256(bytes(name))] = value;
    }

    function _env(string memory name) internal view override returns (string memory) {
        return _vars[keccak256(bytes(name))];
    }

    function _isLive() internal view override returns (bool) {
        return true;
    }

    function _fileExists(string memory path) internal view override returns (bool) {
        return store.exists(path);
    }

    function _readFileRaw(string memory path) internal view override returns (string memory) {
        return store.read(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal override {
        store.write(path, json);
    }

    function _copyFileRaw(string memory from, string memory to) internal override {
        store.copy(from, to);
    }

    function _ensureDir(string memory) internal override {}
}

contract LiveConfigure is ConfigureMarketplace {
    mapping(bytes32 => string) private _vars;
    RecordStore public store;

    function setStore(RecordStore store_) external {
        store = store_;
    }

    function setVar(string calldata name, string calldata value) external {
        _vars[keccak256(bytes(name))] = value;
    }

    function _env(string memory name) internal view override returns (string memory) {
        return _vars[keccak256(bytes(name))];
    }

    function _isLive() internal view override returns (bool) {
        return true;
    }

    function _fileExists(string memory path) internal view override returns (bool) {
        return store.exists(path);
    }

    function _readFileRaw(string memory path) internal view override returns (string memory) {
        return store.read(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal override {
        store.write(path, json);
    }

    function _copyFileRaw(string memory from, string memory to) internal override {
        store.copy(from, to);
    }

    function _ensureDir(string memory) internal override {}
}

contract LiveVerify is VerifyDeployment {
    mapping(bytes32 => string) private _vars;
    RecordStore public store;

    function setStore(RecordStore store_) external {
        store = store_;
    }

    function setVar(string calldata name, string calldata value) external {
        _vars[keccak256(bytes(name))] = value;
    }

    function _env(string memory name) internal view override returns (string memory) {
        return _vars[keccak256(bytes(name))];
    }

    function _isLive() internal view override returns (bool) {
        return true;
    }

    function _fileExists(string memory path) internal view override returns (bool) {
        return store.exists(path);
    }

    function _readFileRaw(string memory path) internal view override returns (string memory) {
        return store.read(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal override {
        store.write(path, json);
    }

    function _copyFileRaw(string memory from, string memory to) internal override {
        store.copy(from, to);
    }

    function _ensureDir(string memory) internal override {}
}

contract LiveRegister is RegisterCollection {
    mapping(bytes32 => string) private _vars;
    RecordStore public store;

    function setStore(RecordStore store_) external {
        store = store_;
    }

    function setVar(string calldata name, string calldata value) external {
        _vars[keccak256(bytes(name))] = value;
    }

    function _env(string memory name) internal view override returns (string memory) {
        return _vars[keccak256(bytes(name))];
    }

    function _isLive() internal view override returns (bool) {
        return true;
    }

    function _fileExists(string memory path) internal view override returns (bool) {
        return store.exists(path);
    }

    function _readFileRaw(string memory path) internal view override returns (string memory) {
        return store.read(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal override {
        store.write(path, json);
    }

    function _copyFileRaw(string memory from, string memory to) internal override {
        store.copy(from, to);
    }

    function _ensureDir(string memory) internal override {}
}

contract LiveCreateHypurr is CreateHypurr {
    mapping(bytes32 => string) private _vars;
    RecordStore public store;

    function setStore(RecordStore store_) external {
        store = store_;
    }

    function setVar(string calldata name, string calldata value) external {
        _vars[keccak256(bytes(name))] = value;
    }

    function _env(string memory name) internal view override returns (string memory) {
        return _vars[keccak256(bytes(name))];
    }

    function _isLive() internal view override returns (bool) {
        return true;
    }

    function _fileExists(string memory path) internal view override returns (bool) {
        return store.exists(path);
    }

    function _readFileRaw(string memory path) internal view override returns (string memory) {
        return store.read(path);
    }

    function _writeFileRaw(string memory path, string memory json) internal override {
        store.write(path, json);
    }

    function _copyFileRaw(string memory from, string memory to) internal override {
        store.copy(from, to);
    }

    function _ensureDir(string memory) internal override {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED FIXTURE
// ═══════════════════════════════════════════════════════════════════════════════

abstract contract DeploymentScriptBase is Test {
    /// @dev Isolated from the real deployments/ records, and unique per test
    ///      suite so parallel suites never contend for the same file.
    ///      Git-ignored.
    string internal DIR;
    string internal constant NETWORK = "anvil";

    uint256 internal constant DEPLOYER_PK = 0xA11CE;

    address internal deployer;
    address internal feeReceiver;
    address internal stranger;

    // Instantiated once, in setUp, so that vm.expectRevert in a test only ever
    // applies to the run() call and is never consumed by a CREATE.
    LiveDeploy internal deployScript;
    LiveConfigure internal configureScript;
    LiveVerify internal verifyScript;
    LiveRegister internal registerScript;
    LiveCreateHypurr internal hypurrScript;
    RecordStore internal store;

    function setUp() public virtual {
        deployer = vm.addr(DEPLOYER_PK);
        feeReceiver = vm.addr(0xFEE);
        stranger = vm.addr(0xBAD);

        vm.deal(deployer, 1_000 ether);
        vm.deal(stranger, 1_000 ether);

        deployScript = new LiveDeploy();
        configureScript = new LiveConfigure();
        verifyScript = new LiveVerify();
        registerScript = new LiveRegister();
        hypurrScript = new LiveCreateHypurr();

        store = new RecordStore();
        deployScript.setStore(store);
        configureScript.setStore(store);
        verifyScript.setStore(store);
        registerScript.setStore(store);
        hypurrScript.setStore(store);

        // vm.startBroadcast behaves like a prank inside a test: it changes
        // msg.sender but value still leaves the calling contract's balance, so
        // the scripts that forward ETH need funding here.
        vm.deal(address(deployScript), 100 ether);
        vm.deal(address(configureScript), 100 ether);
        vm.deal(address(verifyScript), 100 ether);
        vm.deal(address(registerScript), 100 ether);
        vm.deal(address(hypurrScript), 100 ether);

        DIR = string.concat("deployments/test-artifacts/", _suiteName());

        // Configuration is injected straight into each script instance, so no
        // process-global environment is touched and parallel suites cannot
        // interfere with one another.
        _set("NETWORK", NETWORK);
        _set("PRIVATE_KEY", vm.toString(DEPLOYER_PK));
        _set("DEPLOYMENTS_DIR", DIR);
        _set("FEE_RECEIVER", vm.toString(feeReceiver));
        _set("MARKETPLACE_FEE", "100");
        // Deliberately populated with a bogus "previous deployment", so every
        // fail-closed assertion proves the scripts ignore ambient addresses.
        _set("CORE_ADDRESS", vm.toString(address(0xDEAD01)));
        _set("BIDS_ADDRESS", vm.toString(address(0xDEAD02)));
        _set("MARKETPLACE_ADDRESS", vm.toString(address(0xDEAD03)));
        _set("LAUNCHPAD_ADDRESS", vm.toString(address(0xDEAD04)));
    }

    /// @dev Distinct per suite: Foundry runs test suites in parallel and they
    ///      all share the same test-contract address, so the record directory
    ///      has to be keyed on something that actually differs.
    function _suiteName() internal pure virtual returns (string memory);

    /// @dev Sets one variable on every script instance.
    function _set(string memory key, string memory value) internal {
        deployScript.setVar(key, value);
        configureScript.setVar(key, value);
        verifyScript.setVar(key, value);
        registerScript.setVar(key, value);
        hypurrScript.setVar(key, value);
    }

    // ── record helpers ────────────────────────────────────────────────────────

    function _recordPath() internal view returns (string memory) {
        return string.concat(DIR, "/", NETWORK, ".json");
    }

    function _latestPath() internal view returns (string memory) {
        return string.concat(DIR, "/latest.json");
    }

    function _readStr(string memory key) internal view returns (string memory) {
        return vm.parseJsonString(store.read(_recordPath()), key);
    }

    function _readAddr(string memory key) internal view returns (address) {
        return vm.parseJsonAddress(store.read(_recordPath()), key);
    }

    function _readUint(string memory key) internal view returns (uint256) {
        return vm.parseJsonUint(store.read(_recordPath()), key);
    }

    function _readBool(string memory key) internal view returns (bool) {
        return vm.parseJsonBool(store.read(_recordPath()), key);
    }

    /// @dev Writes an arbitrary record so stale/legacy/tampered states can be set up.
    function _writeRawRecord(
        address core,
        address bids,
        address router,
        address launchpad,
        uint256 marketplaceFee,
        uint256 launchFee,
        string memory stage,
        bool configured
    ) internal {
        string memory json = string.concat(
            '{"core":"',
            vm.toString(core),
            '","bids":"',
            vm.toString(bids),
            '","marketplace":"',
            vm.toString(router),
            '","launchpad":"',
            vm.toString(launchpad),
            '","feeReceiver":"',
            vm.toString(feeReceiver),
            '","deployer":"',
            vm.toString(deployer),
            '","marketplaceFee":',
            vm.toString(marketplaceFee),
            ',"launchFee":',
            vm.toString(launchFee),
            ',"chainId":',
            vm.toString(block.chainid),
            ',"configured":',
            configured ? "true" : "false",
            ',"stage":"',
            stage,
            '","network":"',
            NETWORK,
            '"}'
        );
        store.write(_recordPath(), json);
    }

    // ── pipeline helpers ──────────────────────────────────────────────────────

    function _deploy() internal {
        deployScript.run();
    }

    function _configure() internal {
        configureScript.run();
    }

    function _verifyRun() internal {
        verifyScript.run();
    }

    function _deployAndConfigure() internal {
        _deploy();
        _configure();
    }

    function _core() internal view returns (MarketplaceCore) {
        return MarketplaceCore(payable(_readAddr(".core")));
    }

    function _bids() internal view returns (MarketplaceBids) {
        return MarketplaceBids(payable(_readAddr(".bids")));
    }

    function _router() internal view returns (Marketplace) {
        return Marketplace(_readAddr(".marketplace"));
    }

    function _launchpad() internal view returns (LaunchPad) {
        return LaunchPad(_readAddr(".launchpad"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPLOY
// ═══════════════════════════════════════════════════════════════════════════════

contract DeployMarketplaceTest is DeploymentScriptBase {
    function _suiteName() internal pure override returns (string memory) {
        return "deploy";
    }

    function test_FreshDeployWritesPartialRecordAndNoLatest() public {
        _deploy();

        assertTrue(store.exists(_recordPath()), "record not written");
        assertEq(_readStr(".stage"), "partial", "stage must be partial");
        assertFalse(_readBool(".configured"), "a deploy must never mark configured");
        assertFalse(store.exists(_latestPath()), "latest.json must not be written by the deploy step");

        assertGt(_readAddr(".core").code.length, 0);
        assertGt(_readAddr(".bids").code.length, 0);
        assertGt(_readAddr(".marketplace").code.length, 0);
        assertGt(_readAddr(".launchpad").code.length, 0);

        assertEq(_readUint(".marketplaceFee"), 100);
        assertEq(_readAddr(".feeReceiver"), feeReceiver);
        assertEq(_readAddr(".deployer"), deployer);
    }

    /// @dev Deploy must not wire anything; that is step 2's job.
    function test_FreshDeployLeavesWiringUnsetAndOwnershipWithDeployer() public {
        _deploy();

        assertEq(_core().router(), address(0));
        assertEq(_core().bidsContract(), address(0));
        assertEq(_bids().marketplace(), address(0));
        assertEq(_core().owner(), deployer);
        assertEq(_bids().owner(), deployer);
        assertEq(_router().owner(), deployer);
    }

    function test_RejectsFeeAboveContractMaximum() public {
        uint256 max = new MarketplaceCore(0, address(this)).MAX_MARKETPLACE_FEE();
        _set("MARKETPLACE_FEE", vm.toString(max + 1));

        vm.expectRevert(
            bytes(
                string.concat(
                    "MARKETPLACE_FEE ",
                    vm.toString(max + 1),
                    " exceeds MarketplaceCore.MAX_MARKETPLACE_FEE (",
                    vm.toString(max),
                    ")"
                )
            )
        );
        _deploy();
    }

    function test_AcceptsFeeExactlyAtContractMaximum() public {
        uint256 max = new MarketplaceCore(0, address(this)).MAX_MARKETPLACE_FEE();
        _set("MARKETPLACE_FEE", vm.toString(max));

        _deploy();
        assertEq(_core().marketplaceFee(), uint16(max));
    }

    // ── M-2: launch fee ───────────────────────────────────────────────────────

    function test_UnsetLaunchFeeKeepsContractDefault() public {
        _deploy();

        uint256 constructorDefault = new LaunchPad(address(_core())).launchFee();
        assertEq(_launchpad().launchFee(), constructorDefault, "must keep the contract default");
        assertEq(_readUint(".launchFee"), constructorDefault, "record must reflect the real fee");
        assertGt(constructorDefault, 0, "the contract default must not be zero");
    }

    function test_ZeroLaunchFeeRequiresExplicitConfirmation() public {
        _set("LAUNCH_FEE", "0");

        vm.expectRevert(
            bytes(
                "LAUNCH_FEE=0 makes LaunchPad.createCollection free and removes the spam deterrent. "
                "Set LAUNCH_FEE_CONFIRM_ZERO=true to confirm, or omit LAUNCH_FEE to keep the contract default."
            )
        );
        _deploy();
    }

    function test_ZeroLaunchFeeAppliedWhenConfirmed() public {
        _set("LAUNCH_FEE", "0");
        _set("LAUNCH_FEE_CONFIRM_ZERO", "true");

        _deploy();
        assertEq(_launchpad().launchFee(), 0);
        assertEq(_readUint(".launchFee"), 0);
    }

    function test_ExplicitLaunchFeeIsApplied() public {
        _set("LAUNCH_FEE", "250000000000000000");

        _deploy();
        assertEq(_launchpad().launchFee(), 0.25 ether);
        assertEq(_readUint(".launchFee"), 0.25 ether);
    }

    /// @dev A launch fee that never landed is corrected on re-run, not ignored.
    function test_ReRunRepairsLaunchFeeThatDidNotLand() public {
        _set("LAUNCH_FEE", "250000000000000000");
        _deploy();

        // Simulate setLaunchFee having failed on chain. The lookup is hoisted:
        // _launchpad() makes an external call, which would consume the prank.
        LaunchPad lp = _launchpad();
        vm.prank(deployer);
        lp.setLaunchFee(7 ether);
        assertEq(_launchpad().launchFee(), 7 ether);

        _deploy();
        assertEq(_launchpad().launchFee(), 0.25 ether, "re-run must reapply the requested fee");
    }

    // ── H-2 / H-3: recovery without disabling safety ──────────────────────────

    function test_ReRunReusesEveryComponentAndDeploysNothingNew() public {
        _deploy();
        address core0 = _readAddr(".core");
        address bids0 = _readAddr(".bids");
        address router0 = _readAddr(".marketplace");
        address lp0 = _readAddr(".launchpad");

        // No ALLOW_REDEPLOY, no flags: an ordinary re-run must be a no-op.
        _deploy();

        assertEq(_readAddr(".core"), core0, "core must be reused");
        assertEq(_readAddr(".bids"), bids0, "bids must be reused");
        assertEq(_readAddr(".marketplace"), router0, "router must be reused");
        assertEq(_readAddr(".launchpad"), lp0, "launchpad must be reused");
    }

    function test_InterruptedDeployReusesLiveComponentsAndDeploysOnlyMissing() public {
        _deploy();
        address core0 = _readAddr(".core");
        address bids0 = _readAddr(".bids");
        address router0 = _readAddr(".marketplace");
        address lp0 = _readAddr(".launchpad");

        // Record the state of a run that died after Core and Bids were created:
        // the later addresses were predicted by the simulation but never landed.
        _writeRawRecord(core0, bids0, address(0x1111), address(0x2222), 100, 10 ether, "partial", false);

        _deploy();

        assertEq(_readAddr(".core"), core0, "live Core must be reused, never duplicated");
        assertEq(_readAddr(".bids"), bids0, "live Bids must be reused, never duplicated");
        assertTrue(_readAddr(".marketplace") != address(0x1111), "missing router must be deployed");
        assertTrue(_readAddr(".launchpad") != address(0x2222), "missing launchpad must be deployed");
        assertGt(_readAddr(".marketplace").code.length, 0);
        assertGt(_readAddr(".launchpad").code.length, 0);
        assertEq(address(_router().core()), core0, "new router must bind the reused core");
        assertEq(address(_router().bids()), bids0, "new router must bind the reused bids");

        // The stack is still only partial until the verifier says otherwise.
        assertEq(_readStr(".stage"), "partial");
        assertFalse(_readBool(".configured"));

        // And it must survive the remaining steps.
        _configure();
        _verifyRun();
        assertEq(_readStr(".stage"), "verified");
    }

    /// @dev Core is reusable but Bids is not, so the router must be redeployed
    ///      too: it binds core and bids immutably at construction.
    function test_RouterIsRedeployedWhenBidsCannotBeReused() public {
        _deploy();
        address core0 = _readAddr(".core");
        address router0 = _readAddr(".marketplace");

        _writeRawRecord(core0, address(0x3333), router0, _readAddr(".launchpad"), 100, 10 ether, "partial", false);

        _deploy();

        assertEq(_readAddr(".core"), core0, "core must still be reused");
        assertTrue(_readAddr(".bids") != address(0x3333), "bids must be redeployed");
        assertTrue(_readAddr(".marketplace") != router0, "router must be redeployed with the new bids");
        assertEq(address(_router().bids()), _readAddr(".bids"));
        assertEq(address(_router().core()), core0);
    }

    function test_StaleRecordWithNoCodeIsArchivedAndRedeployed() public {
        _writeRawRecord(address(0xA1), address(0xA2), address(0xA3), address(0xA4), 100, 0, "partial", false);

        // No flag needed: nothing at those addresses exists on this chain.
        _deploy();

        assertGt(_readAddr(".core").code.length, 0);
        assertTrue(_readAddr(".core") != address(0xA1));
        assertTrue(_archiveExists(), "the superseded record must be archived, not deleted");
    }

    function test_IncompatibleLiveDeploymentIsRejectedWithoutExplicitRedeploy() public {
        MockLegacyCore legacyCore = new MockLegacyCore();
        MockLegacyBids legacyBids = new MockLegacyBids(address(legacyCore));
        _writeRawRecord(
            address(legacyCore), address(legacyBids), address(legacyCore), address(0), 100, 0, "partial", false
        );

        vm.expectRevert(
            bytes(
                string.concat(
                    "The recorded deployment at ",
                    _recordPath(),
                    " has live code but does not match the current contract interfaces. ",
                    "It is an older, incompatible deployment and cannot be reused or repaired. ",
                    "Re-run with ALLOW_REDEPLOY=true to archive that record and deploy a fresh stack."
                )
            )
        );
        _deploy();
    }

    function test_IncompatibleDeploymentCanBeReplacedWhenExplicitlyAllowed() public {
        MockLegacyCore legacyCore = new MockLegacyCore();
        _writeRawRecord(address(legacyCore), address(legacyCore), address(legacyCore), address(0), 100, 0, "partial", false);

        _set("ALLOW_REDEPLOY", "true");
        _deploy();

        assertTrue(_readAddr(".core") != address(legacyCore), "a fresh core must be deployed");
        assertEq(_core().router(), address(0), "fresh core starts unwired");
        assertTrue(_archiveExists(), "the legacy record must be archived");
    }

    function test_VerifiedDeploymentBlocksAccidentalRedeploy() public {
        _deployAndConfigure();
        _verifyRun();
        assertEq(_readStr(".stage"), "verified");

        vm.expectRevert(
            bytes(
                string.concat(
                    "A verified deployment is already recorded at ",
                    _recordPath(),
                    ". Nothing needs deploying. Re-run with ALLOW_REDEPLOY=true only if you intend to ",
                    "deploy a second, parallel stack; the existing record will be archived, not deleted."
                )
            )
        );
        _deploy();
    }

    function test_VerifiedDeploymentCanBeReplacedWhenExplicitlyAllowed() public {
        _deployAndConfigure();
        _verifyRun();
        address oldCore = _readAddr(".core");

        _set("ALLOW_REDEPLOY", "true");
        _deploy();

        assertTrue(_readAddr(".core") != oldCore, "a parallel stack must be deployed");
        assertEq(_readStr(".stage"), "partial", "the new stack starts unverified");
        assertTrue(_archiveExists(), "the verified record must be archived, not destroyed");
        assertGt(oldCore.code.length, 0, "the previous deployment must remain untouched on chain");
    }

    function test_RecordForAnotherChainIsRejected() public {
        string memory json = string.concat(
            '{"core":"',
            vm.toString(address(0xA1)),
            '","bids":"',
            vm.toString(address(0xA2)),
            '","marketplace":"',
            vm.toString(address(0xA3)),
            '","launchpad":"',
            vm.toString(address(0xA4)),
            '","marketplaceFee":100,"launchFee":0,"chainId":99801,"configured":false,',
            '"stage":"partial","network":"anvil"}'
        );
        store.write(_recordPath(), json);

        vm.expectRevert(
            bytes(
                string.concat(
                    "Record at ",
                    _recordPath(),
                    " is for chain 99801 but the connected chain is ",
                    vm.toString(block.chainid)
                )
            )
        );
        _deploy();
    }

    function _archiveExists() internal view returns (bool) {
        return store.exists(
            string.concat(DIR, "/archive/", NETWORK, "-", vm.toString(block.timestamp), "-superseded.json")
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURE
// ═══════════════════════════════════════════════════════════════════════════════

contract ConfigureMarketplaceTest is DeploymentScriptBase {
    function _suiteName() internal pure override returns (string memory) {
        return "configure";
    }

    function test_ConfiguresFreshDeployment() public {
        _deploy();
        _configure();

        assertEq(_core().router(), address(_router()));
        assertEq(_core().bidsContract(), address(_bids()));
        assertEq(_bids().marketplace(), address(_router()));
        assertEq(_core().owner(), address(_router()));
        assertEq(_bids().owner(), address(_router()));
        assertEq(_core().pendingOwner(), address(0));
        assertEq(_bids().pendingOwner(), address(0));
        assertTrue(_core().authorizedLaunchpads(address(_launchpad())));
        assertEq(_router().owner(), deployer);
    }

    /// @dev Configure must never promote the record; only the verifier may.
    function test_ConfigureLeavesRecordPartial() public {
        _deploy();
        _configure();

        assertEq(_readStr(".stage"), "partial");
        assertFalse(_readBool(".configured"));
        assertFalse(store.exists(_latestPath()));
    }

    function test_IsIdempotent() public {
        _deploy();
        _configure();
        _configure();
        _configure();

        assertEq(_core().router(), address(_router()));
        assertTrue(_core().authorizedLaunchpads(address(_launchpad())));
    }

    function test_ResumesAfterPartialOwnershipTransfer() public {
        _deploy();

        // A run that died after transferring Core but not Bids.
        MarketplaceCore coreRef = _core();
        address routerRef = address(_router());
        vm.prank(deployer);
        coreRef.transferOwnership(routerRef);

        _configure();

        assertEq(_core().owner(), address(_router()));
        assertEq(_bids().owner(), address(_router()));
        assertEq(_core().router(), address(_router()));
    }

    function test_ResumesAfterOwnershipAcceptedButWiringMissing() public {
        _deploy();

        MarketplaceCore coreRef = _core();
        MarketplaceBids bidsRef = _bids();
        Marketplace routerRef = _router();
        vm.startPrank(deployer);
        coreRef.transferOwnership(address(routerRef));
        bidsRef.transferOwnership(address(routerRef));
        routerRef.acceptComponentOwnership();
        vm.stopPrank();

        assertEq(_core().router(), address(0), "precondition: wiring still unset");

        _configure();

        assertEq(_core().router(), address(_router()));
        assertEq(_bids().marketplace(), address(_router()));
    }

    function test_ResumesAfterWiringButMissingLaunchpadAuthorization() public {
        _deploy();

        MarketplaceCore coreRef = _core();
        MarketplaceBids bidsRef = _bids();
        Marketplace routerRef = _router();
        vm.startPrank(deployer);
        coreRef.transferOwnership(address(routerRef));
        bidsRef.transferOwnership(address(routerRef));
        routerRef.acceptComponentOwnership();
        routerRef.configureBidsMarketplace();
        vm.stopPrank();

        assertFalse(_core().authorizedLaunchpads(address(_launchpad())));

        _configure();
        assertTrue(_core().authorizedLaunchpads(address(_launchpad())));
    }

    /// @dev H-3: set-once anchors bound elsewhere cannot be repaired, and the
    ///      script must say so instead of sending a transaction that reverts.
    function test_RejectsFrozenMismatchedWiring() public {
        _deploy();

        Marketplace impostor = new Marketplace(address(_core()), address(_bids()));

        // The deployer still owns Core here, so it can bind the wrong router.
        MarketplaceCore coreRef = _core();
        vm.prank(deployer);
        coreRef.setRouter(address(impostor));

        vm.expectRevert(
            bytes(
                "Partial or mismatched Core/Bids wiring. The set-once anchors above are permanent; "
                "this stack cannot be configured and must be redeployed. No transaction was sent."
            )
        );
        _configure();

        // Nothing was changed by the failed attempt.
        assertEq(_core().router(), address(impostor));
        assertEq(_core().owner(), deployer);
    }

    /// @dev Partially written anchors are equally unrecoverable, because
    ///      configureBidsMarketplace writes all three in one transaction.
    function test_RejectsPartiallyWrittenWiring() public {
        _deploy();

        MarketplaceCore coreRef = _core();
        address routerRef = address(_router());
        vm.prank(deployer);
        coreRef.setRouter(routerRef);

        vm.expectRevert(
            bytes(
                "Partial or mismatched Core/Bids wiring. The set-once anchors above are permanent; "
                "this stack cannot be configured and must be redeployed. No transaction was sent."
            )
        );
        _configure();
    }

    function test_RejectsWrongOwner() public {
        _deploy();
        _set("PRIVATE_KEY", vm.toString(uint256(0xBAD)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "Deployer ",
                    vm.toString(stranger),
                    " is neither owner nor pending owner of the router (owner is ",
                    vm.toString(deployer),
                    ")"
                )
            )
        );
        _configure();
    }

    // ── C-1: fail-closed resolution ───────────────────────────────────────────

    function test_FailsClosedWhenNoRecordExists() public {
        vm.expectRevert(
            bytes(
                string.concat(
                    "No deployment record at ",
                    _recordPath(),
                    ". Run DeployMarketplace first, or set USE_ENV_ADDRESSES=true together with ",
                    "CORE_ADDRESS, BIDS_ADDRESS and MARKETPLACE_ADDRESS to target explicit addresses. ",
                    "Addresses are never taken from the environment implicitly."
                )
            )
        );
        _configure();
    }

    function test_EnvAddressesRequireExplicitOptIn() public {
        _deployAndConfigure();
        address realCore = _readAddr(".core");
        address realBids = _readAddr(".bids");
        address realRouter = _readAddr(".marketplace");
        address realLp = _readAddr(".launchpad");

        // With the opt-in and real addresses, the env path works.
        _set("USE_ENV_ADDRESSES", "true");
        _set("CORE_ADDRESS", vm.toString(realCore));
        _set("BIDS_ADDRESS", vm.toString(realBids));
        _set("MARKETPLACE_ADDRESS", vm.toString(realRouter));
        _set("LAUNCHPAD_ADDRESS", vm.toString(realLp));

        _configure();
        assertEq(_core().router(), realRouter);
    }

    function test_EnvOptInStillRejectsAddressesWithoutCode() public {
        _set("USE_ENV_ADDRESSES", "true");
        _set("CORE_ADDRESS", vm.toString(address(0xC0DE01)));
        _set("BIDS_ADDRESS", vm.toString(address(0xC0DE02)));
        _set("MARKETPLACE_ADDRESS", vm.toString(address(0xC0DE03)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "CORE has no code at ",
                    vm.toString(address(0xC0DE01)),
                    " on chain ",
                    vm.toString(block.chainid)
                )
            )
        );
        _configure();
    }

    function test_RejectsMixedDeploymentAcrossStacks() public {
        _deploy();
        address coreA = _readAddr(".core");
        address routerA = _readAddr(".marketplace");

        // A second, independent stack.
        MarketplaceCore coreB = new MarketplaceCore(100, feeReceiver);
        MarketplaceBids bidsB = new MarketplaceBids(address(coreB));

        _writeRawRecord(coreA, address(bidsB), routerA, address(0), 100, 0, "partial", false);

        vm.expectRevert(
            bytes(
                string.concat(
                    "Mixed deployment: BIDS.core() is ", vm.toString(address(coreB)), " but CORE is ", vm.toString(coreA)
                )
            )
        );
        _configure();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════════════════════════════

contract VerifyDeploymentScriptTest is DeploymentScriptBase {
    function _suiteName() internal pure override returns (string memory) {
        return "verify";
    }

    function test_VerifiesAndPromotesRecord() public {
        _deployAndConfigure();
        assertEq(_readStr(".stage"), "partial");

        _verifyRun();

        assertEq(_readStr(".stage"), "verified");
        assertTrue(_readBool(".configured"));
        assertTrue(store.exists(_latestPath()), "latest.json must be written on success only");

        string memory latest = store.read(_latestPath());
        assertEq(vm.parseJsonAddress(latest, ".core"), _readAddr(".core"));
        assertEq(vm.parseJsonUint(latest, ".chainId"), block.chainid);
        assertEq(vm.parseJsonString(latest, ".network"), NETWORK);
    }

    /// @dev H-1: an unconfigured stack must never reach `verified`.
    function test_UnconfiguredDeploymentIsNotMarkedConfigured() public {
        _deploy();

        vm.expectRevert(bytes("R-5: core.router mismatch"));
        _verifyRun();

        assertEq(_readStr(".stage"), "partial", "stage must stay partial");
        assertFalse(_readBool(".configured"), "configured must stay false");
        assertFalse(store.exists(_latestPath()), "latest.json must not exist");
    }

    function test_PartiallyConfiguredDeploymentIsNotMarkedConfigured() public {
        _deploy();

        // Ownership moved, wiring never done.
        MarketplaceCore coreRef = _core();
        MarketplaceBids bidsRef = _bids();
        Marketplace routerRef = _router();
        vm.startPrank(deployer);
        coreRef.transferOwnership(address(routerRef));
        bidsRef.transferOwnership(address(routerRef));
        routerRef.acceptComponentOwnership();
        vm.stopPrank();

        vm.expectRevert(bytes("R-5: core.router mismatch"));
        _verifyRun();

        assertFalse(_readBool(".configured"));
        assertFalse(store.exists(_latestPath()));
    }

    function test_MissingLaunchpadAuthorizationBlocksVerification() public {
        _deploy();

        MarketplaceCore coreRef = _core();
        MarketplaceBids bidsRef = _bids();
        Marketplace routerRef = _router();
        vm.startPrank(deployer);
        coreRef.transferOwnership(address(routerRef));
        bidsRef.transferOwnership(address(routerRef));
        routerRef.acceptComponentOwnership();
        routerRef.configureBidsMarketplace();
        vm.stopPrank();

        vm.expectRevert(bytes("R-5: launchpad not authorized in Core"));
        _verifyRun();

        assertFalse(_readBool(".configured"));
    }

    /// @dev C-2 / the Elysium case: an older live deployment must be reported as
    ///      incompatible, not fail with an opaque revert.
    function test_RejectsIncompatibleLegacyDeployment() public {
        MockLegacyCore legacyCore = new MockLegacyCore();
        MockLegacyBids legacyBids = new MockLegacyBids(address(legacyCore));
        _writeRawRecord(
            address(legacyCore), address(legacyBids), address(legacyCore), address(0), 100, 0, "verified", true
        );

        vm.expectRevert(
            bytes(
                string.concat(
                    "Incompatible deployment: MarketplaceCore at ",
                    vm.toString(address(legacyCore)),
                    " did not answer router(). This is not a current MarketplaceCore build - it is most likely ",
                    "an older deployment. Archive its record and deploy a fresh stack instead of reusing it."
                )
            )
        );
        _verifyRun();
    }

    /// @dev H-1: a configuration transaction that never landed must be caught by
    ///      comparing live state against the record, not assumed to have worked.
    function test_RejectsLaunchFeeThatDidNotLand() public {
        _set("LAUNCH_FEE", "250000000000000000");
        _deployAndConfigure();

        // The record says 0.25 ether; the chain says something else, as it would
        // if setLaunchFee had failed after the record was written.
        LaunchPad lp = _launchpad();
        vm.prank(deployer);
        lp.setLaunchFee(9 ether);

        vm.expectRevert(
            bytes(
                string.concat(
                    "R-5: on-chain launch fee 9000000000000000000 does not match the recorded 250000000000000000",
                    " (setLaunchFee may not have landed)"
                )
            )
        );
        _verifyRun();

        assertEq(_readStr(".stage"), "partial");
        assertFalse(_readBool(".configured"));
    }

    function test_RejectsFeeReceiverThatDoesNotMatchTheRecord() public {
        _deployAndConfigure();

        Marketplace routerRef = _router();
        vm.prank(deployer);
        routerRef.updateFeeReceiver(stranger);

        vm.expectRevert(
            bytes(
                string.concat(
                    "R-5: on-chain fee receiver ",
                    vm.toString(stranger),
                    " does not match the recorded ",
                    vm.toString(feeReceiver)
                )
            )
        );
        _verifyRun();
        assertFalse(_readBool(".configured"));
    }

    function test_PromoteRecordFalseVerifiesWithoutWriting() public {
        _deployAndConfigure();
        _set("PROMOTE_RECORD", "false");

        _verifyRun();

        assertEq(_readStr(".stage"), "partial", "record must be untouched");
        assertFalse(store.exists(_latestPath()));
    }

    function test_PausedStackRequiresExpectPaused() public {
        _deployAndConfigure();

        Marketplace routerRef = _router();
        vm.prank(deployer);
        routerRef.pause();

        vm.expectRevert(bytes("R-5: core is paused"));
        _verifyRun();

        _set("EXPECT_PAUSED", "true");
        _verifyRun();
        assertEq(_readStr(".stage"), "verified");
    }

    function test_OptionalExpectationsAreEnforced() public {
        _deployAndConfigure();

        _set("EXPECTED_MARKETPLACE_FEE", "999");
        vm.expectRevert(bytes("R-5: marketplace fee mismatch"));
        _verifyRun();

        _set("EXPECTED_MARKETPLACE_FEE", "100");
        _set("EXPECTED_FEE_RECEIVER", vm.toString(feeReceiver));
        _set("EXPECTED_ROUTER_OWNER", vm.toString(deployer));
        _verifyRun();
        assertEq(_readStr(".stage"), "verified");

    }

    function test_FailsClosedWhenNoRecordExists() public {
        vm.expectRevert(
            bytes(
                string.concat(
                    "No deployment record at ",
                    _recordPath(),
                    ". Run DeployMarketplace first, or set USE_ENV_ADDRESSES=true together with ",
                    "CORE_ADDRESS, BIDS_ADDRESS and MARKETPLACE_ADDRESS to target explicit addresses. ",
                    "Addresses are never taken from the environment implicitly."
                )
            )
        );
        _verifyRun();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════════

contract RegisterCollectionScriptTest is DeploymentScriptBase {
    function _suiteName() internal pure override returns (string memory) {
        return "register";
    }

    MockNFT internal collection;

    function setUp() public override {
        super.setUp();
        collection = new MockNFT();
        _set("COLLECTION_ADDRESS", vm.toString(address(collection)));
        _set("ROYALTY_FEE", "250");
        _set("ROYALTY_RECEIVER", vm.toString(feeReceiver));
    }

    function _register() internal {
        registerScript.run();
    }

    function test_RegistersCollection() public {
        _deployAndConfigure();
        _register();

        Marketplace.CollectionInfo memory info = _router().collections(address(collection));
        assertTrue(info.exists);
        assertEq(info.royaltyFee, 250);
        assertEq(info.royaltyReceiver, feeReceiver);
    }

    function test_IsIdempotent() public {
        _deployAndConfigure();
        _register();
        _register();

        assertTrue(_router().collections(address(collection)).exists);
    }

    function test_RejectsDifferentFeeForAnAlreadyRegisteredCollection() public {
        _deployAndConfigure();
        _register();

        _set("ROYALTY_FEE", "300");
        vm.expectRevert(bytes("Collection is already registered with royalty fee 250, not 300"));
        _register();
    }

    function test_RejectsRoyaltyAboveContractMaximum() public {
        _deployAndConfigure();
        uint256 max = _router().MAX_ROYALTY_FEE();
        _set("ROYALTY_FEE", vm.toString(max + 1));

        vm.expectRevert(
            bytes(
                string.concat(
                    "ROYALTY_FEE ",
                    vm.toString(max + 1),
                    " exceeds Marketplace.MAX_ROYALTY_FEE (",
                    vm.toString(max),
                    ")"
                )
            )
        );
        _register();
    }

    function test_RejectsNonOwner() public {
        _deployAndConfigure();
        _set("PRIVATE_KEY", vm.toString(uint256(0xBAD)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "Deployer ", vm.toString(stranger), " is not the router owner (", vm.toString(deployer), ")"
                )
            )
        );
        _register();
    }

    function test_RejectsCollectionWithoutCode() public {
        _deployAndConfigure();
        _set("COLLECTION_ADDRESS", vm.toString(address(0xFEEDBEEF)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "COLLECTION_ADDRESS has no code at ",
                    vm.toString(address(0xFEEDBEEF)),
                    " on chain ",
                    vm.toString(block.chainid)
                )
            )
        );
        _register();
    }

    /**
     * @dev C-1 regression. A live router sits in MARKETPLACE_ADDRESS, exactly as
     *      a stale `.env` would provide, and there is no deployment record. The
     *      script must refuse rather than silently register against it.
     */
    function test_FailsClosedAndIgnoresAmbientMarketplaceAddress() public {
        // Build a complete, working stack, then hide its record.
        _deployAndConfigure();
        address liveRouter = _readAddr(".marketplace");
        store.remove(_recordPath());

        _set("MARKETPLACE_ADDRESS", vm.toString(liveRouter));
        _set("CORE_ADDRESS", vm.toString(_readAddrFrom(liveRouter)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "No deployment record at ",
                    _recordPath(),
                    ". Run DeployMarketplace first, or set USE_ENV_ADDRESSES=true together with ",
                    "CORE_ADDRESS, BIDS_ADDRESS and MARKETPLACE_ADDRESS to target explicit addresses. ",
                    "Addresses are never taken from the environment implicitly."
                )
            )
        );
        _register();

        assertFalse(
            Marketplace(liveRouter).collections(address(collection)).exists,
            "nothing may be registered against an ambient address"
        );
    }

    function _readAddrFrom(address router) internal view returns (address) {
        return address(Marketplace(router).core());
    }
}

contract CreateHypurrScriptTest is DeploymentScriptBase {
    function _suiteName() internal pure override returns (string memory) {
        return "hypurr";
    }

    function _create() internal {
        hypurrScript.run();
    }

    function test_DeploysAndRegistersCollection() public {
        _deployAndConfigure();
        _set("CONFIRM_NEW_COLLECTION", "true");

        _create();
        // Verification inside the script asserts registration and parameters;
        // reaching this point without a revert is the assertion.
    }

    function test_RequiresExplicitConfirmationForANewCollection() public {
        _deployAndConfigure();

        vm.expectRevert(
            bytes(
                "Set CONFIRM_NEW_COLLECTION=true to deploy a new collection (or HYPURR_COLLECTION_ADDRESS to resume)"
            )
        );
        _create();
    }

    function test_MintOneWorks() public {
        _deployAndConfigure();
        _set("CONFIRM_NEW_COLLECTION", "true");
        _set("HYPURR_MINT_ONE", "true");

        _create();
    }

    function test_RejectsNonOwner() public {
        _deployAndConfigure();
        _set("CONFIRM_NEW_COLLECTION", "true");
        _set("PRIVATE_KEY", vm.toString(uint256(0xBAD)));

        vm.expectRevert(
            bytes(
                string.concat(
                    "Deployer ", vm.toString(stranger), " is not the router owner (", vm.toString(deployer), ")"
                )
            )
        );
        _create();
    }

    /// @dev C-1 regression for the script the audit caught targeting the old
    ///      Elysium router through a stale ambient MARKETPLACE_ADDRESS.
    function test_FailsClosedAndIgnoresAmbientMarketplaceAddress() public {
        _deployAndConfigure();
        address liveRouter = _readAddr(".marketplace");
        store.remove(_recordPath());

        _set("MARKETPLACE_ADDRESS", vm.toString(liveRouter));
        _set("CONFIRM_NEW_COLLECTION", "true");

        vm.expectRevert(
            bytes(
                string.concat(
                    "No deployment record at ",
                    _recordPath(),
                    ". Run DeployMarketplace first, or set USE_ENV_ADDRESSES=true together with ",
                    "CORE_ADDRESS, BIDS_ADDRESS and MARKETPLACE_ADDRESS to target explicit addresses. ",
                    "Addresses are never taken from the environment implicitly."
                )
            )
        );
        _create();
    }

    function test_RejectsLegacyRouterFromTheRecord() public {
        MockLegacyCore legacyCore = new MockLegacyCore();
        MockLegacyBids legacyBids = new MockLegacyBids(address(legacyCore));
        _writeRawRecord(
            address(legacyCore), address(legacyBids), address(legacyCore), address(0), 100, 0, "verified", true
        );
        _set("CONFIRM_NEW_COLLECTION", "true");

        vm.expectRevert(
            bytes(
                string.concat(
                    "Incompatible deployment: MarketplaceCore at ",
                    vm.toString(address(legacyCore)),
                    " did not answer router(). This is not a current MarketplaceCore build - it is most likely ",
                    "an older deployment. Archive its record and deploy a fresh stack instead of reusing it."
                )
            )
        );
        _create();
    }
}
