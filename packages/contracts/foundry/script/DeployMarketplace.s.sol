// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console} from "forge-std/console.sol";
import {DeploymentConfig} from "./DeploymentConfig.sol";
import {MarketplaceCore} from "../src/MarketplaceCore.sol";
import {MarketplaceBids} from "../src/MarketplaceBids.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {LaunchPad} from "../src/LaunchPad.sol";

/**
 * @title DeployMarketplace
 * @notice Step 1 of 3. Ensures the four marketplace contracts exist on the
 *         selected network. It does NOT wire them and does NOT verify anything.
 *
 * Deployment is split into three independent, individually resumable steps:
 *
 *   1. DeployMarketplace    - deploy missing components, write a `partial` record
 *   2. ConfigureMarketplace - ownership handshake, wiring, launchpad authorization
 *   3. VerifyDeployment     - read real on-chain state, promote to `verified`
 *
 * The split is deliberate. Foundry executes a script once, during simulation,
 * and only afterwards broadcasts the collected transactions, so any record
 * written or assertion made by this script describes simulated state. Treating
 * the record as confirmed, or verifying inside the deploy script, cannot detect
 * a transaction that failed on chain (audit findings H-1 and C-2). Only step 3,
 * which runs as a separate process against the real chain, may mark a deployment
 * configured.
 *
 * Re-running this script is safe and is the normal recovery path. Components
 * recorded by a previous interrupted run are reused when they have code, answer
 * the current interfaces, and point at each other correctly; only the genuinely
 * missing ones are deployed. No safety flag is needed to recover.
 *
 * Required environment:
 *   NETWORK                  elysium | sepolia
 *   PRIVATE_KEY              deployer key (never printed)
 *
 * Optional environment:
 *   FEE_RECEIVER             defaults to the deployer
 *   MARKETPLACE_FEE          basis points, default 100 (1%); the maximum is read
 *                            from MarketplaceCore.MAX_MARKETPLACE_FEE
 *   LAUNCH_FEE               wei. If unset, LaunchPad keeps its own constructor
 *                            default and setLaunchFee is not called at all.
 *   LAUNCH_FEE_CONFIRM_ZERO  must be true to accept LAUNCH_FEE=0
 *   ALLOW_REDEPLOY           must be true to deploy a second, parallel stack
 *                            while a usable one is already recorded
 */
