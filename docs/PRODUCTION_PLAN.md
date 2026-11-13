# Roadmap

## Phase 0: Foundation and safety net (no behavior changes)

- [x] Create CI in `.github/workflows` (currently empty): `forge test`, typecheck, turbo tests.
  - `.github/workflows/ci.yml`: jobs `contracts` (forge build + test, then `generate:abis:check`), `typescript` (`turbo run test`, `turbo run typecheck --filter=!@marketplace/database`), and `integration-contract-tests` (`continue-on-error`, known failures). Pinned Foundry v1.5.1, pnpm 9.0.0, Node 22, `--frozen-lockfile`. No secrets, no live RPC/Supabase.
  - Precondition: `pnpm-lock.yaml` and `docs/PRODUCTION_PLAN.md` / `docs/INTEGRATION_AUDIT.md` are now tracked (they were gitignored). `.gitattributes` forces LF on `*.generated.ts`.
- [x] Write `generate-abis.ts` with a `--check` mode (events-only and full bundles).
  - `packages/contracts/scripts/generate-abis.ts` → `src/abis/{events,full,launchpad,collection}.generated.ts`. Header stamps the solc version and a keccak256 over **LF-normalized** compilation sources.
  - Not consumed yet: `src/abis/index.ts` and the hand-pasted `*.abi.ts` files are untouched (Phase 4). Package `exports` gained `./abis/generated/*` and `./integration-checks` for tests only.
- [x] Write `generate-addresses.ts` with the 9 rejection rules and a `--check` mode.
  - `packages/contracts/scripts/generate-addresses.ts` and `scripts/lib/addresses.ts`. The RPC layer is injectable (`ChainReader`). Rule 6 also checks `core.router`, `core.bidsContract` and `bids.marketplace`.
  - Not run against the legacy stack. No `addresses.generated.ts` exists and `addresses.ts` is untouched (Phase 6). It is not yet a CI `--check` step, because there are no verified records and it needs live RPC (add it in Phase 6).
- [x] Create `pnpm validate:integration` (config events vs. ABI, handlers vs. config, `CHAIN_ID`, etc.).
  - `scripts/validate-integration.mjs [--chain-id N] [--live]` runs `apps/indexer/src/__integration__/integration.integration.test.ts` (checks a, b, c, f, plus d with `--live`) and test #8.
  - `dotenv/config` is mocked, so no `.env` is ever read. (d) is off in CI.
- [x] Add tests 3, 4, 5, 7, and 8 from the report. They must fail at first (`ContractAuthorized`, `acceptTokenBid` arity).
  - #3 `foundry/test/EventSignatures.t.sol` and #4 `foundry/test/RouterEmitsNoDomainEvents.t.sol` both pass.
  - #5 `scripts/__tests__/generate-abis.test.ts` plus the CI `--check` step.
  - #6 (9-rule negative suite) `scripts/__tests__/generate-addresses.test.ts`, with mock RPC only.
  - #7 is in the indexer integration suite.
  - #8 `packages/contracts/src/__integration__/frontend-call-shape.integration.test.ts`, with a guard that its table covers every `functionName:` in apps/web.

### Known-failing tests (CI job `integration-contract-tests`; blocking since Phase 4, nothing known-failing remains)

Do not weaken these. Each one turns green when the listed phase fixes the code.

| Test / check | Failure today | Fixed in |
| --- | --- | --- |
| ~~#7 / validate (a) events exist in generated ABI~~ | **Green since Phase 3A task 5.** It failed because `core:ContractAuthorized` was configured while the event is now `LaunchpadAuthorized`. (b) is still green after the coordinated config and handler change. | Phase 3A |
| ~~#8 call-shape: `acceptTokenBid`~~ | **Green since Phase 4.** It failed because the web passed 3 args and the contract takes 5 (`minPrice`, `minSellerProceeds`). | Phase 4 (ABI-1) |
| ~~#8 call-shape: `acceptCollectionBid`~~ | **Green since Phase 4.** It failed because the web passed 3 args and the contract takes 5 (`minPricePerItem`, `minSellerProceeds`). | Phase 4 (ABI-1) |
| ~~validate (c) CHAIN_ID required~~ | **Green since Phase 3A task 7.** It failed because `apps/indexer/src/config/env.ts:71` silently defaulted to 11155111. | Phase 3A |
| ~~validate (f) default chain id consistent~~ | **Green since Phase 3A task 7.** It failed on indexer 11155111 vs shared/contracts 99801. | Phase 3A |
| ~~`@marketplace/database` typecheck~~ | **Green since Phase 3A task 1.** It had a supabase-js generic type error in `src/client.ts` (2 errors); the generic was dropped (type-only). It now runs in the main `typescript` job. | Phase 3A |
| web `rls.integration.test.ts` (22 tests) | Skipped in CI (needs `SEC01_TEST_SUPABASE_*`). Locally, after the fixes: **22/22** (re-run in Phase 4: 22/22) | n/a (passes locally) |
| pgTAP `sec01_rls_privileges.test.sql` (103) | Not in CI. Locally, after 090600 and the fixtures: **103/103**. After 090000–091100 (Phase 2 fixture): 103/103. | n/a (passes locally) |
| pgTAP `phase2_migrations.test.sql` (56) and `tests-realdata/phase2_roundtrip.test.sql` (19) | Not in CI; they need a local stack (the round-trip also needs the restored backup). Locally: 56/56 and 19/19 (SEC01_STATUS §3.9). | n/a (passes locally) |
| pgTAP `phase3b_migrations.test.sql` (78) and indexer `test:localdb` (8) | Not in CI; they need a local stack. Locally, empty baseline and restored backup: 78/78 and 8/8 (SEC01_STATUS §3.10). | n/a (passes locally) |

`(b)` handler/config bijection **passes** today, because `ContractAuthorizedHandler` exists and matches the stale config. It will catch the Phase 3 change if handlers and config are not updated together.

### Audit vs. code discrepancies found in Phase 0

