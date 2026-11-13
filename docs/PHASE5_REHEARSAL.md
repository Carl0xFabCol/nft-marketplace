# Phase 5: end-to-end rehearsal on a throwaway Anvil chain (audit test #21)

Status: **done** (2026-11-13). Branch `chore/production-readiness-phase5`, not merged. The recorded run passed 16/16 steps and 183/183 checks, and ended with DB == chain (0 mismatches).

## 1. What it is

A single scripted, repeatable rehearsal, `scripts/rehearsal` (`@marketplace/rehearsal`), runs the whole pipeline on a throwaway local chain:

- the **real** Foundry scripts: Deploy, Configure, Verify and RegisterCollection;
- the address generator on the verified record (rules 1–10), plus the ABI check and `validate:integration`;
- `prepare-deployment`;
- the **real** indexer process;
- on-chain scenarios, with bid acceptance bounded by the **web's own** quote code;
- the indexer robustness scenarios;
- the web data layer;
- an exact DB-vs-chain reconciliation.

It ends with the DB matching the chain exactly.

## 2. How to run it

Prerequisites:
- Foundry 1.5.1 (`forge`, `anvil`) on PATH;
- Docker running;
- `pnpm install`;
- `packages/database/baseline/baseline_schema.sql` present locally (gitignored);
- the repository's `packages/contracts/foundry/out` built from the current sources (`generate:abis:check` must pass; rule 10 compares the deployed bytecode with it).

```sh
pnpm --filter @marketplace/rehearsal anvil-e2e -- --scratch <a directory OUTSIDE the repository>
```

Flags:
- `--keep`: leave the local Supabase stack running afterwards. Anvil, the indexer and the metadata server are always stopped.
- `--reuse-db`: development only. Wipes the rows of an already running stack instead of rebuilding it. The recorded runs never use it.

