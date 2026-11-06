# Deployment runbook

Deployment is **three separate steps**, each a separate process, each safe to
re-run. Nothing is considered deployed until step 3 has read real on-chain state.

| Step | Script | Sends transactions | Writes the record |
|---|---|---|---|
| 1 | `DeployMarketplace` | yes — deploys missing components | `stage: partial` (unconfirmed) |
| 2 | `ConfigureMarketplace` | yes — ownership, wiring, authorization | no |
| 3 | `VerifyDeployment` | **no** — read-only `eth_call`s | `stage: verified` + `latest.json` |

## Why three steps

A `forge script` runs **once**, during simulation, and Foundry broadcasts the
collected transactions **afterwards**. Every cheatcode — including every file
write — and every `require` therefore executes *before* any transaction reaches
the chain. A record written by a deploy script, or an assertion it makes, cannot
distinguish success from a transaction that failed on chain.

So the deploy step writes only an explicitly unconfirmed `partial` record, and
the single authority on "is this deployed and configured" is step 3, which runs
as its own process against the live RPC and is the only writer of
`configured: true` and of `deployments/latest.json`.

## Required environment

Set in `packages/contracts/foundry/.env` (git-ignored; never commit it):

```
PRIVATE_KEY=0x...        # deployer key. Never printed by any script.
```

`NETWORK` is deliberately **not** in `.env`: it must be passed per command so
the target network is always an explicit, visible choice. Every script validates
`block.chainid` against it.

| Variable | Step | Meaning |
|---|---|---|
| `NETWORK` | all | `elysium` (99801) or `sepolia` (11155111). Required. |
| `FEE_RECEIVER` | 1 | Defaults to the deployer. |
| `MARKETPLACE_FEE` | 1 | Basis points, default `100` (1%). Ceiling is read from `MarketplaceCore.MAX_MARKETPLACE_FEE`. |
| `LAUNCH_FEE` | 1 | Wei. **If unset, `setLaunchFee` is not called and LaunchPad keeps its own constructor default (10 ether).** |
| `LAUNCH_FEE_CONFIRM_ZERO` | 1 | Must be `true` to accept `LAUNCH_FEE=0`, which makes `createCollection` free. |
| `ALLOW_REDEPLOY` | 1 | Only needed to deploy a **second, parallel** stack. Not needed for recovery. |
| `USE_ENV_ADDRESSES` | 2,3 | `true` to target `CORE_ADDRESS`/`BIDS_ADDRESS`/`MARKETPLACE_ADDRESS` (+`LAUNCHPAD_ADDRESS`) instead of the record. |
| `PROMOTE_RECORD` | 3 | `false` to verify without writing anything. |
| `EXPECT_PAUSED` | 3 | `true` when Core and Bids are expected paused. |
| `EXPECTED_*` | 3 | Optional assertions: `EXPECTED_MARKETPLACE_FEE`, `EXPECTED_FEE_RECEIVER`, `EXPECTED_ROUTER_OWNER`, `EXPECTED_LAUNCH_FEE`, `EXPECTED_LAUNCHPAD_OWNER`, `COLLECTION`. |
| `DEPLOYMENTS_DIR` | all | Record directory. Defaults to `deployments`. |

Addresses are **never** read from the environment implicitly. Foundry
auto-loads `.env`, so an implicit fallback would let a stale
`MARKETPLACE_ADDRESS` silently redirect a script at a previous deployment. A
missing record is an error; `USE_ENV_ADDRESSES=true` is the only opt-in.

## Deploying to Elysium Testnet

Run from `packages/contracts/foundry`. **Dry-run each step first** (omit
`--broadcast`): nothing is sent and no record is written.

```bash
# 0. preflight: tests and a dry run of step 1
forge test
NETWORK=elysium forge script DeployMarketplace --rpc-url elysium

# 1. deploy the components
NETWORK=elysium forge script DeployMarketplace --rpc-url elysium --slow --broadcast

# 2. ownership handshake + wiring + launchpad authorization
NETWORK=elysium forge script ConfigureMarketplace --rpc-url elysium --slow --broadcast

# 3. verify real on-chain state and promote the record (no --broadcast)
NETWORK=elysium forge script VerifyDeployment --sig "run()" --rpc-url elysium
```

`--slow` makes Foundry wait for each transaction to confirm before sending the
next, which bounds how far a mid-sequence failure can get and removes the
nonce race that would otherwise invalidate predicted CREATE addresses.

Step 3 must print `ALL ON-CHAIN CHECKS PASSED.` and promote the record to
`stage: verified`. Until it does, **the deployment is not done**, whatever the
earlier steps printed.

### Optional: collections