contract DeployMarketplace is DeploymentConfig {
    enum Action {
        Fresh, // nothing usable on chain: deploy the whole stack
        Resume, // reuse what exists, deploy only the missing components
        NothingToDeploy // all four already exist and are usable
    }

    struct Plan {
        Action action;
        address core;
        address bids;
        address marketplace;
        address launchpad;
        bool archiveFirst;
        string reason;
    }

    struct Settings {
        address deployer;
        address feeReceiver;
        uint256 marketplaceFee;
        uint256 maxMarketplaceFee;
        uint256 launchFee;
        bool launchFeeExplicit;
    }

    /**
     * @notice Reads MAX_MARKETPLACE_FEE from the contract instead of copying it.
     * @dev Created outside every broadcast block, so this instance exists only
     *      in the simulation and is never sent on chain. Solidity cannot read a
     *      contract's constant through its type name, and duplicating the
     *      literal in the script is exactly the drift the audit flagged (L-1),
     *      so the value is taken from a throwaway instance of the real contract.
     */
    function _maxMarketplaceFee() internal returns (uint256) {
        // A zero fee receiver makes the constructor fall back to msg.sender.
        // Note `address(this)` must not be used: Foundry rejects it in script
        // contracts because their addresses are ephemeral.
        return new MarketplaceCore(0, address(0)).MAX_MARKETPLACE_FEE();
    }

    function run() external {
        NetworkConfig memory net = _validateNetwork();
        (uint256 privateKey, address deployer) = _deployer();

        Settings memory settings = _loadSettings(deployer);
        DeploymentRecord memory rec = _readRecord(net.name);
        Plan memory plan = _planDeployment(net, rec);

        _logHeader(net, settings, plan);
        _logDryRunNotice();

        if (plan.archiveFirst && _isLive()) {
            _archiveRecord(net.name, "superseded");
        }

        // Always run: every step inside is idempotent, so a stack that is fully
        // deployed but whose launch fee never landed is still corrected here.
        _execute(privateKey, plan, settings);

        // Read the launch fee back so the record carries the value this run
        // actually leaves in place, including LaunchPad's own default.
        (, uint256 onChainLaunchFee) = _probeUint(plan.launchpad, "launchFee()");

        if (_isLive()) {
            DeploymentRecord memory out;
            out.core = plan.core;
            out.bids = plan.bids;
            out.marketplace = plan.marketplace;
            out.launchpad = plan.launchpad;
            out.feeReceiver = settings.feeReceiver;
            out.deployer = settings.deployer;
            out.marketplaceFee = settings.marketplaceFee;
            out.launchFee = onChainLaunchFee;
            // Deliberately `partial`: these addresses are predicted by the
            // simulation and are not confirmed until VerifyDeployment says so.
            _writeRecord(net, out, STAGE_PARTIAL, false);
        }

        _logFooter(net, plan, onChainLaunchFee);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════

    function _loadSettings(address deployer) internal returns (Settings memory settings) {
        settings.deployer = deployer;

        settings.feeReceiver = _envAddressOr("FEE_RECEIVER", deployer);
        require(settings.feeReceiver != address(0), "FEE_RECEIVER must be non-zero");

        settings.maxMarketplaceFee = _maxMarketplaceFee();
        settings.marketplaceFee = _envUintOr("MARKETPLACE_FEE", 100);
        require(
            settings.marketplaceFee <= settings.maxMarketplaceFee,
            string.concat(
                "MARKETPLACE_FEE ",
                vm.toString(settings.marketplaceFee),
                " exceeds MarketplaceCore.MAX_MARKETPLACE_FEE (",
                vm.toString(settings.maxMarketplaceFee),
                ")"
            )
        );

        // M-2: never silently default the launch fee to zero. An unset variable
        // leaves LaunchPad's own constructor default untouched; an explicit zero
        // has to be confirmed, because it disables the only spam deterrent on a
        // permissionless factory.
        (settings.launchFeeExplicit, settings.launchFee) = _envUintOpt("LAUNCH_FEE");
        if (settings.launchFeeExplicit) {
            if (settings.launchFee == 0) {
                require(
                    _envBool("LAUNCH_FEE_CONFIRM_ZERO"),
                    "LAUNCH_FEE=0 makes LaunchPad.createCollection free and removes the spam deterrent. "
                    "Set LAUNCH_FEE_CONFIRM_ZERO=true to confirm, or omit LAUNCH_FEE to keep the contract default."
                );
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PLANNING AND GUARDS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Decides what to deploy based on on-chain reality, not file presence.
     * @dev The previous guard keyed off "does a record file exist", which forced
     *      ALLOW_REDEPLOY=true for an ordinary first deployment and then disabled
     *      every other protection at the same time (audit finding H-2). Recovery
     *      of an interrupted run now needs no flag at all; the flag is reserved
     *      for the one genuinely ambiguous case, namely a usable recorded stack
     *      that the operator wants to replace with a parallel one.
     */
    function _planDeployment(NetworkConfig memory net, DeploymentRecord memory rec)
        internal
        view
        returns (Plan memory plan)
    {
        if (!rec.exists) {
            plan.action = Action.Fresh;
            plan.reason = "No existing record: deploying a fresh stack.";
            return plan;
        }

        require(
            rec.chainId == 0 || rec.chainId == net.chainId,
            string.concat(
                "Record at ",
                _deploymentPath(net.name),
                " is for chain ",
                vm.toString(rec.chainId),
                " but the connected chain is ",
                vm.toString(net.chainId)
            )
        );

        bool anyLive = _hasCode(rec.core) || _hasCode(rec.bids) || _hasCode(rec.marketplace)
            || _hasCode(rec.launchpad);

        if (!anyLive) {
            plan.action = Action.Fresh;
            plan.archiveFirst = true;
            plan.reason =
                "A record exists but none of its addresses have code on this chain: archiving it and deploying fresh.";
            return plan;
        }

        // Reuse only components that are current builds AND belong together.
        if (_looksLikeCore(rec.core)) {
            plan.core = rec.core;
            if (_looksLikeBids(rec.bids, plan.core)) plan.bids = rec.bids;
            // The router binds core and bids immutably, so it is reusable only
            // when both of those are the ones we are keeping.
            if (plan.bids != address(0) && _looksLikeRouter(rec.marketplace, plan.core, plan.bids)) {
                plan.marketplace = rec.marketplace;
            }
            if (_looksLikeLaunchPad(rec.launchpad, plan.core)) plan.launchpad = rec.launchpad;
        }

        bool reusingAnything =
            plan.core != address(0) || plan.bids != address(0) || plan.marketplace != address(0) || plan.launchpad != address(0);

        if (!reusingAnything) {
            // Live code exists at the recorded addresses, but none of it is a
            // usable current build. This is the "old deployment" case.
            require(
                _envBool("ALLOW_REDEPLOY"),
                string.concat(
                    "The recorded deployment at ",
                    _deploymentPath(net.name),
                    " has live code but does not match the current contract interfaces. ",
                    "It is an older, incompatible deployment and cannot be reused or repaired. ",
                    "Re-run with ALLOW_REDEPLOY=true to archive that record and deploy a fresh stack."
                )
            );
            plan.action = Action.Fresh;
            plan.archiveFirst = true;
            plan.reason = "Recorded deployment is incompatible with the current contracts: deploying fresh.";
            return plan;
        }

        bool complete = plan.core != address(0) && plan.bids != address(0) && plan.marketplace != address(0)
            && plan.launchpad != address(0);

        if (complete) {
            if (_isVerifiedStage(rec) || rec.configured) {
                require(
                    _envBool("ALLOW_REDEPLOY"),
                    string.concat(
                        "A verified deployment is already recorded at ",
                        _deploymentPath(net.name),
                        ". Nothing needs deploying. Re-run with ALLOW_REDEPLOY=true only if you intend to ",
                        "deploy a second, parallel stack; the existing record will be archived, not deleted."
                    )
                );
                plan.action = Action.Fresh;
                plan.archiveFirst = true;
                plan.core = address(0);
                plan.bids = address(0);
                plan.marketplace = address(0);
                plan.launchpad = address(0);
                plan.reason = "ALLOW_REDEPLOY=true: deploying a new parallel stack and archiving the old record.";
                return plan;
            }

            plan.action = Action.NothingToDeploy;
            plan.reason = "All four components already exist and are usable: nothing to deploy.";
            return plan;
        }

        plan.action = Action.Resume;
        plan.reason = "Resuming an interrupted deployment: reusing live components, deploying only what is missing.";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════

    function _execute(uint256 privateKey, Plan memory plan, Settings memory settings) internal {
        vm.startBroadcast(privateKey);

        if (plan.core == address(0)) {
            plan.core = address(new MarketplaceCore(uint16(settings.marketplaceFee), settings.feeReceiver));
            console.log("Deployed MarketplaceCore:", plan.core);
        } else {
            console.log("Reusing MarketplaceCore:", plan.core);
        }

        if (plan.bids == address(0)) {
            plan.bids = address(new MarketplaceBids(plan.core));
            console.log("Deployed MarketplaceBids:", plan.bids);
        } else {
            console.log("Reusing MarketplaceBids:", plan.bids);
        }

        if (plan.marketplace == address(0)) {
            plan.marketplace = address(new Marketplace(plan.core, plan.bids));
            console.log("Deployed Marketplace:", plan.marketplace);
        } else {
            console.log("Reusing Marketplace:", plan.marketplace);
        }

        if (plan.launchpad == address(0)) {
            plan.launchpad = address(new LaunchPad(plan.core));
            console.log("Deployed LaunchPad:", plan.launchpad);
        } else {
            console.log("Reusing LaunchPad:", plan.launchpad);
        }

        if (settings.launchFeeExplicit) {
            (, uint256 current) = _probeUint(plan.launchpad, "launchFee()");
            if (current != settings.launchFee) {
                LaunchPad(plan.launchpad).setLaunchFee(settings.launchFee);
                console.log("Applied LAUNCH_FEE (wei):", settings.launchFee);
            } else {
                console.log("LAUNCH_FEE already set (wei):", settings.launchFee);
            }
        } else {
            console.log("LAUNCH_FEE not set: keeping the LaunchPad constructor default.");
        }

        vm.stopBroadcast();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    function _logHeader(NetworkConfig memory net, Settings memory settings, Plan memory plan) internal view {
        console.log("=================================");
        console.log("MARKETPLACE DEPLOYMENT (step 1/3)");
        console.log("=================================");
        console.log("Network:", net.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", settings.deployer);
        console.log("Fee receiver:", settings.feeReceiver);
        console.log("Marketplace fee (bps):", settings.marketplaceFee);
        console.log("Max allowed fee (bps):", settings.maxMarketplaceFee);
        if (settings.launchFeeExplicit) {
            console.log("Launch fee (wei):", settings.launchFee);
        } else {
            console.log("Launch fee: contract default (LAUNCH_FEE not set)");
        }
        console.log("");
        console.log("Plan:", plan.reason);
    }

    function _logFooter(NetworkConfig memory net, Plan memory plan, uint256 launchFee) internal view {
        console.log("");
        console.log("=================================");
        console.log("COMPONENTS IN PLACE");
        console.log("=================================");
        console.log("MarketplaceCore:     ", plan.core);
        console.log("MarketplaceBids:     ", plan.bids);
        console.log("Marketplace (router):", plan.marketplace);
        console.log("LaunchPad:           ", plan.launchpad);
        console.log("LaunchPad fee (wei): ", launchFee);
        console.log("Users interact with the router; NFT approvals target Core.");

        console.log("");
        if (!_isLive()) {
            console.log("Dry run: no record written. Nothing has been deployed.");
            return;
        }

        console.log("This deployment is NOT configured and NOT verified yet.");
        console.log("Next, run step 2 then step 3:");
        console.log(
            string.concat("  NETWORK=", net.name, " forge script ConfigureMarketplace --rpc-url ", net.name, " --slow --broadcast")
        );
        console.log(
            string.concat(
                "  NETWORK=", net.name, " forge script VerifyDeployment --sig \"run()\" --rpc-url ", net.name
            )
        );
    }
}