Outputs, all in the scratch directory (nothing is written into the repository):
- `run.log.jsonl`: every step, check and finding;
- `summary.txt`;
- `reconcile-1.txt`, `reconcile-final.txt`;
- the logs `anvil.log`, `indexer.log`, `web-rehearsal.log` and `validate-live-31337.log`;
- `foundry/` (the scratch Foundry copy with `deployments/anvil.json` + `latest.json`);
- `addresses.generated.ts` (the generator's output for 31337).

The Supabase project directory is `<scratch>-supabase` (project_id `sec01-local`).

Reconciliation on its own (the Phase 7 seed) is read-only. The key comes from the shell, and no `.env` is read:

```sh
SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @marketplace/rehearsal reconcile -- \
  --chain-id 31337 --rpc http://127.0.0.1:18545 --supabase-url http://127.0.0.1:54321 \
  --core <addr> --bids <addr> --router <addr> --from-block <deployBlock>
```

It refuses non-loopback URLs unless `--allow-remote` (Phase 7, by the operator).

## 3. Isolation (no secrets, local only)

The CLAUDE.md rule against `forge --broadcast` has one explicit exception, for Phase 5 only: a local Anvil on `127.0.0.1` with Anvil's published test keys. Nothing else was relaxed.

- **Keys.** The only private keys are Anvil's eight well-known test accounts, hard-coded in `src/guards.ts` (`ANVIL_ACCOUNTS`). A unit test (`guards.test.ts`) checks that every hard-coded key derives its hard-coded published address (`0xf39F…2266` for account 0).
  - Roles: deployer 0, creator 1, alice 2, bob 3, carol 4, dave 5, royalty receiver 6, fee receiver 7.
  - No real key is read or used.
- **No `.env` is read anywhere.**
  - Forge runs from a **scratch copy** of `packages/contracts/foundry` (`src`, `script`, `test`, `lib`, `foundry.toml` only). The copy asserts that neither the copy nor any of its ancestors contains a `.env`, and config is passed inline (`NETWORK=anvil PRIVATE_KEY=<anvil key> DEPLOYMENTS_DIR=deployments`).
  - The indexer and `prepare-deployment` get `DOTENV_CONFIG_PATH=<scratch>/empty-dotenv`.
  - The web suite runs with `envDir` = `apps/web/rehearsal/no-env` (an empty directory).
  - Every child process gets an **allowlisted** environment (`src/proc.ts`), so nothing leaks in from the parent shell.
- **Local only.** Every URL in env or argv must be `127.0.0.1`/`localhost`/`::1`. `assertRehearsalLaunch` checks this and throws otherwise. `ARCHIVE_RPC_URL`, `FALLBACK_RPC_URL` and `IPFS_GATEWAY` are forced empty. Collections use a loopback base URI served by a local metadata server (`src/metadata.ts`), so the indexer's metadata fetcher never leaves the machine.
- **Database.** A local Supabase stack, project `sec01-local`, in `<scratch>-supabase` (outside the repo). It is built from the byte-preserving adapted baseline + all 17 migrations (090000–091600) and must be `FINGERPRINT-SAME` as `catalog_fingerprint.after_phase3b.txt` before anything else runs. The keys come from `supabase status -o env` in process memory and are never written to disk. No dump is written or committed.
- **31337 never enters production config.** No file under `packages/*/src`, `apps/*/src`, `apps/web/lib` or `foundry/script` mentions 31337 or an `anvil` network entry. Instead, `scripts/rehearsal/src/launch.ts <generate-addresses|prepare-deployment|indexer>`:
  1. refuses unless `REHEARSAL=1`, `CHAIN_ID=31337`, all URLs are loopback and `REHEARSAL_ADDRESSES_FILE` is set;
  2. **in process memory only**, pushes 31337 to `SUPPORTED_CHAIN_IDS`, sets `NETWORK_CHAIN_IDS.anvil`, `VIEM_CHAINS_BY_ID[31337]` and `CONTRACT_ADDRESSES[31337]`. That last one is imported from the **generator's own output file** in scratch, so the indexer consumes exactly what the generator wrote;
  3. then imports the unmodified production entry point. If the patch did not take effect, `env.ts` throws "CHAIN_ID must be one of …" (it fails loudly).

  The guard test `src/__tests__/productionGuard.test.ts` runs in `turbo test` and fails if any production source or committed `addresses*.ts` gains a 31337/anvil entry. The web suite adds 31337 only through its own `vi.mock` of `@/lib/chains`. The suite lives in `apps/web/rehearsal/`, which the default `vitest.config.ts` excludes.
- **Teardown.** A `finally` block stops the indexer, Anvil, the metadata server and the Supabase stack (unless `--keep`), including after a failure.

## 4. Pipeline and results

### Recorded run (2026-11-13, fresh DB, no `--reuse-db`)

Command: `pnpm --filter @marketplace/rehearsal anvil-e2e -- --scratch <scratchpad>/final3`. Result: exit 0, **16/16 steps, 183/183 checks, 0 failed.** Foundry 1.5.1 and Supabase CLI 2.119.0 on Windows 10, with Docker Desktop (4 GB VM).

| Step | Checks | Result |
|---|---:|---|
| 1. local DB: adapted baseline + 17 migrations | 2 | `FINGERPRINT-SAME` as `after_phase3b.txt` |
| 2. Anvil + Deploy → Configure → Verify (real scripts) + collections | 23 | See below |
| 3. generate-addresses (rules 1–10) + ABIs + validate:integration | 14 | See below |
| 4. prepare-deployment | 11 | See below |
| 5. real indexer process | 2 | See below |
| 6. on-chain scenarios | 2 + every tx | See below |
| 7. slippage proof + withdrawals | 99 | See below |
| 9a. reconciliation #1 | 1 | **0 mismatches** at block 232 |
| 8a–8g. robustness | 24 | See below |
| 10. web data layer | 3 (+ 4 vitest tests) | See below |
| 9b. final reconciliation | 2 | **0 mismatches** at block 341 |

**Step 2.**
- The real scripts run with `--broadcast` against `127.0.0.1:18545` only.
- After Deploy: `stage=partial`, `configured=false`, `deployBlock=101`, and the four creation-code hashes are recorded. ConfigureMarketplace leaves the record partial. VerifyDeployment promotes it to `verified` / `configured=true`, stamps `verifiedAt` and preserves `deployBlock`.
- `deployBlock` is proven against chain history: no Core code at block 100; it equals the first deployment tx block and the simulated head + 1.
- The repository's `foundry/deployments/` gained no anvil record. `latest.json` was written only in scratch.
- F-1 was reproduced: RegisterCollection with forge's default gas reverts on-chain with `0xd0f2e27c`. The flagged runs then registered all four collections:
  - A: Hyperc, ERC-2981 500 bps, registered with 300;
  - B: MockNFT, stored 200;
  - C: LaunchPad Hyperc, 750;
  - D: MockNFT, 0.

**Step 3.**
- The generator accepted the verified record on its first real use (rules 1–9, plus rule 10: the deployed creation-code hashes equal the repository's `out/` artifacts).
- Five negative probes each exited 1 and wrote nothing:
  - partial record (rule 1);
  - mutated `bidsCodeHash` (rule 10);
  - `deployBlock` 0 (rule 10);
  - dead RPC (rule 8);
  - two components sharing an address (rule 4).
- `generate:abis:check` and `validate:integration` (99801) passed. `--live --chain-id 31337` is F-2.

**Step 4.** prepare-deployment's first success path:
- `indexer_state` = 100 (deployBlock − 1), hash NULL; `deployBlock` taken from the record;
- a second run is a no-op;
- `--deploy-block 106` vs the record's 101 is refused;
- lowering 201 → 100 is refused without `--force` (exit 1, cursor untouched); `--force` lowers it.

**Step 5.** The real indexer process starts through `launch.ts`. Its provider `eth_chainId` check passes, and Core's constructor `OwnershipTransferred` in the deploy block itself is indexed, so `deployBlock − 1` skips nothing.

**Step 6.** The scenarios:
- mint;
- list, batch list, update, cancel, buy, `buyBatch`;
- token bids (incl. raise), batch bids, a collection bid with quantity 3, cancellations;
- token-bid acceptance, partial (2/3) and final collection-bid fills, a bid accepted on a listed token;
- verify/unverify, royalty override/clear, fee update;
- pause: a write reverts `EnforcedPause`, which the web maps to "This contract is paused. Try again later."; then unpause.

Every tx is checked (`must`/`mustRevert`); there are no unexpected reverts.

**Step 7: slippage proof.**
- Every acceptance used `quoteTokenBid`/`quoteCollectionBid` + `acceptBounds(q, DEFAULT_SLIPPAGE_BPS = 0)` from `apps/web/lib/bidAcceptance.ts`.
- For **all 14 accepted cases**, `minPrice` equals the price shown and `minSellerProceeds` equals the proceeds shown. Seller, fee receiver and royalty receiver were credited **exactly** `quote.proceeds`, `quote.marketplaceFee` and `quote.royalty`, to the wei. Cases:
  - ERC-2981 (A) at 0.5 ETH, 1 wei and 3 wei;
  - override 400 bps at 1234567890123456789 wei;
  - stored fallback (B) at 10¹⁸+1;
  - no royalty (D) at 1 wei and 1234567890123456789;
  - LaunchPad ERC-2981 (C) at 3 wei;
  - a bid on a listed token at 10¹⁸+7;
  - a 3-token collection bid at 1234567890123456789 each;
  - a B partial fill (2/3) and the final unit;
  - the re-quoted stale-fee and stale-royalty acceptances.
- **Stale quotes:**
  - fee raised after quoting → `SellerProceedsTooLow`, mapped to "Your proceeds would be lower than shown (the marketplace fee or royalty changed)…", and nothing is sold;
  - override royalty raised → `SellerProceedsTooLow`, same message;
  - bid lowered → `PriceTooLow`, and the web quote itself refuses with `bid_changed`.
- **Withdrawals:** for all six actors, the balance delta equals pending (Core + Bids) minus gas, and nothing is left pending.

**Step 8: indexer robustness.**
- (a) `last_block_hash` == `eth_getBlockByNumber(last_block).hash`.
- (b) Real fork via `evm_snapshot`/`evm_revert` (cursor 244, fork 238):
  - the stored block is no longer canonical, and `REORG_DETECTED` halts the indexer loudly;
  - the cursor stays frozen across polls, nothing is written (159 rows before and after), and no rows come from the orphaned blocks;
  - after the documented operator rewind (`REORG_ROLLBACK_DESIGN.md` §4) it resumes on the canonical fork.
- (b′) `anvil_reorg` replaced the cursor block (block 268, new hash) → `REORG_DETECTED`, halted, rewound to the fork point, resumed.
- (c) Hard kill (`SIGKILL`) mid-range (start 273, cursor 278, target 315; BATCH_SIZE 5), then restart: no duplicate `(tx_hash, log_index)`, and all 20 burst listings are present and active.
- (d) `INSERT` on `activity` revoked from `service_role` → the cursor holds at B−1 (B = 321), with no row. After re-granting, the retry writes the row exactly once.
- (e) With no new blocks the cursor stays at head − 2; mining 2 releases exactly the old head.
- (f) Every `activity.created_at` equals its block timestamp (asserted in 9b: 0 differences).
- (g1) `prepare-deployment --force` + replay of the whole range over existing rows changes nothing (audit #11 on a real chain). Collection cursors are seeded at indexer block − 1.
- (g2) Wipe of all derived tables + `--force` reset to deployBlock − 1 + reindex from scratch → the canonical dump of the derived state is **byte-identical**.

**Step 10: web.** The web's own services, against the rehearsal DB, with a 99801 decoy using the same collection address and token:
- chain-scoped collection reads, with `total_volume` as exact text equal to `getCollectionStats`;
- NFT detail never shows the decoy's owner or listing;
- every active listing carries the exact on-chain price as text;
- **23503:** with the indexer stopped, B#500 is minted and listed on-chain. The real `saveBatchListingToDB` returns `not_indexed`. The real `retryOptimisticListing` asks the driver to restart the indexer and returns `saved`. The row matches the chain.

All 4 tests passed.

**Step 9b: final reconciliation** at block 341: 263 logs (203 marketplace/transfer events indexed) ↔ 203 activity rows, one-to-one per type; 4 collections; 23 active listings; 2 active token bids; 0 active collection bids; 61 NFTs; **0 mismatches**. SALE 20 = Sale 20. Info: Core snapshots `feeBps`/`royaltyBps` per listing, and the DB has no columns for them (decoded, not compared).

### Attempts before the recorded run

The rehearsal stops at the first failed check, so the recorded run was the third fresh run of the day.
- **Attempt 1:** steps 1–8a passed, then (b′) failed: **F-4**.
- **Attempt 2:** with F-4 fixed, 1–8g passed, then step 10 failed: **F-5**.
- **Attempt 3:** both fixed, everything passed.

The checks were never weakened.

### Resources (this machine: 8 GB RAM, Windows 10, Docker Desktop 4 GB VM)

- Free physical memory during the runs: **minimum ≈ 380 MB, average ≈ 680–720 MB**.
- The Supabase containers themselves used ≈ 300–400 MB. The rest is Docker's VM reservation plus forge (the full `forge build`), node/tsx, the indexer and the web vitest.
- A run takes ≈ 6–8 min (step 1 ≈ 45–110 s, step 2 ≈ 80–100 s, step 10 ≈ 10 s).
- An earlier (pre-session) run was killed by the host for low memory. Close other applications before running.

## 5. Findings

| ID | Step | Class | Severity | Observed vs expected | Status |
|---|---|---|---|---|---|
| F-1 | 2 | contract (deploy tooling: runbook/scripts, not contract source) | medium | `forge script RegisterCollection --broadcast` (and `CreateHypurr`, same `Marketplace.registerCollection` call) **reverts on-chain** with `BoundedStaticCallInsufficientGas` (`0xd0f2e27c`) after a successful simulation. Forge sets the gas limit to ~1.3× the simulated gas used (125,115), below Core's bounded-staticcall floor (`gasleft() >= gasLimit*64/63 + 5000`). Wallets using `eth_estimateGas` are unaffected. | **Docs only, by decision:** `DEPLOYMENT.md` now requires `--gas-estimate-multiplier 200` (20df731). Scripts unchanged. Phase 6 requirement. The rehearsal reproduces it every run. |
| F-2 | 3 | test-harness | info | `validate:integration --live --chain-id 31337` cannot run (d): the suite imports the indexer contract config, which throws for a chain without production addresses. | By design. (d)'s property is covered by generator rule 8 and the indexer's startup `eth_chainId` check, both exercised. |
| F-3 | 4 | indexer | low | `prepare-deployment`'s refusal after a DB call crashed on Windows with `0xC0000409` (libuv assertion on `process.exit` with open handles) instead of exiting 1. | Fixed (148872a): `process.exitCode = 1` + guard test. |
| F-4 | 8b′ | test-harness | low | `anvil_reorg(5, [])` re-mined byte-identical empty blocks (same parent, timestamp, contents), so block 268 kept hash `0xf462…2e1b` and no reorg happened. The check correctly failed. | Fixed (d51d312): the fork carries a 1-wei tx, depth is derived from the cursor, and the rewind goes to the real fork point. Unit tests. |
| F-5 | 10 | test-harness | low | On automine Anvil no block followed the 23503 listing, so the restarted indexer (CONFIRMATIONS=2) never reached it (head 339, next 338) and the retry timed out. The indexer behaved correctly. | Fixed (d0e85ec): the driver mines CONFIRMATIONS blocks after the restart. Unit test. |
| F-6 | 9a | test-harness | low | (development runs) Reconciliation priced `CollectionBidAccepted` with `pricePerItem`, but the activity row carries `totalPrice`. | Fixed before commit, with a test (`reconcile.test.ts`). |
| F-7 | 8b | test-harness | low | (development runs) viem's cached `getBlockNumber` let the harness read a stale head after `evm_revert` ("Block at number 252 could not be found"). | Fixed before commit: `cacheTime: 0` for the rehearsal and reconcile clients. |

No contract-source, DB or web defect was found. Every unexpected revert seen was F-1.

## 6. What remains

- **Phase 6 requirements (from this rehearsal):**
  - **F-1:** register collections with `--gas-estimate-multiplier 200` (or a wallet that uses `eth_estimateGas`).
  - **`.sol` line endings vs rule 10.** `.sol` files are not LF-pinned (`core.autocrlf=true`). The CBOR metadata in the bytecode therefore differs between a Windows and a Linux checkout, and rule 10 will reject a record deployed from one OS when `generate-addresses` runs on the other. Deploy and generate from the same checkout, or pin `*.sol text eol=lf` in `.gitattributes` first. That change is not made here (it alters artifact hashes; needs approval).
  - **Elysium `block.number` / `deployBlock`.** On Anvil, `deployBlock` = simulated head + 1 = the first deployment tx block, proven against `eth_getCode` history. On Arbitrum Orbit, Solidity `block.number` (used by forge's simulation) is not the L2 block number. On Elysium, check `deployBlock` against the first deployment tx receipt and `eth_getCode(core, deployBlock − 1) == 0x` before `prepare-deployment`.
- **Not verified here:**
  - a public testnet with real wallets (plan item ➕);
  - the deployment record has no commit SHA (needs `ffi`);
  - `CreateHypurr` was not run (its `ipfs://` base URI would reach public gateways);
  - automatic reorg rollback does not exist (detection, halt and operator rewind were rehearsed).
- **Phase 7 seed:** `reconcile-cli.ts` (read-only; refuses remote URLs without `--allow-remote`).
- **CI proposal (not added).** A `rehearsal` job on `ubuntu-latest`: Foundry 1.5.1 + Docker (`supabase start`) + `pnpm --filter @marketplace/rehearsal anvil-e2e -- --scratch $RUNNER_TEMP/rehearsal`, ~8–10 min, no secrets. **Blocker:** `packages/database/baseline/baseline_schema.sql` is gitignored. It needs a sanitized schema-only baseline committed, or the job building from the fingerprinted catalog.
