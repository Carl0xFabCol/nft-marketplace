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

### Known-failing tests (intentional; run in CI job `integration-contract-tests`, continue-on-error)

Do not weaken these. Each one turns green when the listed phase fixes the code.

| Test / check | Failure today | Fixed in |
| --- | --- | --- |
| #7 / validate (a) events exist in generated ABI | `core:ContractAuthorized` is configured, but the event is now `LaunchpadAuthorized` | Phase 3 (IDX-5 / ABI-4) |
| #8 call-shape: `acceptTokenBid` | web passes 3 args, contract takes 5 (`minPrice`, `minSellerProceeds`) | Phase 4 (ABI-1) |
| #8 call-shape: `acceptCollectionBid` | web passes 3 args, contract takes 5 (`minPricePerItem`, `minSellerProceeds`) | Phase 4 (ABI-1) |
| validate (c) CHAIN_ID required | `apps/indexer/src/config/env.ts:71` silently defaults to 11155111 | Phase 3 (ADDR-3) |
| validate (f) default chain id consistent | indexer 11155111 vs shared/contracts 99801 | Phase 3 (ADDR-3) |
| ~~`@marketplace/database` typecheck~~ | **Green since Phase 3A task 1.** It had a supabase-js generic type error in `src/client.ts` (2 errors); the generic was dropped (type-only). It now runs in the main `typescript` job. | Phase 3A |
| web `rls.integration.test.ts` (22 tests) | Skipped in CI (needs `SEC01_TEST_SUPABASE_*`). Locally, after the fixes: **22/22** | n/a (passes locally) |
| pgTAP `sec01_rls_privileges.test.sql` (103) | Not in CI. Locally, after 090600 and the fixtures: **103/103**. After 090000–091100 (Phase 2 fixture): 103/103. | n/a (passes locally) |
| pgTAP `phase2_migrations.test.sql` (56) and `tests-realdata/phase2_roundtrip.test.sql` (19) | Not in CI; they need a local stack (the round-trip also needs the restored backup). Locally: 56/56 and 19/19 (SEC01_STATUS §3.9). | n/a (passes locally) |

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

Branch `chore/production-readiness-phase2`, created from `chore/production-readiness-phase1`. Neither branch is merged to main. **Nothing has been applied to production.** Applying it is your manual step: follow `docs/PHASE2_RUNBOOK.md`. Full results are in `docs/SEC01_STATUS.md` §3.9.

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
- [ ] **Apply to production** (you, by hand, after the staging dry run).
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

## Phase 4: Frontend

- Regenerate the ABIs and replace the hand-pasted ones.
- ABI-1: pass `minPrice` and `minSellerProceeds` in `acceptTokenBid` and `acceptCollectionBid`.
- Product decision: define the default slippage tolerance. A bad value accepts bids at a worse price than displayed.
- Integrate `chainGuard` and use a single chain id for reads and writes.
- Filter all listings, collections, activity, and bids queries by chain.
- `getContractAddresses` must return `undefined` on unknown chains, and the UI must show "switch network".
- Regenerate Supabase types in a single place.
- Map the 27 custom errors to show readable messages to the user.
- **Optimistic listings vs `listings_nft_fk`** (decision 2026-11-07: keep the FK).
  - `sec01_save_listing_batch` fails with **23503** when the indexer has not yet written the `nfts` row, for example a freshly minted or just-transferred token.
  - Today `createBatch` turns this into a generic "Failed to save listings".
  - The UI must recognize 23503 and say clearly that the listing is on-chain but not yet indexed. It should offer a retry, or poll until the `nfts` row exists, and must not report the listing as failed.
- Run test 8 (call arity) until it passes.

## Phase 5: Rehearsal on Anvil

- Test 21: deploy → configure → verify → generate addresses/ABIs → validate → seed indexer → run the indexer → compare the DB with `getCollectionStats` on-chain. Nothing moves to the next phase without this.
- ➕ Repeat the rehearsal on a public testnet with real wallets.

## Phase 6: Deployment and activation

- ➕ Confirm that the security audit report covers the exact bytecode to be deployed.
- ➕ Decide whether the final destination is Elysium (99801) or another mainnet, and define who is the owner or multisig.
- Run Deploy → Configure → VerifyDeployment (`stage=verified`).
- Regenerate `addresses.generated.ts` from the verified registry, which is the moment when the legacy stack is left behind.
- Run integration validation and tests, and seed `indexer_state` at the deployment block.
- Build and deploy the frontend. This is only allowed if steps 4–7 have passed.

## Phase 7: Operations and reconciliation

- After the first real sale and first real bid acceptance, verify that the DB matches on-chain.
- ➕ Set up monitoring and alerts: indexer lag, `errorCount > 0`, failed events, RPC errors.
- ➕ Define RPCs with fallback, rate limits, and automatic Supabase backups.
- ➕ Prepare an emergency pause (`Paused`) and incident runbook.
- ➕ Set up a periodic reconciliation job between `total_volume` and `getCollectionStats`.

## Security and cleanup (in parallel, before real users)

- Rotate the token embedded in `FAST_RPC_URL` and remove the obsolete `*_ADDRESS` entries from `foundry/.env`.
- Review readable nonces with the anon key (DB-10) and `user_wallets.supabase_password` (DB-11). The `wallet_trust_boundary` migration from the branch will likely resolve them.
- Verify that every use of `SUPABASE_SERVICE_ROLE_KEY` is protected by wallet authorization.
- Resolve the provenance of the Sepolia addresses or remove support.
- Delete the duplicate repositories in `packages/database/src/repositories/*`.
- Move admin events out of `activity.collection_address`.
- Index `LaunchPad.CollectionDeployed` (optional).