```bash
# an externally deployed ERC721
NETWORK=elysium COLLECTION_ADDRESS=0x... ROYALTY_FEE=250 ROYALTY_RECEIVER=0x... \
  forge script RegisterCollection --rpc-url elysium --slow --broadcast

# the Hypurr test collection
NETWORK=elysium CONFIRM_NEW_COLLECTION=true \
  forge script CreateHypurr --rpc-url elysium --slow --broadcast
```

Both require a `verified`-or-`partial` record for the network and will refuse to
run without one.

## Royalties: fallback vs. override

The royalty registered with a collection is a **fallback**, not an enforced
override.

`MarketplaceCore.registerCollectionFromRouter` stores the fee and receiver but
does **not** set `royaltyOverridden`. `MarketplaceCore._getRoyalty` prefers the
collection's own ERC-2981 `royaltyInfo` whenever the collection implements it
and returns a non-zero receiver with an amount at or below `MAX_ROYALTY_FEE`.
The registered values are used only when ERC-2981 is absent or unusable.

To make the marketplace-side values authoritative, the **collection owner** must
call `Marketplace.updateCollectionRoyalty`. That is the only path that sets
`royaltyOverridden`, and from then on Core's values win.

`RegisterCollection` prints which source will actually be used, so a successful
registration is never mistaken for an enforced fee.

## Recovery

**Ordinary recovery needs no flags.** Re-run the failed step.

`DeployMarketplace` decides what to do from on-chain reality, not from whether a
file exists:

| Situation | Behaviour |
|---|---|
| No record | Deploy the full stack. |
| Record exists, none of its addresses have code | Archive the record, deploy fresh. |
| Record exists, some components live and usable | **Reuse them**, deploy only what is missing. |
| All four live and usable, record `partial` | Nothing to deploy; go to step 2. |
| All four live, record `verified` | Refuse. `ALLOW_REDEPLOY=true` deploys a parallel stack and archives the old record. |
| Live code that does not match the current interfaces | Refuse with an explicit "older, incompatible deployment" message. `ALLOW_REDEPLOY=true` to archive and start fresh. |

A component is reused only when it has code, answers the current interfaces, and
its immutable links agree. Because `Marketplace` binds Core and Bids immutably at
construction, a Bids that cannot be reused forces the router to be redeployed
too — the script handles that automatically.

Prefer a plain re-run over `forge script --resume`. The reuse logic covers the
same ground, works even when the broadcast log is gone, and re-validates
everything against the chain instead of replaying a stored transaction list.

### What cannot be recovered

`MarketplaceCore.setRouter`, `MarketplaceCore.setBidsContract` and
`MarketplaceBids.setMarketplaceAddress` are **set-once** — each reverts with
`AlreadySet()` after its first write — and `Marketplace.configureBidsMarketplace`
writes all three in a single transaction.

The wiring is therefore all-or-nothing and permanent. If any anchor is written to
the wrong address, or only some of the three are written, that stack **cannot be
configured and must be redeployed**. `ConfigureMarketplace` detects this, prints
exactly which anchors are frozen and to what, and refuses to send a transaction
that could only revert. It does not attempt a repair, because none exists.

## Record format

`deployments/<network>.json`:

```json
{
  "core": "0x…", "bids": "0x…", "marketplace": "0x…", "launchpad": "0x…",
  "feeReceiver": "0x…", "deployer": "0x…",
  "marketplaceFee": 100, "launchFee": 10000000000000000000,
  "chainId": 99801, "updatedAt": 1762300000,
  "configured": true, "stage": "verified", "network": "elysium"
}
```

- `stage: partial` — written during simulation. Addresses are **predicted and
  unconfirmed**. `configured` is always `false`.
- `stage: verified` — written by `VerifyDeployment` after reading on-chain state.
  `configured` is `true`.

`deployments/latest.json` is a copy of the most recently **verified** record. It
carries `network` and `chainId`, and every script cross-checks both against the
connected chain, so an Elysium record can never be used against Sepolia.

Superseded records are copied into `deployments/archive/` before being replaced.
Records are archived, never deleted — see `deployments/archive/README.md`.

## Tests

`test/DeploymentScripts.t.sol` covers all five scripts on a local EVM: success
paths, invalid and code-less addresses, wrong ownership, stale records, records
from another chain, legacy/incompatible deployments, mixed-stack address sets,
interrupted deployments with component reuse, frozen set-once wiring, and the
launch-fee rules.

The tests inject configuration and record storage directly into the script
instances rather than using `vm.setEnv` and the filesystem, because both are
global to the forge process while Foundry executes test cases concurrently.
They are hermetic: they write no files and reach no network.

```bash
forge test --match-path test/DeploymentScripts.t.sol -vv
```