- `.github/workflows/` did not exist at all; only `.github/ISSUE_TEMPLATE/` did. `packages/contracts/foundry/.github/workflows/test.yml` exists but GitHub never runs it, because only the repo root is scanned.
- `foundry/lib/*` is vendored as tracked files, not git submodules.
- `pnpm-lock.yaml` and `docs/` were gitignored. Both are now tracked (except for other files in `docs/`).
- The deployment record written by `DeploymentConfig.sol` has no `verifiedAt`, commit SHA, deploy block, or artifact hash, although §3.3 and §8.3 assume them. `DEPLOYMENT_METADATA.verifiedAt` uses `updatedAt`. The artifact-hash-at-deploy check from §8.3 needs a record field (future work).
- With `core.autocrlf=true` and no `.gitattributes`, solc's `metadata.sources[*].keccak256` differs between Windows and Linux checkouts. That is why the ABI header hashes LF-normalized sources.
- "28 indexed events" (§10 #3) doesn't match the artifacts: Core has 22 events and Bids 13. Test #3 pins all of them, plus ERC-721 `Transfer` and `LaunchPad.CollectionDeployed` (37 assertions).
- The audit predicted only #7 and #8 to fail. Checks (c) and (f) also fail today, and (b) passes.
- `@marketplace/indexer` has no `typecheck` script, so `turbo run typecheck` never typechecks it. Adding one is out of Phase 0 scope.
- The collection contract is `Hyperc` (`src/MERC721.sol`), not `MiColeccion`. The web's `MiColeccionABI` call sites are checked against `HypercAbi`.
- An untracked `apps/indexer/pnpm-lock.yaml` exists next to the root lockfile. It was left as-is; consider deleting it.

## Phase 1: Recover lost work

Branch `chore/production-readiness-phase1`. It is **not merged to main** and must not be deployed before Phase 2 (see "Cutover hazard" below).

- [x] Review and bring in `fix/bigint-precision` (commit `fc85e2b`), path-wise with `git checkout fc85e2b -- <paths>`, not as a merge.
  - 60 files came in as-is. None of the 62 non-Foundry files had changed on main since the merge-base `e2b5985`.
  - Commits:
    - `feat(shared): canonical listing identity helpers`
    - `fix(indexer,database): chain-scoped listing identity`
    - `feat(web): wallet trust boundary and chain-scoped reads/writes`. The auth/actions and chainGuard groups are folded into one commit because `failListingsByTxHash(hash, chainId)` doesn't typecheck without its callers.
    - `feat(database): SEC-01 migrations and RLS test suites (files only)`
  - Adaptations:
    - `@marketplace/database` now declares `@marketplace/shared` (lockfile importer entry only).
    - `apps/web` gets a `test` script and its own `vitest.config.ts` (`@` alias), so the 6 recovered web test files run under turbo/CI.
- [x] Resolve the Foundry conflicts in favor of `main`. All 27 Foundry files plus `.gas-snapshot` were discarded:
  - 16 tests: 9 modified on both sides, 7 deleted on main.
  - 5 `src` + 6 `script` files. Their branch changes are `forge fmt` plus a pragma pin `^0.8.24`→`0.8.24`, with no logic change.
  - `git diff main -- packages/contracts/foundry` is empty. `forge test` passes 336/336, and `generate:abis:check` is up to date.
- [x] Fix `docs/SEC01_STATUS.md`. Rewritten from scratch (tracked via a `.gitignore` exception). It now separates in-repo code, unapplied migrations, unverified suites, and what is missing.
- [x] Make the pgTAP RLS suite run against a disposable Postgres, and run the 22 skipped tests. Done 2026-11-07 on a **local** stack; full results are in `docs/SEC01_STATUS.md` §3.
  - **DB test environment:**
    - Supabase CLI 2.119.0 via `npx` from `packages/database`, with `--workdir` pointing to a scratch dir outside the repo. Postgres image 17.11.0.002, pgTAP 1.3.3.
    - Only db, auth, rest and kong were enabled.
    - The SQL was applied with `docker exec -i supabase_db_<id> psql -U postgres -v ON_ERROR_STOP=1`.
    - Vitest env vars came from `supabase status -o env` inside the same shell command and were never written out.
  - **Baseline adaptations (scratch copy only):**
    - dropped `CREATE SCHEMA public;`;
    - ran the 12 `FOR ROLE supabase_admin` default-privilege lines as `supabase_admin`.
  - **Migrations:** 090000–090500 all applied cleanly, one at a time. 090400 touched only `sec01_save_listing_batch`, because the baseline has no SECURITY DEFINER functions.
  - **pgTAP:** 86/102 ok. #87 is a fixture problem, and the run aborts at #88 (fixture: `listings_nft_fk`). With fixtures it aborts at #90 on a **real bug**: `listings_collection_address_token_id_key` and `unique_tx_token` are not chain-scoped and survive 090500. With fixtures plus the proposed 090600 the result is 102/102.
  - **Vitest:** 19/22. The 3 listing-RPC tests fail with `23503 listings_nft_fk` (fixture). The proposed fixture patch gives 22/22.
  - **Cutover:**
    - main's `onConflict: "listing_id"` fails with 42P10 after 090500;
    - main's `updatePrice`/`deactivate` by `listing_id` silently update 0 rows;
    - the branch paths work, except a cross-chain listing (same bug).
  - `.gitignore` pointed at `packages/contracts/database/baseline/`, so the baseline was **not** ignored. Fixed in its own commit.
- [x] Apply the SEC01_STATUS §3.7 fixes (approved 2026-11-07), one commit per fix:
  - new migration 090600 (finishes M-3), plus a pgTAP assertion for it, which brings the suite to 103;
  - pgTAP fixtures and vitest `ensureNfts` setup. The diffs add only fixture/setup lines; no assertion or `expect` changed;
  - `run-rls-tests.mjs` now uses `npx`;
  - keep `listings_nft_fk`, and handle 23503 in Phase 4.
  - Full local re-run, cycle 2: fresh DB → baseline → 090000–090600 gives **pgTAP 103/103** and **vitest 22/22**, with no ad-hoc rows (SEC01_STATUS §3.8).
- [x] Follow-up: `pnpm test:rls` now forwards extra args. Usage: `SEC01_TEST_DB_URL=<local db url> pnpm --filter @marketplace/database test:rls -- --workdir <dir holding the local supabase/ project>`. Verified locally: `Files=1, Tests=103, Result: PASS`.
  - Pre-commit dependency check for 090600: nothing in `apps/`, `packages/` or the migrations references `listings_collection_address_token_id_key` or `unique_tx_token`.
  - Every listings `onConflict` targets `chain_id,collection_address,token_id`.
  - Every single-row listings read is chain-scoped.
- Test results on the branch:
  - typecheck (excluding database): green.
  - turbo test: shared 8, database 2, indexer 31 (28 before), contracts 72, web 40 passed / 22 skipped.
  - `validate:integration`: same as Phase 0. (a), (c), (f) and #8 `acceptTokenBid`/`acceptCollectionBid` fail as known; (b) passes.

### Audit vs. code discrepancies found in Phase 1

- **IDX-4 is not on `fc85e2b`.**
  - §5 IDX-4 and P1-1 say the fix "is already implemented on fix/bigint-precision". It is not.
  - The indexer still uses `Number(price)` at `CoreEventHandler.ts:211` and `:257` and at `BidsEventHandler.ts:143` and `:300`.
  - `ListingsRepository` and `BidsRepository` still take `price: number`.
  - The branch's indexer changes are listing identity only. The web side already sent wei as strings.
  - Moved to Phase 3.
- **The SEC01 status note was never on `main`.** §6.3 says `docs/SEC01_STATUS.md` "sits on main". It was never tracked (`docs/*` is gitignored), and it was not on disk or on any branch.
- **"22 RLS tests skipped" are vitest tests, not pgTAP.** The pgTAP file has no skips.
- **SQL line counts.** The six migrations total 1,800 lines, not the 2,254 stated in the audit header. The individual file sizes match §6.3.
- **M-7 is not covered by the branch** (§7 implies it was verified there). Neither the indexer upsert nor the RPC conflict path resets `buyer_wallet`. `apps/web/lib/listingMerge.ts:93` then hides a relisted token's active listing.
- **090400 revokes too broadly and pins `search_path` blind.** It revokes EXECUTE on *every* SECURITY DEFINER function and pins `search_path` without inspecting bodies. Review the functions in the baseline before applying it.
  - Resolved 2026-11-07: the live baseline has **zero** SECURITY DEFINER functions (all 15 are invoker), so this risk does not materialize. The audit's assumption that the read RPCs are definer functions is wrong for this schema.
- **M-3 is not complete in 090500.** The baseline has `UNIQUE (collection_address, token_id)` and `UNIQUE (tx_hash, collection_address, token_id)`, which neither the audit nor the migrations mention. Both block cross-chain listings.
- **`listings_nft_fk`** (`listings` → `nfts` → `collections`) is not mentioned in the audit. It makes optimistic listings depend on the indexer having already written the `nfts` row.
- **The cutover hazard is wider than the audit's 42P10.** Main's `updatePrice`/`deactivate` by `listing_id` silently no-op after the `listing_id` rewrite.

## Phase 2: Database migrations (while there are only ~46 rows)

Branch `chore/production-readiness-phase2`, created from `chore/production-readiness-phase1`. Neither branch is merged to main. Applied to production by the operator, following `docs/PHASE2_RUNBOOK.md` (status updated in Phase 3B). Full results are in `docs/SEC01_STATUS.md` §3.9.

**Cutover hazard** (Phase 1 finding, widened in Phase 2).
- The branch code and migrations 090000–091100 must go live together, in this order: stop the indexer → apply the migrations → deploy indexer + web → restart the indexer.
- Main's code breaks against the new schema:
  - listings upsert → 42P10 after 090500;
  - `updatePrice`/`deactivate` by `listing_id` → **silent 0 rows** after 090500;
  - bid inserts → 23502 after 090700;
  - collections upsert → 42P10 after 090800.
- The branch code breaks against the old schema.
- Rollback means restoring the backup and the old code together (runbook §R). Never run the old indexer against the new schema.

- [x] Make a full backup before starting. The rehearsal used `marketplace_pre_phase2.dump` (pg_dump -Fc, public only, outside the repo). The runbook takes a fresh backup inside the window, after stopping the indexer, and verifies it.
- [x] Rehearse on **real data** (2026-11-07, local stack only):
  - restored the dump: 1 restore error, `profiles_id_fkey`, because the dump has no `auth.users`; handled locally with 8 placeholder auth users, details in SEC01_STATUS §3.9;
  - applied 090000–091100: **no preflight failure**;
  - counts are identical before and after, and every chain_id = 99801. Counts: activity 32, collection_bids 2, collections 1, contract_indexer_state 1, indexer_state 1, listings 1, nfts 7, nonces 158, profiles 8, token_bids 7, user_wallets 8.
  - The restored schema's catalog fingerprint is byte-identical to the committed baseline: no constraint-name drift.
- [x] Write M-1, M-2, M-4, M-6, M-7 as **new** files after 090600. Each is transactional (`lock_timeout` 5s), with a preflight that aborts without changing data, a postcondition, and a header. Each is re-runnable, and a re-run is a verified no-op.
  - `20261028090700_m1_bids_chain_id.sql` (208 lines). Includes the chain-scoped replacement of the two active-bid partial uniques (approved scope extension).
  - `20261028090800_m2_collections_chain_identity.sql` (270)
  - `20261028090900_m4_activity_chain_id_integer.sql` (127)
  - `20261028091000_m6_indexer_state_chain_unique.sql` (84)
  - `20261028091100_m7_relist_clears_buyer.sql` (259)
- [x] M-7 written here. RPC: `buyer_wallet = null` in `ON CONFLICT`. Indexer: `ListingsRepository.upsert` sends `buyer_wallet: null`.
- [x] Code that must ship in the **same deploy** (minimal; IDX-6 bid filters stay in Phase 3):
  - `apps/indexer/.../CollectionsRepository.ts` and `packages/database/.../collections.repo.ts`: `onConflict: "chain_id,contract_address"`;
  - `BidsRepository.insertCollectionBid/insertTokenBid`: `chain_id: env.chainId`;
  - `ListingsRepository.upsert`: `buyer_wallet: null`;
  - new mocked tests `BidsRepository.test.ts`, `CollectionsRepository.test.ts`.
- [x] Tests 18, 19 and 20:
  - `packages/database/tests/phase2_migrations.test.sql` (56) covers #18 and #19;
  - `packages/database/tests-realdata/phase2_roundtrip.test.sql` (19) covers #20, using `scripts/rehearsal/capture_counts.sql`;
  - the SEC-01 pgTAP suite needed a fixture-only change (`collections` parents on 2 more chains).
- [x] Full cycles:
  - empty baseline: pg_prove `Files=2, Tests=159, PASS`, vitest 22/22, 0 rows left;
  - real data: 159 PASS, round-trip 19 PASS, vitest 22/22.
- [x] Negative preflight tests: 10 cases, each aborts with no schema or data change.
- [x] Cutover probes on the migrated real-data DB: 18/18 as predicted.
  - Phase 1+2 indexer/web paths work, including the `collections!inner` embeds over the composite FK.
  - Main fails loudly: 42P10 on the collections and listings upserts, 23502 on bid inserts.
  - Main also has the known silent 0-row `updatePrice`.
- [x] Runbook `docs/PHASE2_RUNBOOK.md`: go/no-go, read-only pre-check (`phase2_precheck_readonly.sql`), backup and verification, indexer stop, per-file command, expected notices and verification query, fingerprint diff, deploy, restart, post-checks, failure handling, a **rehearsed** rollback, a staging dry-run checklist, measured locks and duration.
- [x] **Apply to production**: done by the operator. Per the operator (2026-11-07, Phase 3B kickoff), 090000–091100 are live. Not verified from this side, but the Phase 3B pre-check asserts it (`FINGERPRINT-OK` against `after.txt`).
- [x] Leave M-5 (RPCs with `p_chain_id`) for Phase 3.
- [x] Version the schema in the repository, partially.
  - The migrations and `scripts/rehearsal/catalog_fingerprint.{before,after}.txt` are tracked. The fingerprints describe the full public-schema catalog before and after.
  - `packages/database/baseline/` (the full DDL dump) is still gitignored.
- Typecheck and tests on the branch:
  - turbo typecheck (excluding database): green;
  - turbo test: shared 8, contracts 72, web 40 passed / 22 skipped, database 2, indexer 34 (31 before);
  - `validate:integration`: unchanged ((a), (c), (f) and #8 ×2 fail as known; (b) passes).
  - A direct `tsc` on the indexer (it has no typecheck script) shows the same pre-existing errors before and after the change, none in the edited files.

### Audit vs. code discrepancies found in Phase 2

- **Order.** Audit §8.1 says M-1 → M-2 → M-3 → M-4 → M-6 → M-7. As requested, the new files come after 090600, so the applied order is SEC-01 (incl. M-3) → M-1 → M-2 → M-4 → M-6 → M-7. M-1 and M-2 don't depend on SEC-01. This exact order is what was rehearsed.
- **collections has two address-only uniques**, the constraint `collections_contract_address_unique` *and* the standalone unique index `collections_contract_address_idx`. M-2 drops both, discovered from the catalog.
- **The nfts → collections FK is `ON UPDATE CASCADE ON DELETE SET DEFAULT`**, not mentioned in the audit. On a composite FK, `SET DEFAULT` would null `chain_id`, so M-2 recreates it as `ON DELETE SET DEFAULT (collection_address)` (PG15+), which preserves today's behavior.
- **The bid tables have chain-less partial uniques** (`idx_token_bids_unique_active`, `idx_collection_bids_unique_active`), not covered by M-1 in the audit. Without a fix, audit test #19 fails for the same bidder on two chains. Fixed in M-1 (approved).
- **Live bid counts:** the audit says "~5 bids / ≥3 token bids". The backup has 7 token bids and 2 collection bids. Audit test #19 says it "fails today for three of them", and that matches.
- **"Every one of these is safely reversible today" (§7) is not true as a plain restore.** `pg_restore --clean` cannot undo M-2. Rollback needs `scripts/rollback/phase2_rollback_prepare.sql` first (rehearsed). Rollback also drops realtime publication membership, which the runbook re-adds from the pre-check.
- **Floor-price triggers and the stats RPCs match collections by address only.** Once M-2 allows one address on two chains, they would update both chains' rows. This is M-5 (Phase 3); harmless while all data is on 99801.
- **`nfts_market_view`** still joins listings and bids without `chain_id` (the view part of DB-1). Not in any M-item; Phase 3/4.
- **`indexer_state.chain_id` stays `numeric`.** M-6 only adds the unique; converting it to integer is a possible follow-up.
- **CRLF in function bodies.** With `core.autocrlf=true` and no attribute, migrations checked out on Windows created functions whose bodies contain carriage returns. `.gitattributes` now pins migrations to LF; repository content is unchanged.
- **The backup is pg_dump 18.0** (archive 1.16), while the server is 17.6. pg_restore 17.11 read it in the rehearsal; the runbook asks for a client ≥ 17, and ≥ 18 is safer.
- **The indexer env default 11155111 (ADDR-3) is now a hard failure mode, not only a mislabel.** With the composite FKs, writes with the wrong chain fail with 23503. The runbook requires `CHAIN_ID=99801` explicitly; the fix is Phase 3.

## Phase 3: Indexer

- IDX-1: remove `incrementStats` from the `TokenBidAccepted` and `CollectionBidAccepted` handlers. Sale becomes the only source of volume.
- IDX-2/3: do not advance the cursor if there are errors, make it monotonic, add confirmation lag and rollback by `last_block_hash`.
- IDX-5/ABI-4: change `ContractAuthorized` to `LaunchpadAuthorized` and add handlers for `CollectionUnverified`, `CollectionRoyaltyUpdated`, `RoyaltyOverrideCleared`, and `Withdrawal`.
- Keep `CollectionRegistrationExecuted` and `RoyaltySourceUsed` unindexed.
- IDX-6/7: add `chain_id` to bid writes and filters, and make inserts idempotent with a unique constraint on the on-chain identity. Do not derive the remaining amount from the DB state.
- Apply M-5 together with the repository change, in a coordinated way.
- IDX-9: throw an error if `blockTimestamp` is missing.
- IDX-4 (moved from Phase 1; not on `fc85e2b`): carry wei as decimal strings through `CoreEventHandler`/`BidsEventHandler` and `ListingsRepository`/`BidsRepository`, with no `Number(price)`. Add test #12 (`1234567890123456789n` round-trip).
- ADDR-3: make `CHAIN_ID` mandatory and remove the fallbacks (`11155111` / `sepolia`).
- Do per-chunk checkpointing with streaming (IDX-8). It is P2, but essential if there is ever a backfill.
- Add a `prepare-deployment` that upserts `indexer_state` with `deployBlock - 1`.
- Run tests 9–16 and verify that `total_volume` still matches `getCollectionStats` (0.215 / 6).

### Phase 3A: indexer code fixes, no schema change

Branch `chore/production-readiness-phase3a`, created from `chore/production-readiness-phase2`. Nothing is merged to main.
- No new `.sql`, no RPC signature change.
- The indexer runs against the Phase 1+2 schema.
- Every test uses mocked repositories and providers.

- [x] 1. Indexer `typecheck` script; fix what it reveals.
  - `apps/indexer` had never been typechecked. It had 18 errors:
    - 16 came from `moduleResolution: node`: ox `.ts` sources were checked under `lib: ES2020`, and `exports` subpaths did not resolve.
    - 2 came from `packages/database/src/client.ts`.
  - Fixes:
    - indexer tsconfig: `module: ESNext`, `moduleResolution: bundler`. There is no emit step; the runtime is tsx/vitest.
    - `createAnonClient`/`createServiceClient` drop their unused `<T>` generic. This is type-only; no caller passed one.
  - `@marketplace/database` typecheck is now **green**. CI runs `turbo run typecheck` with no exclusion, and the "Database typecheck (known failing)" step is removed.
- [x] 2. IDX-4: wei is carried as bigint and leaves the indexer only as an exact decimal string.
  - `ListingsRepository.upsert/updatePrice` and `BidsRepository.insert*Bid` take `price: string` (into `numeric(78,0)`).
  - `CollectionsRepository.incrementStats(addr, volumeWei: bigint, sales)` sends `p_volume` as an exact ether decimal (`formatEther`, e.g. `"1.234567890123456789"`). The RPC signature `(text, numeric, integer)` is unchanged.
  - Helpers live in `src/utils/wei.ts`.
  - Test #12 (`handlers/WeiPrecision.test.ts`) runs real handlers and repos over a recording supabase fake (`src/test-utils/`). It sends `1234567890123456789n` and gets the identical string back in the listings, bids, activity and stats payloads.
  - A source guard fails if `Number(<price|amount|volume|wei>)` or `/ 1e18` reappears in handlers or repos.
  - `quantity` (uint32) and `expiresAt` (uint64 seconds) intentionally stay `Number`.
  - **Open (Phase 4):** PostgREST returns `numeric` columns as JSON numbers. A web read of `listings.price` can still round unless it selects `price::text`. The write side is exact now.
- [x] 3. IDX-1: `Sale` is the only source of `total_volume`/`total_sales`.
  - `incrementStats` is removed from `TokenBidAcceptedHandler` and `CollectionBidAcceptedHandler`. Their activity rows, bid deactivation and quantity updates, listing deactivation and owner updates are unchanged.
  - Replay safety (decision 2026-11-07):
    - `ActivityRepository.insert` now returns whether the `(tx_hash, log_index)` row was freshly inserted (`ON CONFLICT DO NOTHING RETURNING` via `.select("id")`).
    - `SaleHandler` increments stats only for a fresh row.
    - If the increment fails, `deleteByTxLog` removes the fresh row and the error is rethrown, so the retry counts the Sale once.
    - **Residual gap:** a crash between the two writes, or a failed compensating delete, undercounts by one Sale. Closing it needs an atomic sale+stats RPC (3B). Phase 7 reconciliation would detect it.
  - Tests (`handlers/BidAcceptance.test.ts`, real registry/handlers/repos):
    - Sale + TokenBidAccepted → exactly 1 increment;
    - a collection bid with 3 tokenIds (3 Sales + 1 CollectionBidAccepted) → 3 increments totalling `3 × price`, not 6;
    - a replayed Sale → no second increment;
    - a failed increment → compensating delete + rethrow, and the retry counts it once.
- [x] 4. IDX-2/IDX-3 (code part): a failed event no longer lets the cursor advance past it. Changes are in `IndexerOrchestrator`:
  - **Confirmation lag:** it only indexes up to `safeHead = head - CONFIRMATIONS`. New env `CONFIRMATIONS`: a non-negative integer, default 12, documented in the README and `.env.example`.
  - **Stop at first failure:** events are dispatched in order. The first handler error at block B stops the run, and no later event runs. Every cursor is saved at most at B-1, and the next run re-fetches from B (retry). With no failure, cursors go to `safeHead`.
  - **Monotonic cursors:**
    - the global and per-collection cursors are written only when they increase;
    - `IndexerStateRepository.updateLastBlock` also filters `last_block IS NULL OR last_block < n`, so a stale writer cannot rewind it.
  - **Replay window on retry:** the events of block B that ran before the failing one. Activity and stats are idempotent (task 3); bid inserts are not (IDX-7, 3B).
  - The failure log carries block/tx/logIndex and a consecutive-failed-runs counter (Phase 7 alerting can key on it).
  - Tests (`services/IndexerOrchestrator.test.ts`):
    - #9: failure → cursor at B-1, later events not run; a failure in the first block → no write;
    - retry on the next run;
    - #10: lower head → no rewind; up/down heads → monotonic;
    - lag 200−12 → 188;
    - collection cursors clamped (behind, ahead, not-yet-started);
    - the DB-side guard.
  - **Not done (3B):** `last_block_hash` and reorg rollback.
- [x] 5. IDX-5/ABI-4: new listeners.
  - **The indexer now decodes with the generated events ABIs** (`@marketplace/contracts/abis/generated/events`), not the hand-pasted ones.
    - The hand-pasted Core ABI lacks `CollectionUnverified` and `RoyaltyOverrideCleared`, and `BatchEventFetcher` silently skips undecodable logs, so new handlers alone would never fire.
    - All previously configured event signatures are identical in both ABIs; this was checked before switching.
    - The web keeps its hand-pasted ABIs until Phase 4.
  - Config: `ContractAuthorized` → `LaunchpadAuthorized`. Added `CollectionUnverified`, `CollectionRoyaltyUpdated`, `RoyaltyOverrideCleared` and `Withdrawal` (core) and `Withdrawal` (bids). `ContractAuthorizedHandler` is deleted.
  - Handlers:
    - `CollectionUnverified`: `is_verified=false` plus activity.
    - `CollectionRoyaltyUpdated`: `collections.royalty_fee` (bps) plus activity (`to`=receiver).
    - `RoyaltyOverrideCleared`: **activity only**. On-chain only the override flag flips; `royaltyFee` storage is unchanged.
    - `LaunchpadAuthorized`: activity `LAUNCHPAD_AUTHORIZED`/`LAUNCHPAD_DEAUTHORIZED`, so the boolean no longer lives in `price`.
    - `Withdrawal` (Core and Bids): activity `WITHDRAWAL`, with `to`=account and `price`=exact wei.
  - `CollectionsRepository.updateVerificationStatus` and the new `updateRoyaltyFee` are chain-scoped (`chain_id` + `contract_address`). Before, verification updated by address only.
  - `CollectionRegistrationExecuted` and `RoyaltySourceUsed` stay unindexed. They are documented in the config and guarded by `handlers/EventCoverage.test.ts`.
  - Tests:
    - #16 (verify → unverify, chain-scoped);
    - each new handler's payload;
    - a decode test (encoded logs → real `BatchEventFetcher` with the real config → handlers exist);
    - the IDX-12 guard;
    - config ↔ generated ABI.
  - `validate:integration` (a) and (b), i.e. test #7, are **green**.
  - New columns these handlers would need are **not invented**; they are handed to 3B: `collections.royalty_overridden`, `collections.royalty_receiver`.
- [x] 6. IDX-9: a missing `blockTimestamp` no longer becomes 0, i.e. 1970.
  - **Chosen fallback:** `IRpcProvider.getBlockTimestamp(blockNumber)` (viem `getBlock`), in a bounded per-block cache (1024 entries). It throws if that also fails or returns 0.
  - **Why not just throw:** with task 4's cursor semantics, an RPC that never includes the field would halt the indexer forever. The canonical value is one cached `eth_getBlockByNumber` per distinct block away.
  - The log's own non-zero `blockTimestamp` is still preferred, at zero extra cost on Elysium.
  - A throw fails the fetch, so the cursor does not move and the next run retries.
  - Test #13 (`fetchers/BlockTimestamp.test.ts`):
    - the log value is used when present;
    - the fallback makes 1 call per distinct block;
    - an RPC error throws;
    - a 0 timestamp throws.
- [x] 7. ADDR-3: `CHAIN_ID` is required.
  - `env.ts` now throws when `CHAIN_ID` is missing, empty, non-integer or not in `SUPPORTED_CHAIN_IDS`; the 11155111 default is deleted.
  - Fallbacks removed:
    - `chains.ts`: `getViemChain` throws on an unknown id (the `?? sepolia` is deleted);
    - **a third fallback the audit missed:** `ViemRpcProvider.ts:26` had `config.chainId ?? 11155111`. `chainId` is now a required constructor field, and every caller already passed it.
  - `.env.example` now shows `CHAIN_ID=99801` with a "required" note; the README env table lists it.
  - Startup `getChainId()` check in `index.ts`: kept.
  - DEFAULT_CHAIN_ID: shared and contracts both stay 99801, and the indexer no longer has a default. `@marketplace/contracts` does not depend on `@marketplace/shared`, so no cross-package unit test was added; validate (f) is the guard.
  - Tests (`config/env.test.ts`, with `dotenv/config` mocked):
    - `CHAIN_ID` missing, empty, non-numeric, unsupported or fractional → throws; 99801 and 11155111 → accepted;
    - `CONFIRMATIONS` default 12, 0 accepted, -1/1.5/abc rejected;
    - `getViemChain(1)` throws.
  - **validate (c) and (f) are green.**
- [x] 8. IDX-8: per-chunk checkpointing and streaming.
  - New `BatchEventFetcher.fetchChunk(requests, from, to)`: one range, sorted, no further chunking. `fetchEventsForContracts` is kept, and nothing in the indexer calls it any more.
  - The orchestrator splits `[minFromBlock, safeHead]` into `BATCH_SIZE` chunks. For each chunk it fetches → processes in order → checkpoints to `chunk.to`, using the same clamp as task 4.
    - A handler failure at B checkpoints B-1 and ends the run.
    - A fetch failure ends the run; earlier chunks stay checkpointed.
    - `stop()` is honored between chunks.
    - Only one chunk of events is in memory at a time.
  - Cursor semantics are unchanged from task 4; the checkpoint is just written more often.
  - `BATCH_SIZE` is now validated as a positive integer. A 0 would loop forever in `BlockRangeUtil.chunk`.
  - Tests:
    - a checkpoint per chunk;
    - call-order streaming (fetch → dispatch → checkpoint per chunk);
    - a handler failure in chunk 2 (keeps chunk 1, holds at B-1, chunk 3 never fetched);
    - a fetch failure in chunk 2 (cursor at chunk 1's end; the next run resumes at chunk 2);
    - stop between chunks;
    - `fetchChunk` does not re-chunk and sorts;
    - `BATCH_SIZE` 0/-5/abc rejected.
- [x] 9. Test #11, replay idempotency at handler level (`handlers/ReplayIdempotency.test.ts`).
  - Setup: the real registry, handlers and repos over `test-utils/memoryDb.ts`, an in-memory model of the Phase 1+2 unique keys and the additive `increment_collection_stats`.
  - One realistic range is run twice. It contains:
    - registration and mints;
    - list, update, cancel;
    - a buy;
    - a token-bid accept (Sale + TokenBidAccepted);
    - a 2-token collection-bid accept;
    - verify, unverify, royalty, override cleared, launchpad, 2 withdrawals.
  - **Proven:** `activity`, `listings`, `nfts` and `collections` are byte-identical after a full replay and after a partial replay (from block B, the task-4 retry case). `total_sales = 4` and `total_volume` is the exact wei sum.
  - **Deferred to 3B, encoded as `it.fails` markers.** They pass today *because* the defect exists, and will flip red when 3B fixes it. A plain precondition test pins the state they start from.
    - `token_bids`/`collection_bids` grow on replay (plain inserts, no on-chain identity unique: IDX-7).
    - Test #14: replaying a `CollectionBidAccepted` decrements the remaining quantity again, because it is derived from the DB row (IDX-7).
    - Test #15 (cross-chain bid isolation, IDX-6) is an `it.todo`.

**Phase 3A results (2026-11-07, local only).**
- Typecheck: `turbo run typecheck` (all 5 packages, no exclusions) is green.
- Tests:
  - shared 8, contracts 72, web 40 passed / 22 skipped, database 2;
  - **indexer 95 passed + 1 todo** (34 before).
- `validate:integration --chain-id 99801`:
  - indexer suite 5 passed, 1 skipped (live (d));
  - call-shape 36/38. The only failures are #8 `acceptTokenBid`/`acceptCollectionBid` (Phase 4).
- `generate:abis:check` is up to date. `forge test` 336/336.
- Known-failing table delta:
  - **turned green:** (a) ContractAuthorized, (c) CHAIN_ID required, (f) defaults agree, and `@marketplace/database` typecheck;
  - **still failing:** #8 ×2 (ABI-1, Phase 4).
  - The `integration-contract-tests` CI job stays `continue-on-error` because of #8.

### Audit vs. code discrepancies found in Phase 3A

- **IDX-5 is more than "five new handler classes" (§5 verdict).** The indexer decoded with the hand-pasted `MarketplaceCoreABI`, which has no `CollectionUnverified`, `RoyaltyOverrideCleared`, `RoyaltySourceUsed`, `CollectionRegistrationExecuted`, `RouterUpdated` or `BidsContractUpdated`. `BatchEventFetcher` silently skips logs it cannot decode, so new handlers would never have fired. The indexer had to switch to the generated events ABIs (task 5).
- **ADDR-3 missed a third Sepolia fallback:** `ViemRpcProvider.ts:26` `config.chainId ?? 11155111`. `.env.example` also shipped `CHAIN_ID=11155111`.
- **"No indexer_state row → logs and returns forever" (§8) is wrong.** `getState` uses `.single()`, which errors, so every iteration throws and logs a fatal loop error. Behavior is unchanged in 3A; seeding is prepare-deployment (3B).
- **`collections` verification updates were chain-less** (`updateVerificationStatus` filtered by address only), even though collections are `(chain_id, contract_address)` since M-2. Fixed for verify, unverify and the new royalty update. `updateIndexerBlock` is also chain-less, but it is unused.
- **The indexer was never typechecked** (18 errors, see task 1). Phase 0 had noted the missing script but not the count.
- **The Dockerfile is broken.** It runs `pnpm --filter … build` for contracts/shared/database/indexer, but none of them has a `build` script, and the indexer runs through tsx. Not fixed (not in 3A scope).
- **IDX-1 line numbers:** the Sale increment is at `CoreEventHandler.ts:362`, not :363. The other two are as stated.
- **Activity is used for replay gating.** The audit treats activity idempotency as a given (§5.2). 3A now relies on it for stats too, via `ON CONFLICT DO NOTHING RETURNING`.
- **`BATCH_SIZE=0` looped forever** in `BlockRangeUtil.chunk`. Not in the audit; now validated.

### Handed to Phase 3B (schema-coupled; not done in 3A)

- IDX-6: chain_id in bid filters, and getActiveCollectionBid that does not throw across chains. Test #15.
- IDX-7: a unique constraint on the on-chain bid identity, idempotent bid writes, and remaining quantity not derived from DB state. Test #14. Flip the `it.fails` markers in `ReplayIdempotency.test.ts`.
- M-5: `p_chain_id` on the stats, floor and cleanup RPCs, together with the repository change. Ideally also an **atomic sale+stats RPC keyed on (tx_hash, log_index)**, to close the at-most-once gap from task 3.
- IDX-3 remainder: `last_block_hash` and reorg rollback.
- prepare-deployment / DB-7: seed `indexer_state` at `deployBlock - 1`.
- `contract_indexer_state.chain_id NOT NULL`.
- `indexer_state.chain_id` numeric → integer.
- `nfts_market_view` chain join.
- Columns IDX-5 handlers would need (not invented in 3A): `collections.royalty_overridden` and `collections.royalty_receiver`, written by `CollectionRoyaltyUpdated` / `RoyaltyOverrideCleared`.
- Phase 4 (read side): select `price::text` (PostgREST returns `numeric` as a JSON number).

### Phase 3B: schema-coupled indexer work (rehearsed locally, NOT applied)

Branch `chore/production-readiness-phase3b`, created from `chore/production-readiness-phase3a`. Nothing is merged to main.
- **Nothing was applied to any real database.** Applying it is your manual step: `docs/PHASE3B_RUNBOOK.md`.
- Per the operator, 090000–091100 (Phase 2) are already live. The new migrations come after 091100.
- **Local stack:**
  - Supabase CLI 2.119.0, project `sec01-local` in a scratch dir outside the repo, image 17.11.0.002, pgTAP 1.3.3;
  - only db, auth, rest and kong ran;
  - no `.env` was read and no remote database was contacted;
  - env vars came from `supabase status -o env` inside each command.

- [x] 0. Verify the 3A assumption on a real PostgREST.
  - New gated suite `apps/indexer/src/__localdb__/*.localdb.test.ts`, run with `pnpm --filter @marketplace/indexer test:localdb`. It needs `INDEXER_TEST_SUPABASE_URL`/`…_SERVICE_ROLE_KEY`, refuses non-local URLs and aliases `dotenv/config` away.
  - **Result: the assumption holds.**
    - `ActivityRepository.insert` returns `true` and then `false` for a replayed `(tx_hash, log_index)`, with 1 row.
    - A mixed `upsert([dup, new], {ignoreDuplicates})` returns only the new row.
    - No fix was needed.
- [x] 1. Atomic sale + stats: `20261028091200_sale_activity_stats_rpc.sql` (183 lines).
  - `indexer_record_sale(chain, collection, token, from, to, price_wei text, tx_hash, log_index, created_at, source)` is **SECURITY DEFINER** with `search_path = public, pg_temp` and `public.`-qualified names. EXECUTE is revoked from public/anon/authenticated and granted to service_role only.
  - One transaction: `INSERT activity … ON CONFLICT (tx_hash, log_index) DO NOTHING`, and only for a fresh row, `total_volume += wei * 1e-18` (exact: multiplication, never division) and `total_sales += 1` on `(chain_id, contract_address)`.
  - It validates canonical inputs (22023 otherwise).
  - Code changes:
    - `SaleHandler` → `ActivityRepository.recordSale`;
    - removed: the compensating `deleteByTxLog`, `CollectionsRepository.incrementStats` and `weiToEtherDecimal`.
  - This closes the 3A at-most-once gap.
- [x] 2. M-5: `20261028091300_m5_chain_scoped_rpcs.sql` (419 lines).
  - The chain-less `increment_collection_stats`, `get_collection_stats`, `update_collection_floor_price`, `get_top_collections` and `cleanup_expired_{listings,token_bids,collection_bids}` are **dropped** and re-created with `p_chain_id integer` first. Every WHERE, including the listings/nfts subqueries, is on `(chain_id, address)`.
  - All stay SECURITY INVOKER with a pinned search_path, **service_role only** (decision 2026-11-07, including the two read RPCs).
  - Both floor-price trigger functions recompute `(NEW.chain_id, NEW.collection_address)` only, with the logic inlined.
  - The preflight aborts on catalog dependents or `pg_cron` jobs that use the old signatures.
  - Callers: the indexer has none left; the duplicate `packages/database` `collections.repo.ts incrementStats(chainId, …, volume: string)`; the web types only.
  - `update_collection_floor_price` is **not** called from handlers: the listing triggers already maintain the floor (see discrepancies).
- [x] 3. IDX-6/IDX-7: `20261028091400_idx7_bid_event_identity.sql` (429 lines). Design decision 2026-11-07: event ledger plus RPCs, not on-chain reads.
  - Both bid tables gain `tx_hash`, `log_index` and `block_number` of the placement event, with `UNIQUE (chain_id, tx_hash, log_index)`. CHECKs require all three or none, and a canonical hash. Legacy rows stay NULL and count as "oldest".
  - `collection_bids.placed_quantity` is backfilled with the current quantity: 2/2 rows in the backup.
  - `collection_bid_fills` ledger, PK `(chain_id, tx_hash, log_index)`, FK bid_id ON DELETE CASCADE. RLS is on with no policy, and no privilege for public/anon/authenticated.
  - RPCs (INVOKER, service_role only): `indexer_apply_token_bid_event(placed|closed)` and `indexer_apply_collection_bid_event(placed|cancelled|filled)`.
    - Closing a slot only touches bids placed **before** the event, so a replayed cancel never closes a later bid.
    - Placements and fills are `ON CONFLICT DO NOTHING`.
    - Remaining = `placed_quantity − Σ fills`. Nothing reads the previous quantity.
  - `BidsRepository` is rewritten around the RPCs with an explicit chain id. `getActiveCollectionBid`, `updateCollectionBidQuantity` and the chain-less filters are gone.
  - Tests:
    - the 3A `it.fails` markers are now plain passing tests;
    - #14 (event-derived quantity, partial then full fill, replay);
    - #15 (cross-chain isolation, unit and localdb);
    - out-of-order cancel;
    - #11 for bids (memoryDb, plus real Postgres through the real handlers: full and partial replay give identical rows).
- [x] 4. DB-6/DB-7 and types:
  - `20261028091500_indexer_state_types.sql` (176 lines):
    - `contract_indexer_state.chain_id` NOT NULL + CHECK > 0;
    - **PK `(contract_address)` → `(chain_id, contract_address)`** (decision 2026-11-07), and the redundant composite unique is dropped;
    - `indexer_state.chain_id` numeric → integer;
    - `indexer_state.last_block_hash` for task 6.
  - Code paths: `getState`/`updateLastBlock`/`getContractState` filter by a JS number and work for both types; the upsert target `contract_address,chain_id` still infers the new PK. The web types for both tables were wrong (no `chain_id`, a non-existent `last_updated`) and are corrected.
  - `20261028091600_market_view_chain_join.sql` (109 lines): `nfts_market_view` joins listings, token_bids and collection_bids on `chain_id = n.chain_id`. Same columns (pinned by the preflight); `security_invoker` and the grants are kept.
  - Royalty columns (`royalty_overridden`, `royalty_receiver`): **left open**. The handlers work without them; whether the UI models the ERC-2981 override is a Phase 4 decision.
- [x] 5. `prepare-deployment` (audit §8 step 8): `pnpm --filter @marketplace/indexer prepare-deployment -- --network <net> [--deploy-block n] [--force] [--dry-run]`.
  - It requires `deployments/<net>.json` to pass rules 1–4, via the new static-only `checkRecordStatic` export of `@marketplace/contracts/deployment-records`. The record's chainId must equal `CHAIN_ID`.
  - deployBlock comes from the record, or `--deploy-block` (the record has none today); both must agree.
  - It upserts `indexer_state (last_block = deployBlock − 1, last_block_hash = NULL)` and refuses to lower without `--force`. It seeds `contract_indexer_state` at `indexer_block − 1` only where missing.
  - Tests: 21 offline tests (every refusal, force, idempotence, dry-run, argv), localdb with the real repositories, and the real CLI against the stack (refusal paths, exit 1).
- [x] 6. IDX-3 hash part: **detect and halt** (decision 2026-11-07).
  - Each checkpoint writes `last_block` + `last_block_hash` in one monotonic UPDATE, via the new `IRpcProvider.getBlockHash`.
  - Each run first compares the stored hash with the canonical one. On a mismatch it logs fatal `REORG_DETECTED` and fetches, dispatches and writes nothing until an operator acts.
  - A NULL hash is accepted. A failed hash read fails the run without moving the cursor.
  - **Automatic rollback is not implemented.** activity and the last-writer state have no `block_number`, so orphaned writes cannot be undone safely. The design and the interim operator procedure are in `docs/REORG_ROLLBACK_DESIGN.md`.
- [x] Rehearsal tooling:
  - `scripts/rollback/phase3b_down.sql` (393 lines, generated from the baseline): back to the **exact** post-Phase-2 catalog, with byte-exact CRLF function bodies and original ACL order, keeping rows;
  - `scripts/rehearsal/phase3b_precheck_readonly.sql` (114 lines): all 0 on the backup, and it detects injected bad state;
  - `scripts/rehearsal/catalog_fingerprint.after_phase3b.txt`;
  - `.gitattributes` pins rollback/rehearsal SQL to LF.
- [x] `docs/PHASE3B_RUNBOOK.md`.
- [ ] **Apply to production** (you, by hand, after the staging dry run).

**Phase 3B results (2026-11-07, local only).**
- **Empty baseline → 090000–091600:**
  - every file exits 0; a second pass is a no-op (identical fingerprint);
  - pgTAP `Files=3, Tests=237, PASS` (103 SEC-01 + 56 Phase 2 + **78 Phase 3B**, `tests/phase3b_migrations.test.sql`);
  - vitest RLS 22/22, indexer localdb 8/8, 0 rows left.
- **Restored `marketplace_pre_phase2.dump` → 090000–091600:**
  - no preflight failure;
  - fingerprint == `after_phase3b.txt` (identical to the empty baseline);
  - all 12 relation counts identical; stats `99801:0.215/6` and cursor `99801:16454480` unchanged;
  - pgTAP 237 PASS, round-trip 19/19, vitest 22/22, localdb 8/8.
- **Rollback A** (`phase3b_down.sql`), on both: exactly `catalog_fingerprint.after.txt` with identical counts; a re-apply gives exactly `after_phase3b.txt`. Repeated down → refused by the guard. The SEC-01 (103) and Phase 2 (56) suites pass on the rolled-back state.
- **Rollback B** (restore a post-Phase-2 dump): `phase2_rollback_prepare.sql` alone refuses on 3B (`collection_bid_fills` remains). down → prepare → restore works, **but only with the default-privileges step** (see discrepancies); with it, the ACLs are semantically identical and the counts identical.
- **Negative preflights:** 12 cases, each aborts with the schema fingerprint and counts unchanged:
  - 091300 with a catalog dependent, and with a pg_cron job;
  - 091400 with a fills table lacking the PK, and with a wrong-type column;
  - 091500 with a NULL chain, a fractional chain, and a chain > int4;
  - 091600 with changed view columns;
  - 091200/091300/091400/091500 run before their Phase 2 prerequisites.
- **Cutover probes (supabase-js):** the pre-3B `increment_collection_stats(text,…)` gets **PGRST202** after 3B; `indexer_record_sale` gets **PGRST202** after the down.
- **Locks:** 091200/091300 take none on tables; 091400 takes ACCESS EXCLUSIVE on the bid tables plus fills; 091500 on the cursor tables; 091600 on the view. Each file takes ≤ 0.38 s locally.
- **Typecheck and tests:**
  - turbo typecheck green (5/5);
  - turbo test: shared 8, contracts 72, web 40 + 22 skipped, database 2, **indexer 128** (95 + 1 todo before; no todo left);
  - `validate:integration`: only #8 ×2 fail (ABI-1, Phase 4);
  - `forge test` 336/336; `generate:abis:check` up to date.

### Audit vs. code discrepancies found in Phase 3B

- **The floor price is already maintained, by two duplicate triggers.** Audit §5.3 says "update_collection_floor_price exists but no handler calls it". In fact `auto_update_floor_price` (→ `trigger_update_floor_price` → `update_collection_floor_price`) and `trg_update_floor_price` (→ `update_floor_price`) both recompute it on every listings write, by address only.
  - Fixed: both are chain-scoped now. Dropping the old `update_collection_floor_price(text)` without replacing the trigger body would have broken **every** listing write.
  - Handler calls are not added. The duplicate triggers are left; that is open.
- **`get_collection_stats` and `get_top_collections` never worked on real data.** They fail with 42804 on any non-empty row: `total_sales` is numeric and `floor_price` is numeric(78,0), while the declared types are integer and text. The new versions declare the real types, with floor as exact text.
- **The web calls none of the M-5 functions**, only type declarations, so the "coordinated deploy" is indexer-only. The web's only stats RPC, `get_top_collections_volume_24h`, is chain-less and not in M-5. It also filters `'TOKEN BID ACCEPTED'`/`'COLLECTION BID ACCEPTED'` with spaces, which the indexer never writes; if the names matched, it would double-count with SALE. Open (Phase 4).
- **`contract_indexer_state` PK was `(contract_address)` alone.** Audit §5.2 ("composite unique exists, not a bug") misses that the PK blocks the same address on two chains. Fixed in 091500.
- **There is no on-chain bid id.** The audit's "unique constraint on the on-chain bid identity" is implemented as the identity of the **placement event** `(chain_id, tx_hash, log_index)`, plus an event-keyed fill ledger. The slot (collection, [token,] bidder) is not unique historically: bid rows keep history.
- **Restoring a post-SEC-01 dump into Supabase re-opens the trust boundary.** Not in the audit. Found in the rollback-B rehearsal.
  - `pg_dump` emits GRANTs relative to the owner default and never REVOKEs. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT ALL … TO anon, authenticated` then gives every restored table ALL, and every function (incl. `sec01_save_listing_batch`) EXECUTE, for anon/authenticated.
  - The runbook suspends those defaults around `pg_restore`; this was rehearsed.
  - Phase 2's own rollback was unaffected: its pre-SEC-01 dump was permissive anyway.
  - Any future restore-based rollback after SEC-01 needs the same step.
- **The live function bodies are CRLF.** The baseline dump is CRLF, and the fingerprints are md5s of it. Git Bash `grep` strips CRs, so a scratch baseline made with `grep -v` differs in md5 for 9+ functions. The rehearsal rebuilt it byte-preserving; `phase3b_down.sql` recreates CRLF bodies from LF text. This is tooling only, but the rollback depends on it.
- **The deployment record has no `deployBlock`** (already known from Phase 0), so `prepare-deployment` takes `--deploy-block`. It will prefer a record field once `DeploymentConfig.sol` writes one (Phase 6).
- **Docs vs reality:** the Phase 2 sections said "Nothing has been applied to production"; per the operator, 090000–091100 are now live. The plan and SEC01_STATUS are updated; this was not verified by me, since I connect to no remote database. The 3B runbook's pre-check asserts it, as `FINGERPRINT-OK` against `after.txt`.
- **IDX-3:** the audit's "roll back when the stored hash no longer matches" is not safely implementable on this schema (see `docs/REORG_ROLLBACK_DESIGN.md`). Detection and halt are implemented.

### Still open after Phase 3B

- **Phase 4:**
  - bid acceptance arity (ABI-1, #8 ×2);
  - `chainGuard` integration;
  - UI handling of 23503 (`listings_nft_fk`);
  - web bid/listing/collection reads by chain (DB-1/DB-9 web side);
  - `price::text` reads;
  - `get_top_collections_volume_24h`;
  - royalty columns / ERC-2981 override modelling.
- **Phase 5/6:**
  - the Anvil rehearsal (test 21);
  - `DeploymentConfig.sol` writing `deployBlock`/`verifiedAt`;
  - running `prepare-deployment` for the new deployment.
- **Ops / Phase 7:**
  - automatic reorg rollback (design in docs; needs `activity.block_number`);
  - a hash for collection cursors;
  - the duplicate floor triggers;
  - chain-less `expire_stale_records()`;
  - re-creating any pg_cron job with `p_chain_id`;
  - the reconciliation job (`total_volume` vs `getCollectionStats`);
  - legacy bid rows have NULL event identity;
  - the broken indexer Dockerfile (from 3A).

## Phase 4: Frontend

Branch `chore/production-readiness-phase4`, created from `chore/production-readiness-phase3b`. Nothing is merged to main.
- **No migration and no DB change.** Only local stacks were used, no `.env` was read and nothing was broadcast.
- **Deploy coupling:** every column the web reads exists in the baseline or Phase 2 (live). The Phase 4 web therefore runs against the live schema with or without 3B applied. It no longer calls `get_top_collections_volume_24h`.

- [x] 1. ABI-1: generated ABIs and exact bid acceptance.
  - `packages/contracts/src/abis/web.ts`: `MarketplaceRouterAbi` = the generated router ABI plus every Core/Bids error, deduped by signature. Errors bubble through the router, so viem can only name them if they are in the ABI the call uses. `apps/web/lib/abi.ts` re-exports this bundle; the import names are kept.
  - The typed generated ABI already rejects the old 3-arg calls **at compile time**.
  - `lib/bidAcceptance.ts` holds the quote, in bigint only. It mirrors `Core.executeSaleFromBid` (fee = `price*marketplaceFee/10000`, floor) and `Core._getRoyalty`:
    - override → `royaltyFee` from `collections()`;
    - otherwise ERC-2981, with Core's exact filters: `supportsInterface` returns exactly 1 word equal to 1, `royaltyInfo` returns exactly 2 words, the address word is clean, the receiver is ≠ 0 and the amount is ≤ 20%;
    - otherwise the stored fallback.
  - Collection bids sum the fee and royalty **per token**.
  - Before the wallet prompt the quote refuses when:
    - the on-chain bid ≠ the price shown;
    - the bid has vanished or expired;
    - there is not enough quantity;
    - fee + royalty > price;
    - a value is out of uint128 range.
  - **Slippage (decision 2026-11-08: none).** `minPrice` = the price shown and `minSellerProceeds` = the proceeds shown. Both come from `applySlippage(x, bps)`, and `bps` comes only from `hooks/useSlippageBps.ts` (0n). A future selector changes only that hook.
  - **UI:** "Accept bid" is now quote → `AcceptBidConfirm` (bid price, marketplace fee %, royalty and its source, *You receive*) → sign exactly that quote. Before, the UI showed no proceeds at all.
  - **Known divergence (fail-closed):** on-chain ERC-2981 calls are capped at 50k gas; the quote's are not. If on-chain falls back to a larger royalty, the tx reverts with `SellerProceedsTooLow`. If smaller, the seller gets more than shown.
  - Test #8 rows now carry 5 args. A new **arity guard** parses each call site's `args: [...]` literal and requires the table row to have the same count; a non-literal `args` fails. 7 rows were added for the quote's reads. `integration-contract-tests` is now **blocking**.
- [x] 2. ADDR-2.
  - `getContractAddresses(chainId)` returns `undefined` for an unknown chain: no fallback, no default argument. `requireContractAddresses` throws, and the indexer uses it.
  - `useContractAddresses(chainId)` requires a chain.
  - The `NetworkStatus` banner appears when the wallet is on another chain (unsupported, or Sepolia while the data is Elysium) and offers a switch button. Writes are refused until the wallet switches.
- [x] 3. chainGuard and chain-scoped exact reads.
  - **One chain.** `DATA_CHAIN_ID` (the validated `DEFAULT_CHAIN_ID`) is used for every page read, pagination call, realtime subscription and write. Services take a required `chainId` and reject unsupported ones.
  - **Writes.** `useWriteGuard(chainId)` reads the wallet chain **at call time** (`getConnection`) and returns that chain's addresses, or throws a `ChainGuardError`. Every write hook and direct write uses it and pins `chainId`. The hooks that resolved addresses from the wallet chain (launchpad, register, mint, the marketplace info reads) now take the data chain.
  - **Reads.** chain_id filters were added to the token/collection bids (NFT detail, top-bid maps, user page, collections list, collection page), activity (NFT detail), nfts search, avatar options and `ColInfo`.
  - **Realtime.** `useRealtimeTable` requires `chainId` and drops rows that do not carry it. INSERT/UPDATE rows are **re-read** by `(id, chain_id)` through the text-cast column lists.
  - **Wei as text.** `lib/supabase/columns.ts` selects `price::text`, `floor_price::text` and `total_volume::text`. There is no `select("*")` on listings, bids or collections. `lib/wei.ts` formats, compares, sums and parses in bigint and decimal strings. Every `Number(x)/1e18` and `Math.floor(Number(x)*1e18)` is gone.
  - **24h top collections.** It reads chain-filtered `SALE` activity for the last 24h and aggregates in bigint (no migration). The RPC is now unused.
  - Tests:
    - a recording Supabase fake runs the real services and asserts every market-table query is chain-scoped (mutation-checked);
    - a static guard requires every wei-table select to cast its amounts and avoid `*` (mutation-checked);
    - the real write hooks, with wagmi mocked, never reach `writeContractAsync` when the wallet is disconnected, on Sepolia or on an unsupported chain.
- [x] 4. 23503 `listings_nft_fk`.
  - `saveBatchListingToDB` **returns** `{ success: false, reason: "not_indexed" }` on exactly that FK. It returns rather than throws because Next redacts thrown server-action messages. The error shape was captured from the local stack.
  - `UserListCard` keeps the optimistic UI and does **not** call `failListingsByTxHash`. After the tx confirms, the toast says "Listed on-chain. Waiting for the indexer…".
  - It then retries the idempotent RPC at 3/6/12/24 s and ends with "Listed!" or "It will appear automatically once indexed".
  - Any other 23503 or DB error stays a generic failure.
- [x] 5. Custom errors.
  - `lib/contractErrors.ts`: `CONTRACT_ERROR_MESSAGES` is a `Record` over the **union of error names of all 5 generated ABIs**, so a new contract error fails the typecheck.
  - It decodes through the router bundle and falls back to decoding raw revert data against every generated error.
  - It covers chain guard, quote refusals, wallet rejection and insufficient funds.
  - Every write flow shows the message, on the tx toast when there is a hash and inline/alert otherwise. Estimate-time reverts used to be console-only.
- [x] 6. Supabase types (DB-8).
  - `apps/web/lib/supabase/types.ts` is **generated** from a local stack (baseline + 090000–091600, catalog fingerprint == `after_phase3b.txt`) and formatted with pinned `prettier@3.3.3`. It is the single canonical file; the web is the only typed consumer.
  - The new `pnpm --filter @marketplace/database gen:types:local -- --workdir <local project>` (or a localhost `--db-url`; other hosts are refused; `--check` diffs) replaces the dead `generate-types` and web `update-types` scripts.
  - **Done before 3c:** typed explicit column lists need the real columns.
- [x] 7. Tests: listed under each task above (`lib/*.test.ts`, `hooks/writeGuard.test.ts`, `services/*.test.ts`, `actions/listings/createBatch.test.ts`, `packages/contracts/src/abis/web.test.ts`, #8 arity guard).
- [x] 8. The hand-pasted ABIs are deleted (`marketplace`, `marketplace-core`, `marketplace-bids`, `launchpad`, `micoleccion`, `nft`, `mock-nft` `*.abi.ts`), after a grep showed 0 importers. `@marketplace/contracts/abis` re-exports only generated ABIs.

**Phase 4 results (2026-11-08, local only).**
- `turbo run typecheck`: 5/5 green.
- `turbo run test`:
  - shared 8;
  - contracts 76 (72 before);
  - database 2;
  - indexer 128;
  - **web 98 + 22 skipped** (40 + 22 before).
- `validate:integration --chain-id 99801`:
  - indexer suite 5 passed + 1 skipped (live (d));
  - **#8 47/47** (36/38 before).
  - **Nothing known-failing remains.**
- `generate:abis:check` up to date. `forge test` 336/336.
- On the local stack (stopped afterwards; 0 rows left):
  - RLS vitest 22/22;
  - PostgREST probe: `price` → `1234567890123456800`, `price::text` → `"1234567890123456789"`, including embedded selects.

### Audit vs. code discrepancies found in Phase 4

- **DB-9 is outdated.** "listings is never chain-filtered in any of its 8 query sites" stopped being true in Phase 1: all listing reads were already scoped. `nft.service.ts:49` and the collection page were scoped too. What was really unscoped: every bid read (7 sites), activity at `nft.service:51`, nfts search, `ColInfo`, and the 24h RPC.
- **ABI-1 is wider than an arity fix.** The UI never displayed seller proceeds, so "minSellerProceeds = proceeds shown" needed a new confirmation step. `Bids.acceptTokenBid` also re-reads the **current** marketplace fee; it is not snapshotted like listings.
- **ABI-6 "27 custom errors".** There are 70 distinct custom errors across router/Core/Bids/LaunchPad/Hyperc. 27 was the number missing from the hand-pasted ABIs. Separately, the router ABI declares none of the Core/Bids errors, so even the generated router ABI alone could not name `SellerProceedsTooLow`.
- **DB-8.**
  - "lines 263-273 declare composite FKs … that the live schema does not have" is wrong: the baseline has `listings_nft_fk (collection_address, token_id, chain_id) → nfts`.
  - The hand-maintained types were also missing `listings.status`/`source`, `collections.banner_url`, `user_wallets`, the 3B tables and columns, and `sec01_save_listing_batch`.
- **"ColInfo shows raw total_volume" is not a bug.** `collections.total_volume` is ether-denominated (the indexer adds `wei*1e-18`). It is now exact text.
- **Bugs found on the way (fixed):**
  - the buy `value` was `BigInt(rounded Number)`, which could under/overpay vs the exact listing price;
  - bid inputs used `Math.floor(Number(x)*1e18)`;
  - `UserCollectionBids` summed prices as floats for a quantity bar;
  - write reverts at estimation were only console-logged;
  - `useNftStats`/`useMint`/launchpad/register used the wallet chain.
- **ADDR-2 also had web singletons.** `apps/web/lib/constants.ts` re-exported Elysium-pinned address singletons. They were unused and are removed. The package singletons remain until Phase 6 regenerates addresses.
- **Plan order.** Task 6 (types) ran before 3c because explicit typed column lists need the real columns.

### Still open after Phase 4

- **Phase 5/6:**
  - Anvil rehearsal (test 21) **including a real bid acceptance through the UI quote**: this exercises the ERC-2981 path and the 0-slippage bounds against real contracts;
  - `addresses.generated.ts` (the current addresses still point at the legacy stack, ADDR-1);
  - `DeploymentConfig.sol` `deployBlock`/`verifiedAt`;
  - `prepare-deployment`.
- **Product:** a slippage selector, if wanted (plug into `useSlippageBps`); multi-chain browsing, if wanted (today the app shows exactly one data chain).
- **Ops / Phase 7:**
  - drop or replace the unused `get_top_collections_volume_24h()` and `expire_stale_records()`;
  - realtime DELETE payloads without `chain_id` are dropped (fail-closed; the indexer deactivates rather than deletes);
  - royalty override columns (`royalty_overridden`, `royalty_receiver`) are still not modelled; the quote reads them on-chain instead;
  - a `gen:types:local --check` in CI needs a DB service container.
- Carried over from 3B: Phase 3B apply (runbook), automatic reorg rollback, duplicate floor triggers, reconciliation job, Dockerfile.

## Phase 5: Rehearsal on Anvil

Branch `chore/production-readiness-phase5`, created from `main` (858f5ca). Not merged. Details, commands and the full findings table are in `docs/PHASE5_REHEARSAL.md`.
- **Exception used:** `forge --broadcast` only against Anvil on 127.0.0.1, with Anvil's published test keys.
- No `.env` was read and no remote RPC or DB was contacted. The DB was the local `sec01-local` stack. No dump was written.
- Everything (Anvil, indexer, metadata server, Supabase stack) was stopped at the end.

- [x] Test 21: deploy → configure → verify → generate addresses/ABIs → validate → seed indexer → run the indexer → compare the DB with the chain. The recorded run is from a fresh DB on 2026-11-13: `pnpm --filter @marketplace/rehearsal anvil-e2e -- --scratch <dir outside the repo>` → **16/16 steps, 183/183 checks, final reconciliation 0 mismatches at block 341.**
  - Infrastructure (5cd92ca):
    - `scripts/rehearsal` (`@marketplace/rehearsal`, in turbo);
    - env-isolation guards;
    - `launch.ts`, which registers 31337 **in process memory only** before importing the unmodified generator / prepare-deployment / indexer;
    - a guard test, which fails if any production source or committed address map gains 31337/anvil.
  - Deployment record (741a225, scripts only, no contract source): `deployBlock`, `verifiedAt` and per-component creation-code hashes. VerifyDeployment preserves them. 6 forge tests; forge 342/342.
  - generate-addresses **rule 10** (602207c): the record's code hashes must equal the `out/` artifacts, and `deployBlock`/`verifiedAt` must be positive. `deployBlock` is emitted.
  - `prepare-deployment --deployments-dir` (194290d); F-3 Windows exit fix (148872a).
  - Reconciliation library + CLI (c4a39b5, Phase 7 seed); web rehearsal suite (58dd351); orchestrator (b477594); harness fixes F-4 (d51d312) and F-5 (d0e85ec); F-1 runbook text (20df731).
  - First real runs of:
    - the generator on a verified record (+5 negative probes);
    - `prepare-deployment` success/no-op/refusal/`--force`;
    - the indexer on real logs and real reorgs (`evm_revert` and `anvil_reorg`): REORG_DETECTED, halt, operator rewind;
    - kill mid-range; a failing write holding the cursor; the confirmation lag;
    - replay over existing rows and wipe + reindex, both byte-identical;
    - the 23503 `not_indexed` → retry → `saved` path.
  - **Slippage proof:** all 14 acceptances used the web's own quote at 0 bps. Seller, fee and royalty credits equal the quote to the wei (1 wei, 3 wei, 1234567890123456789 wei, 10¹⁸+1, a 3-token collection bid, partial fills). A stale fee or royalty reverts `SellerProceedsTooLow`, with the web's readable message; a stale price reverts `PriceTooLow` / `bid_changed`.
  - **Findings:**
    - F-1 (deploy tooling, medium): `RegisterCollection`/`CreateHypurr` broadcasts revert with forge's default gas → docs-only fix, Phase 6 requirement;
    - F-2 (info): `validate:integration --live` cannot target 31337, by design;
    - F-3 (indexer, fixed);
    - F-4, F-5, F-6, F-7 (test harness, fixed).
    - **No contract-source, DB or web defect found.**
  - Verification on the final tree:
    - turbo typecheck + test 12/12 tasks (rehearsal 49, indexer 132, contracts 86, web 98 + 22 skipped);
    - forge 342/342;
    - `generate:abis:check` OK;
    - `validate:integration --chain-id 99801` OK (5 + 1 live-only skip; 47/47).
  - Repeatability: the recorded run was the third fresh run of the day. Attempts 1 and 2 stopped at F-4 and F-5; every earlier step passed identically each time. Only one full run was requested (memory); the separate two-run repeatability pair was not done.
  - Memory on this 8 GB machine: free RAM minimum ≈ 380 MB during a run. An earlier run was killed by the host for low memory.
  - **Not verified:**
    - a public testnet;
    - Orbit `block.number` semantics;
    - a cross-OS bytecode hash (see Phase 6);
    - a commit SHA in the record (needs `ffi`);
    - `CreateHypurr`;
    - CI: a `rehearsal` job is proposed in `PHASE5_REHEARSAL.md` §6, not added; it is blocked by the gitignored baseline schema.
- ➕ Repeat the rehearsal on a public testnet with real wallets. **Not done** (needs real keys and a remote RPC; out of scope for the local-only exception).

### Audit vs. code discrepancies found in Phase 5

- **The audit's deploy commands are not sufficient for collections.** With forge's default gas estimate, collection registration reverts on-chain (F-1). Neither the audit nor `DEPLOYMENT.md` mentioned it; `DEPLOYMENT.md` now does.
- **"VerifyDeployment promotes the record".** It re-serializes the record from the `DeploymentRecord` struct, so any field not in the struct is silently dropped at promotion. The new fields were therefore added to the struct and the read/write functions (741a225).
- **The indexer and forge read `.env` implicitly** (`dotenv/config`, forge's automatic `.env` loading). Rehearsals and any tooling run near the repo must isolate them, as the rehearsal does.

## Phase 6: Deployment and activation

- ➕ Confirm that the security audit report covers the exact bytecode to be deployed.
- ➕ Decide whether the final destination is Elysium (99801) or another mainnet, and define who is the owner or multisig.
- Run Deploy → Configure → VerifyDeployment (`stage=verified`).
- **Requirements from the Phase 5 rehearsal:**
  - **F-1:** register collections (`RegisterCollection`, `CreateHypurr`) with `--gas-estimate-multiplier 200`, as `DEPLOYMENT.md` now documents. Without it the broadcast reverts on-chain with `BoundedStaticCallInsufficientGas`. The Foundry scripts are unchanged by decision.
  - ⚠ **`.sol` line endings vs the bytecode hash (rule 10).** `.sol` files are not LF-pinned (`core.autocrlf=true`). The CBOR metadata in the bytecode, and therefore the creation-code hash, differs between a Windows and a Linux checkout. `generate-addresses` rule 10 will reject a record deployed from one OS when it is run from the other. Either deploy and generate from the same checkout, or decide on `*.sol text eol=lf` in `.gitattributes` **before** deploying (it changes artifact hashes; needs approval). Also confirm that the audit report covers the bytecode built that way.
  - ⚠ **Elysium `block.number` / `deployBlock`.** The record's `deployBlock` is the forge-simulated head + 1. That was proven on Anvil, but on Arbitrum Orbit (Elysium) Solidity `block.number` is not the L2 block number, so it is unverified there. Before `prepare-deployment`, check `deployBlock` against the first deployment tx receipt's block and `eth_getCode(core, deployBlock − 1) == 0x`. Correct the record (or pass a verified `--deploy-block`) if they differ.
- Regenerate `addresses.generated.ts` from the verified registry, which is the moment when the legacy stack is left behind.
- Run integration validation and tests, and seed `indexer_state` at the deployment block.
- Build and deploy the frontend. This is only allowed if steps 4–7 have passed.

## Phase 7: Operations and reconciliation

- After the first real sale and first real bid acceptance, verify that the DB matches on-chain.
- ➕ Set up monitoring and alerts: indexer lag, `errorCount > 0`, failed events, RPC errors.
- ➕ Define RPCs with fallback, rate limits, and automatic Supabase backups.
- ➕ Prepare an emergency pause (`Paused`) and incident runbook.
- ➕ Set up a periodic reconciliation job between `total_volume` and `getCollectionStats`. **Seed exists (Phase 5):** `pnpm --filter @marketplace/rehearsal reconcile` (read-only; covers stats, listings, bids, owners and activity-vs-logs; needs `--allow-remote` for a non-loopback target).

## Security and cleanup (in parallel, before real users)

- Rotate the token embedded in `FAST_RPC_URL` and remove the obsolete `*_ADDRESS` entries from `foundry/.env`.
- Review readable nonces with the anon key (DB-10) and `user_wallets.supabase_password` (DB-11). The `wallet_trust_boundary` migration from the branch will likely resolve them.
- Verify that every use of `SUPABASE_SERVICE_ROLE_KEY` is protected by wallet authorization.
- Resolve the provenance of the Sepolia addresses or remove support.
- Delete the duplicate repositories in `packages/database/src/repositories/*`.
- Move admin events out of `activity.collection_address`.
- Index `LaunchPad.CollectionDeployed` (optional).
