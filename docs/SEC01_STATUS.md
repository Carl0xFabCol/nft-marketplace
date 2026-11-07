# SEC-01 status

Last updated: 2026-11-07, Phase 3B, branch `chore/production-readiness-phase3b` (from `…-phase3a` ← `…-phase2` ← `…-phase1`). Phase 1 local DB verification is in §3.1–§3.8; Phase 2 in §2 and §3.9; Phase 3B (091200–091600) in §2 and §3.10.

**Production status:** per the operator, 090000–091100 are **applied** (not verified from this side; the Phase 3B pre-check asserts it). 091200–091600 are **unapplied**: they are rehearsed locally only, and the procedure is `docs/PHASE3B_RUNBOOK.md`.

This file replaces an earlier SEC-01 status note. That note was never tracked in git (`docs/*` is gitignored), and it described migrations and code as "Implemented" when they existed only on the unmerged commit `fc85e2b` (`fix/bigint-precision`). See `docs/INTEGRATION_AUDIT.md` §6.3. Everything below was checked against the code in this branch.

Status vocabulary:
- **In repo**: the code or SQL is committed on this branch. It is **not** on `main` until the branch is merged.
- **Unapplied**: a SQL file exists, but it has not been run against the live Supabase database.
- **Not verified**: no automated test has exercised it against a real Postgres or Supabase instance.
- **Missing**: does not exist anywhere.

## 1. Implemented in the repository (code)

| Item | Where | Tested by |
| --- | --- | --- |
| Canonical listing identity: `normalizeCollectionAddress`, `normalizeTokenId`, `normalizeChainId`, `buildListingId` → `"<chain>:<addr>-<token>"` | `packages/shared/src/listingIdentity.ts` | `listingIdentity.test.ts` (unit) |
| `Listing.chain_id` typed as non-null | `packages/shared/src/types/listing.ts`, `apps/web/lib/supabase/types.ts` | typecheck |
| Indexer listing writes keyed by `(chain_id, collection_address, token_id)`: upsert `onConflict`, `updatePrice`, `deactivate` | `apps/indexer/src/persistence/ListingsRepository.ts`, handlers | `ListingsRepository.test.ts` (mocked Supabase) |
| Same chain scoping in the shared repository | `packages/database/src/repositories/listings.repo.ts` | typecheck only |
| Wallet ownership resolved from the service-role-only `user_wallets` mapping, not `profiles.wallet` | `apps/web/lib/supabase/auth.ts` | `auth.test.ts` (mocked) |
| Phase 2 writes required by the new schema:<br>- collections upsert `onConflict: "chain_id,contract_address"` (M-2);<br>- bid inserts carry `chain_id = env.chainId` (M-1; bid *filters* stay chain-less until IDX-6);<br>- listings upsert sends `buyer_wallet: null` (M-7). | `apps/indexer/src/persistence/{CollectionsRepository,BidsRepository,ListingsRepository}.ts`, `packages/database/src/repositories/collections.repo.ts` | `CollectionsRepository.test.ts`, `BidsRepository.test.ts`, `ListingsRepository.test.ts` (mocked); cutover probes §3.9 (real local DB) |
| **Phase 3A (indexer, code only, no schema change):**<br>- IDX-4: wei is sent as exact decimal strings into `numeric(78,0)`; stats get an exact ether decimal;<br>- IDX-1: `Sale` is the only stats source, gated on a fresh activity row;<br>- IDX-2/3: the cursor never passes a failed event; monotonic; `CONFIRMATIONS` lag;<br>- IDX-5: unverify, royalty, launchpad and withdrawal listeners; decoding uses the generated ABIs;<br>- IDX-9: no 1970 timestamps;<br>- ADDR-3: `CHAIN_ID` is required;<br>- IDX-8: per-chunk checkpointing.<br>Collection verification and royalty updates are chain-scoped. | `apps/indexer/src/**` | Indexer unit tests (95 + 1 todo), all mocked or in-memory:<br>- audit tests #9, #10, #11 (handler level), #12, #13, #16;<br>- `validate:integration` (a)(b)(c)(f). |
| **Phase 3B (indexer + schema, migrations 091200–091600):**<br>- the sale and its stats are one atomic RPC (`indexer_record_sale`), exactly once per log;<br>- bid writes are chain-scoped RPCs keyed on the placement event, with an event-derived remaining quantity (IDX-6/7);<br>- M-5 callers pass `p_chain_id`;<br>- `prepare-deployment`;<br>- reorg detection via `last_block_hash` (halt; no automatic rollback). | `apps/indexer/src/**`, `packages/database/src/repositories/collections.repo.ts`, `apps/web/lib/supabase/types.ts` (types only), `packages/contracts/scripts/lib/addresses.ts` (`checkRecordStatic`) | Indexer unit tests (128); `test:localdb` (8, real local Postgres); pgTAP `phase3b_migrations.test.sql` (78) |
| Optimistic batch listings go through the `sec01_save_listing_batch` RPC with the service role. Wei stays a decimal string. Duplicate and canonical-form checks happen client-side too. | `apps/web/actions/listings/createBatch.ts` | `createBatch.test.ts` (mocked RPC) |
| `failListingsByTxHash` scoped by chain and by the authenticated caller's wallet | `apps/web/actions/listings/failBatch.ts` | `failBatch.test.ts` (mocked) |
| Login mapping lookup uses `maybeSingle` with an explicit error | `apps/web/app/api/auth/login/route.ts` | none |
| `chainGuard` (`assertWalletChain`, `requireSupportedChainId`) and an explicit `chainId` through hooks, components and pages. Realtime drops other-chain rows. Merge keys are chain-aware. | `apps/web/lib/chainGuard.ts`, `apps/web/hooks/*`, `apps/web/lib/listingMerge.ts` | `chainGuard.test.ts`, `listingMerge.test.ts`, `nft.service.test.ts` (unit) |

## 2. Migrations and their production status

090000–091100 have been applied to the live Supabase project by the operator, following `docs/PHASE2_RUNBOOK.md` (reported at the Phase 3B kickoff, 2026-11-07). 091200–091600 are **unapplied**; follow `docs/PHASE3B_RUNBOOK.md`. All of them assume the existing Supabase schema: the `anon`/`authenticated`/`service_role` roles, the `auth` schema, and the 11 public tables.

| Migration | Effect | Notes for the operator |
| --- | --- | --- |
| `20261028090000_sec01_wallet_trust_boundary.sql` | Enables RLS on 11 tables. Revokes **all** table and column privileges from `public`/`anon`/`authenticated`. Gives public read on the marketplace tables and column-limited read/update on `profiles`. Makes `user_wallets`, `nonces` and `indexer_state*` service-role only. Drops and recreates every `profiles` policy. Revokes the 6 mutating helpers. Sets `nfts_market_view` to `security_invoker`. | Destructive to grants and policies. Transactional, with a postcondition block. Does not change `ALTER DEFAULT PRIVILEGES`. |
| `20261028090100_sec01_wallet_uniqueness.sql` | Lower-case CHECK and UNIQUE on `profiles.wallet` and `user_wallets.wallet_address` | Aborts on non-canonical or duplicate data without changing it. |
| `20261028090200_sec01_listing_batch_atomicity.sql` | UNIQUE(`listing_id`), the tx/seller trigger, and the first version of `sec01_save_listing_batch` | Partly superseded by 090500 in the same series. |
| `20261028090300_sec01_user_wallet_one_to_one.sql` | UNIQUE(`user_wallets.supabase_user_id`) | Aborts on duplicates. |
| `20261028090400_sec01_security_definer_hardening.sql` | Default-deny EXECUTE on every SECURITY DEFINER function in `public`. Re-grants 7 read RPCs. Pins `search_path = public, pg_temp` on known functions. | Reviewed 2026-11-07 (§3): the baseline has **no** SECURITY DEFINER functions, so 090400 only touches `sec01_save_listing_batch`, which is already pinned and fully qualified. It always emits one WARNING, "owned by non-superuser postgres", because `postgres` is not a superuser on Supabase. That warning is noise. |
| `20261028090500_sec01_listing_chain_identity.sql` | Audit **M-3**: UNIQUE(`chain_id, collection_address, token_id`), `chain_id NOT NULL`, canonical-form CHECKs. Drops the single-column `listing_id` unique. Rewrites `listing_id` to `chain:addr-token`. Chain-scoped trigger and RPC. | Not re-runnable (unguarded `ADD CONSTRAINT`), but transactional. **Incomplete (§3):** the baseline's `UNIQUE (collection_address, token_id)` and `UNIQUE (tx_hash, collection_address, token_id)` survive, so cross-chain listings still fail with 23505. A follow-up migration is proposed. |
| `20261028090600_sec01_listings_drop_unscoped_uniques.sql` | Finishes M-3. Drops every unique constraint or index on `listings` that lacks `chain_id` (today `listings_collection_address_token_id_key` and `unique_tx_token`). The postcondition asserts that none remain and that `sec01_listings_chain_identity_key` exists. | Re-runnable (catalog-driven). Verified locally in §3.8. |
| `20261028090700_m1_bids_chain_id.sql` (208 lines) | **M-1.** `token_bids`/`collection_bids.chain_id integer`, backfilled with 99801, NOT NULL, CHECK > 0. The chain-less active-bid partial uniques are replaced by `idx_*_unique_active_chain`. | The preflight aborts if a bid's collection is not on 99801. Re-runnable. Code coupling: inserts must send `chain_id` (23502 otherwise). |
| `20261028090800_m2_collections_chain_identity.sql` (270 lines) | **M-2.** `collections_chain_contract_key UNIQUE (chain_id, contract_address)`. The 3 FKs (nfts, token_bids, collection_bids) are found in the catalog and recreated on `(chain_id, collection_address)` with their actions kept; nfts `ON DELETE SET DEFAULT (collection_address)`. Drops **both** address-only uniques (`collections_contract_address_unique` and `collections_contract_address_idx`). | Requires 090700. The preflight covers duplicates, orphans and unknown FKs. Re-runnable. Code coupling: `onConflict: "contract_address"` → 42P10. |
| `20261028090900_m4_activity_chain_id_integer.sql` (127 lines) | **M-4.** `activity.chain_id` text → integer. The `'11155111'` default is dropped (not replaced). NOT NULL, CHECK > 0. | The preflight requires a lossless cast and no NULLs. Re-runnable. No code coupling. |
| `20261028091000_m6_indexer_state_chain_unique.sql` (84 lines) | **M-6.** `indexer_state_chain_id_key UNIQUE (chain_id)`. | The preflight aborts on duplicates. Re-runnable. |
| `20261028091100_m7_relist_clears_buyer.sql` (259 lines) | **M-7.** `sec01_save_listing_batch` is an exact copy of the 090500 version, plus `buyer_wallet = null` in `ON CONFLICT … DO UPDATE`. | SECURITY DEFINER, `search_path = public, pg_temp` and service_role-only EXECUTE are kept and asserted. Re-runnable. |
| `20261028091200_sale_activity_stats_rpc.sql` (183 lines), **unapplied** | `indexer_record_sale`: SALE activity + chain-scoped stats in one transaction, idempotent on `(tx_hash, log_index)`. | **SECURITY DEFINER**, `search_path = public, pg_temp`, service_role-only EXECUTE (revoked from public/anon/authenticated). Re-runnable. |
| `20261028091300_m5_chain_scoped_rpcs.sql` (419 lines), **unapplied** | **M-5.** 7 RPCs re-created with `p_chain_id` first; old signatures dropped; floor triggers chain-scoped. | INVOKER, service_role only (incl. the two read RPCs). The preflight aborts on catalog dependents / pg_cron jobs. Re-runnable. Code coupling: pre-3B indexers get PGRST202 on the Sale path. |
| `20261028091400_idx7_bid_event_identity.sql` (429 lines), **unapplied** | **IDX-6/7.** Bid event identity, `UNIQUE (chain_id, tx_hash, log_index)`, `placed_quantity`, `collection_bid_fills` ledger (RLS, no client privileges), 2 bid RPCs. | INVOKER, service_role only. Legacy rows keep NULL identity. Re-runnable. |
| `20261028091500_indexer_state_types.sql` (176 lines), **unapplied** | `contract_indexer_state` chain_id NOT NULL, PK `(chain_id, contract_address)`; `indexer_state.chain_id` integer; `last_block_hash`. | Preflight: NULL/fractional/out-of-range chains. Re-runnable. |
| `20261028091600_market_view_chain_join.sql` (109 lines), **unapplied** | `nfts_market_view` joins listings and bids on `chain_id`. | Same columns (pinned by the preflight), `security_invoker` and grants kept. Re-runnable. |

**Deploy coupling:** the code in §1 and migrations 090000–090600 must go live together. Verified locally on 2026-11-07 (§3.5):
- The new indexer and web code need 090500 (the conflict target) and the RPC.
- The current `main` code (`onConflict: "listing_id"`) fails with **42P10** once 090500 drops that unique.
- Worse, main's indexer `updatePrice`/`deactivate` (`.eq("listing_id", "<addr>-<token>")`) **silently match 0 rows** after 090500 rewrites `listing_id` to `<chain>:<addr>-<token>`. There is no error. An old indexer left running after the migration leaves sold or cancelled listings active.
- Do not deploy this branch before the migrations, and do not run the migrations under the old code. Stop the indexer for the cutover.
- Phase 2 widens the coupling (verified in §3.9):
  - after 090700, main's bid inserts fail with 23502;
  - after 090800, main's collections upsert fails with 42P10;
  - conversely, the Phase 2 indexer fails against the old schema.

  Order: stop the indexer → 090000–091100 → deploy the Phase 2 indexer + web → restart. The full procedure is in `docs/PHASE2_RUNBOOK.md`.

## 3. Local verification (2026-11-07)

This ran on a disposable **local** Supabase stack only. No remote database was contacted.
- Supabase CLI 2.119.0 (`npx`, from `packages/database`), image `supabase/postgres:17.11.0.002`, pgTAP 1.3.3.
- Only db, auth, rest and kong were running. The workdir was a scratch directory outside the repo, so it has no `supabase/migrations` and nothing was auto-applied.
- All SQL ran as `postgres` through `psql` in the db container.

### 3.1 Baseline load (scratch copy; the dump file itself is unchanged)

`baseline_schema.sql` (pg_dump 18, from PG 17.6) needed two adaptations, both forced by errors in a first diagnostic load:

| Adaptation | Error that forced it |
| --- | --- |
| Removed `CREATE SCHEMA public;` | `schema "public" already exists` |
| Moved the 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …` lines to a separate file run as `supabase_admin` | `permission denied to change default privileges` ×12 (`postgres` is not a superuser locally) |

Everything else loaded unchanged (`\restrict` is supported by psql 17.11): 11 tables, 1 view, 15 functions, 14 policies, RLS on all 11 tables, owner `postgres`. The byte-level diff is exactly those 13 lines, with CRLFs preserved.

The baseline also contains two foreign keys the tests did not expect:
- `listings_nft_fk`: `listings(collection_address, token_id, chain_id)` → `nfts`, `ON DELETE CASCADE`.
- `nfts` → `collections`.
- `user_wallets.supabase_user_id` has **no** FK to `auth.users`.

### 3.2 SECURITY DEFINER review (before 090400)

- **Baseline:** all 15 `public` functions are SECURITY INVOKER with no `proconfig`. None references `extensions.`, `auth.`, `net.`, `vault.` etc., and none calls pgcrypto/uuid-ossp/http. 090400 iterates only `prosecdef`, so it changes none of them.
- **Migrations:**
  - `sec01_save_listing_batch` is the only definer function. Owner `postgres`, `search_path=public, pg_temp`, `public.`-qualified tables, `pg_catalog` builtins only.
  - `sec01_enforce_listing_tx_seller` is an invoker trigger, also pinned.
  - **Result: no 090400 search_path breakage.**
- Side note: anon can still EXECUTE the trigger functions `trigger_update_floor_price` and `update_floor_price`. This is harmless, since trigger functions cannot be called directly.

### 3.3 Migrations 090000 → 090500

All six applied in order, each in its own transaction, with exit 0. Total statement time was < 35 ms each, and there was no lock contention (single session). Every migration takes ACCESS EXCLUSIVE on the tables it alters.

| Migration | Output |
| --- | --- |
| 090000 | NOTICEs only: 3 profiles policies replaced; 6 mutating helpers re-granted, all `security_definer=f` |
| 090100 | none |
| 090200 | NOTICE `trigger … does not exist, skipping` (expected) |
| 090300 | none |
| 090400 | NOTICE for `sec01_save_listing_batch` + WARNING "owned by non-superuser postgres" (benign on Supabase) |
| 090500 | none. It drops `listings_listing_id_unique` and `listings_listing_id_idx`. It does **not** drop `listings_collection_address_token_id_key` or `unique_tx_token`. |

### 3.4 pgTAP `sec01_rls_privileges.test.sql` (102 assertions, file unmodified)

| Run | Setup | Result |
| --- | --- | --- |
| 1 (official) | schema-only baseline + 090000–090500 | 1–86 ok. **87 not ok** (no exception: no duplicate row exists, and there is no FK, so it is not 23503 either). **88 aborts** with `23503 listings_nft_fk` (no `nfts` parent), so 89–102 never ran. |
| 2 | + rolled-back fixtures (auth user and mapping, collection/nfts parents, another seller's active listing on `0x…10`/1) | 1–89 ok. **90 aborts** with `23505 listings_collection_address_token_id_key`: a real bug. |
| 3 (diagnostic) | fixtures + proposed 090600 (drops both non-chain-scoped uniques), rolled back | **102/102 ok** |

Classification:
- #87 and #88 are **test fixture problems**. The schema-only baseline has no rows, and the test assumed no `nfts` FK.
- #90 is a **real logic bug**: M-3 is incomplete in 090500.
- With only `listings_collection_address_token_id_key` dropped, #90 still fails on `unique_tx_token`, so both constraints must go.

### 3.5 Vitest `rls.integration.test.ts` (22 tests, file unmodified)

| Run | Result |
| --- | --- |
| Official | **19 passed, 3 failed**: "allows repeated listing batches…", "serializes concurrent listing batches…", "rejects a listing batch that overwrites…". All three get `23503 listings_nft_fk`, because the tests use random collections with no `nfts`/`collections` parents. **Test fixture problem.** |
| Diagnostic (`listings_nft_fk` temporarily dropped, then restored identically and validated) | 22/22 |
| Proposed fixture patch (temp copy, real FK in place) | 22/22 |

No environment-difference failures. The tests create their own users through GoTrue, and nothing depends on a production auth trigger.

### 3.6 Cutover probes (supabase-js, service role / user session, local)

| # | Path | Result |
| --- | --- | --- |
| a1 | main indexer `upsert(onConflict: "listing_id")` | 42P10 no matching unique (OK before 090500 at the SQL level, 42P10 after) |
| a2 | main web `createBatch` user-session `upsert(onConflict: "listing_id")` | 42P10 (would be 42501 without the conflict error) |
| a3/a4 | main `updatePrice`/`deactivate` `.eq("listing_id", "<addr>-<token>")` | **0 rows, no error**; listing stays active |
| b1 | branch indexer upsert on `chain_id,collection_address,token_id` ×2 | OK, 1 row, idempotent |
| b2/b3 | branch chain-scoped `updatePrice`/`deactivate` | 1 row each |
| b4 | branch `admin.rpc("sec01_save_listing_batch")` | returns 1; `listing_id = 99801:<addr>-2`; wei `1000000000000000000` exact |
| b5 | RPC as anon / authenticated | 42501 / 42501 |
| b6 | branch indexer upsert of the same token on a second chain | **23505 `listings_collection_address_token_id_key`** (same bug as pgTAP #90) |

### 3.7 Fixes (approved 2026-11-07; status per item)

Items 1–3 and 5 are applied. Item 4 is decided: keep the FK, and the UI handles it in Phase 4. The pgTAP suite gained one assertion, "every unique constraint and unique index on listings includes chain_id", which brings it to **103**.

1. **New migration `20261028090600_sec01_listings_drop_unscoped_uniques.sql`.**
   - Drops every unique constraint or index on `listings` that lacks `chain_id`, which today means `listings_collection_address_token_id_key` and `unique_tx_token`.
   - Includes a postcondition.
   - Both are redundant with `sec01_listings_chain_identity_key`.
   - Validated (rolled back): pgTAP 102/102.
2. **pgTAP fixtures:** insert, inside the test transaction after `no_plan()`:
   - the auth user `1111…` plus a `user_wallets` mapping;
   - the `collections`/`nfts` parents for `0x…10`;
   - another seller's active listing on 99801/`0x…10`/1.

   No assertion changes.
3. **Vitest fixtures:** add an `ensureNfts(collection, chainId, tokenIds, owner)` helper used by the three listing-RPC tests, and clean up `nfts`/`collections` in `afterAll`. No assertion changes.
4. **Product decision (open):** because of `listings_nft_fk`, the optimistic listing RPC fails with 23503 for any NFT the indexer has not indexed yet, and `createBatch` surfaces this as "Failed to save listings". Either keep the FK and handle it in the UI, or have the RPC tolerate a missing `nfts` row.
5. **Minor:** `packages/database/scripts/run-rls-tests.mjs` spawns a global `supabase` binary. Use `npx supabase` or the documented `psql -f` path.

### 3.8 Full re-run with fixes (2026-11-07, cycle 2)

Fresh local DB (`supabase db reset`) → adapted baseline (byte-identical to cycle 1) → 090000–090600 → committed test files. **No ad-hoc rows**: the only rows come from the committed fixtures, and every table was at 0 rows after each suite.

| Step | Result |
| --- | --- |
| 090000–090500 | exit 0 each; same notices and the one 090400 warning as §3.3 |
| Negative control: pgTAP after 090500, before 090600 | new #86 **not ok**; aborts at the cross-chain RPC test with 23505 `listings_collection_address_token_id_key`, as expected |
| 090600 | exit 0; NOTICE drops `listings_collection_address_token_id_key` and `unique_tx_token`. A second apply is a clean no-op. Remaining: `listings_pkey`, `sec01_listings_chain_identity_key`. |
| pgTAP via `psql -f` | **103/103 ok, 0 not ok** |
| pgTAP via `supabase test db` (pg_prove 3.36, `--workdir` = scratch project) | `Files=1, Tests=103, Result: PASS` |
| Vitest `rls.integration.test.ts` | **22/22 passed** (real `listings_nft_fk` in place) |
| `pnpm --filter @marketplace/database test:rls` | The first attempt failed: without `--workdir`, pg_prove looked for Docker network `supabase_network_database`. Fixed by forwarding extra args. `pnpm test:rls -- --workdir <local project>` now gives `Files=1, Tests=103, Result: PASS`. |

### 3.9 Phase 2: migrations 090700–091100, real-data rehearsal, cutover (2026-11-07)

Same local-only setup as §3: Supabase CLI 2.119.0, project `sec01-local` in a scratch dir outside the repo, image 17.11.0.002, pgTAP 1.3.3. No remote database was contacted, and no `.env` was read.

**Real data.**
- Source: `marketplace_pre_phase2.dump`, a `pg_dump -Fc -n public` produced by pg_dump 18.0 from PG 17.6, with 171 TOC entries. It sits outside the repo and was never copied into it.
- It was copied only into the container's `/tmp` and restored there with pg_restore 17.11, as `postgres`, minus two kinds of entry:
  - `SCHEMA public`, which already exists;
  - the 3 `FOR ROLE supabase_admin` default ACLs, which ran as `supabase_admin`. These are the same two adaptations as the baseline (§3.1).
- **1 restore error:** `profiles_id_fkey`, because the dump has no `auth.users`. Handled locally by inserting 8 placeholder `auth.users` rows (one per `profiles.id`, emails `rehearsal-<id>@example.invalid`), then restoring that single FK TOC entry. No row contents were printed at any point; only counts.

**Schema drift.** A read-only catalog fingerprint (`packages/database/scripts/rehearsal/catalog_fingerprint.sql`: columns, constraints, indexes, function bodies, policies, triggers, RLS, ACLs, owners, view) of the restored backup is **byte-identical** to the committed baseline (289 lines). No constraint or index name differs. Expected fingerprints are committed: `catalog_fingerprint.before.txt` / `.after.txt`.

**Counts before = after**, with every chain_id = 99801:

| activity | collection_bids | collections | contract_indexer_state | indexer_state | listings | nfts | nfts_market_view | nonces | profiles | token_bids | user_wallets |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 2 | 1 | 1 | 1 | 1 | 7 | 7 | 158 | 8 | 7 | 8 |

The indexer cursor in the backup is 99801:16454480.

**Migrations on real data.**
- All 12 exit 0. There was **no preflight failure**: no duplicates, no uppercase or non-canonical values, no orphan, and no unexpected FK.
- Notices:
  - 090000–090600: as §3.3, plus 090600 dropping the 2 listings uniques;
  - 090700: backfilled 7 token bids and 2 collection bids;
  - 090800: repointed 3 FKs and dropped 2 address-only uniques;
  - 090900: converted the type.
- A second pass of 090700–091100 is a no-op.
- The "after" fingerprint is identical for real data and for the empty baseline.
- Pre-check: `scripts/rehearsal/phase2_precheck_readonly.sql` (read-only) reports all 16 abort conditions = 0 on the backup. It was verified to detect injected bad rows.

**Test results.**

| Run | pgTAP `tests/` (pg_prove, `test:rls -- --workdir`) | Round-trip `tests-realdata/` (#20) | Vitest `rls.integration.test.ts` |
| --- | --- | --- | --- |
| A: fresh reset → baseline → 090000–091100 (final committed bytes) | `Files=2, Tests=159, PASS` (103 SEC-01 + 56 Phase 2) | n/a | **22/22**; 0 rows left |
| B: restored backup → 090000–091100 | `Files=2, Tests=159, PASS` | `Files=1, Tests=19, PASS` | **22/22**; round-trip still 19/19 afterwards |

- `phase2_migrations.test.sql` (56) covers audit #18 for each of M-1, M-2, M-4, M-6 and M-7: the constraint exists with its intended columns, and the forbidden duplicate or orphan is rejected (23502/23503/23505/23514). It also covers #19: the same collection/token and the same bidder coexist on 99801 and 11155111 in listings, nfts, token_bids and collection_bids.
- The SEC-01 suite needed a **fixture-only** change: `collections` parents on 11155111 and 1, required by the composite nfts FK. No assertion changed. With this fixture, the §3.8 negative control ("run before 090600") is no longer runnable as-is.

**Negative preflight tests.** Each case is a seeded bad row → migration → expected abort with the documented message → schema signature and data unchanged. All cases pass:
- 091100 before 090500;
- 090800 before 090700;
- 090700 with a bid on a non-99801 collection (column add rolled back);
- 090900 with `'099801'`, `'abc'`, `' 99801'`, `'2147483648'`, NULL;
- 091000 with a duplicate chain;
- 090800 with an nft whose collection is on another chain.

**Measured locks** (`pg_locks` before commit):

| Migration | ACCESS EXCLUSIVE on | Other |
| --- | --- | --- |
| 090700 | `token_bids`, `collection_bids` | — |
| 090800 | `collections`, `nfts`, `token_bids`, `collection_bids` | — |
| 090900 | `activity` | — |
| 091000 | `indexer_state` | — |
| 091100 | — | no table lock |

Each file takes ≤ 0.33 s wall time locally, including `docker exec`.

**Cutover probes** (supabase-js against the migrated real-data DB; the indexer repository classes were imported with an empty `DOTENV_CONFIG_PATH`; probe rows were cleaned up). **18/18 as predicted:**
- Phase 1+2 paths **work**:
  - collections upsert ×2 on 99801, plus the same address on 11155111;
  - bid inserts carry chain_id = 99801;
  - bid cancel / partial fill / deactivate;
  - listing upsert → sale → relist clears `buyer_wallet` (indexer);
  - RPC relist after a sale clears `buyer_wallet`;
  - activity insert stores an integer;
  - indexer_state get/update;
  - web `collections!inner(*)` embeds from both bid tables over the new composite FK;
  - `collections` `nfts(count)`;
  - real-data reads: 1 collection, nfts(count) 7, activity 32, market view 7.
- Current-main paths **fail as predicted**:
  - collections `onConflict: "contract_address"` → **42P10**;
  - token/collection bid insert without chain_id → **23502**;
  - listings `onConflict: "listing_id"` → **42P10**;
  - `updatePrice` by legacy `listing_id` → **0 rows, no error**.
- Main's activity insert still works; it already sends `chain_id`. An activity insert *without* chain_id now fails with 23502 instead of defaulting to Sepolia.
- Realtime publication membership survives the migrations (verified for the 6 marketplace tables).

**Rollback rehearsal.**
- A plain `pg_restore --clean` with the backup **does not** roll back: `cannot drop table public.collections because other objects depend on it`, because the composite FKs are unknown to the dump. The result is a mixed schema.
- Added `scripts/rollback/phase2_rollback_prepare.sql`: one guarded transaction that drops the public tables, view and functions. It refuses on a non-Phase-2 DB and aborts if anything outside `public` depends on those objects (verified with a foreign view and a foreign FK). This first version of the guard missed views (`pg_rewrite` was excluded); that was fixed before commit.
- Running it and then the filtered restore gives the **exact "before" fingerprint and identical counts**. Publication membership is lost by the rollback and must be re-added; the runbook says so.

**Line endings.** With `core.autocrlf=true`, the 090000–090500 working copies were CRLF, so function bodies created from a Windows checkout contained `\r` (fingerprint md5 difference on `sec01_enforce_listing_tx_seller`). `.gitattributes` now pins `packages/database/migrations/*.sql` to LF; repository content is unchanged. All results above were re-run on the LF files.

### 3.10 Phase 3B: migrations 091200–091600, real-data rehearsal, rollback (2026-11-07)

Same local-only setup as §3.9: Supabase CLI 2.119.0, project `sec01-local` in a scratch dir outside the repo, image 17.11.0.002, pgTAP 1.3.3. No remote database was contacted, and no `.env` was read.

**Baseline fidelity.** The adapted baseline was rebuilt **byte-preserving**. A first build with Git Bash `grep -v` stripped the CRs, and the live function bodies are CRLF. With the rebuilt baseline, empty baseline + 090000–091100 is byte-identical to `catalog_fingerprint.after.txt`.

**Empty baseline → 090000–091600.**
- All exit 0. Expected NOTICEs on the first apply: only the 3 from 091500 (PK move, redundant unique dropped, numeric → integer).
- A second pass of 091200–091600 is a no-op (identical fingerprint).
- The result is committed as `catalog_fingerprint.after_phase3b.txt`.

**Real data.**
- `marketplace_pre_phase2.dump` was restored as in §3.9: filtered TOC, `supabase_admin` default ACLs, 8 placeholder `auth.users`, then the `profiles_id_fkey` entry. The restore matches `catalog_fingerprint.before.txt`.
- 090000–091600 applied with no preflight failure. The fingerprint == `after_phase3b.txt`.
- Counts are identical before and after: activity 32, collection_bids 2, collections 1, contract_indexer_state 1, indexer_state 1, listings 1, nfts 7, nfts_market_view 7, nonces 158, profiles 8, token_bids 7, user_wallets 8.
- Stats `99801:0.215/6` and cursor `99801:16454480` are unchanged.
- Both collection bids have `placed_quantity = quantity`, no bid has an event identity (legacy), and the cursor hash is NULL.

**Test results.**

| Run | pgTAP `tests/` | Round-trip `tests-realdata/` | Vitest RLS | Indexer `test:localdb` |
| --- | --- | --- | --- | --- |
| Empty baseline → 090000–091600 | `Files=3, Tests=237, PASS` (103 + 56 + 78) | n/a | 22/22, 0 rows left | 8/8 |
| Restored backup → 090000–091600 | `Files=3, Tests=237, PASS` | 19/19 | 22/22 | 8/8 |

- `phase3b_migrations.test.sql` (78) covers, for every migration, the constraint/function shape and a negative test (23505 / 23502 / 23514 / 22P02 / 22023 / 42501, old signatures absent). It also has privilege checks:
  - anon and authenticated cannot EXECUTE any of the 12 new or changed functions;
  - PUBLIC has no EXECUTE;
  - service_role can;
  - every one pins `search_path = public, pg_temp`;
  - only `indexer_record_sale` is DEFINER;
  - `collection_bid_fills` has RLS and no anon/authenticated privilege.
- Negative control: on the Phase 2 state the file fails from test 1.
- The localdb suite runs the real repositories and handlers against the stack:
  - the ignoreDuplicates assumption;
  - sale exactness/replay/cross-chain;
  - bid #11 (full and partial replay give identical rows), #14 and #15;
  - prepare-deployment;
  - the cursor hash, the monotonic guard and its CHECK.

**Negative preflights:** 12 cases; each aborts with the schema fingerprint and counts unchanged (list in PRODUCTION_PLAN, Phase 3B results).

**Read-only pre-check** (`phase3b_precheck_readonly.sql`): 14 checks, all 0 on the backup. It detected injected bad state: a catalog dependent, a pg_cron job, a NULL chain, a fractional chain.

**Rollback.**
- **A** (`rollback/phase3b_down.sql`, schema only):
  - result: exactly `catalog_fingerprint.after.txt` with identical counts, on the empty baseline and on the backup;
  - re-apply: exactly `after_phase3b.txt`;
  - the SEC-01 and Phase 2 suites pass on the rolled-back state;
  - its guard refuses a second run.
- **B** (restore a post-Phase-2 dump):
  - `phase2_rollback_prepare.sql` refuses on a 3B database (`collection_bid_fills` remains), so `phase3b_down.sql` runs first;
  - **finding:** restoring a post-SEC-01 dump makes every public table ALL and every function EXECUTE for anon/authenticated, because of `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` in the target. With those defaults suspended around `pg_restore` and restored afterwards, the ACLs are semantically identical (only the item order differs in 10 lines) and the counts identical. `docs/PHASE3B_RUNBOOK.md` §R includes the step.

**Cutover probes (supabase-js).**
- After 3B, the pre-3B `increment_collection_stats(p_collection_address, p_sales, p_volume)` gets `PGRST202`.
- After the down, `indexer_record_sale` gets `PGRST202`.
- Pre-3B identity-less bid inserts stay schema-compatible (the Phase 2 suite inserts bids without identity and passes).

**Measured locks:**

| Migration | ACCESS EXCLUSIVE on |
| --- | --- |
| 091200 | none (function) |
| 091300 | none (functions; trigger bodies replaced) |
| 091400 | `token_bids`, `collection_bids`, `collection_bid_fills` |
| 091500 | `indexer_state`, `contract_indexer_state` |
| 091600 | `nfts_market_view` |

Each file takes ≤ 0.38 s wall time locally.

## 4. Missing (not implemented anywhere)

- ~~IDX-4 wei precision in the indexer.~~ **Done in Phase 3A** (writes are exact, test #12).
  - **Still open on the read side (Phase 4):** PostgREST serializes `numeric` as a JSON number. Web reads of `listings.price` and `*_bids.price` can round unless they select `price::text`.
- **Phase 3A deploy note.** It does not change the Phase 2 cutover order.
  - The indexer now **refuses to start without `CHAIN_ID`**: set `CHAIN_ID=99801`, which the runbook already requires.
  - It indexes up to `head - CONFIRMATIONS` (default 12).
  - A persistently failing event now **halts the cursor** instead of being skipped. Watch the "Run stopped at a failed event" log and its `consecutiveFailedRuns` counter.
- ~~Sale stats are at-most-once.~~ **Fixed in Phase 3B** (`indexer_record_sale`, one transaction). Takes effect once 091200 and the 3B indexer are deployed.
- ~~M-5~~ **Written in Phase 3B** (091300, unapplied). Still chain-less: `expire_stale_records()` (not in M-5) and `get_top_collections_volume_24h()` (the web's only stats RPC; it also filters event names the indexer never writes). Open, Phase 4.
- ~~Bids are not chain-scoped in the indexer and not replay-safe~~ **Fixed in Phase 3B** (091400 + BidsRepository RPCs, unapplied). **Still open (Phase 4): web bid reads are not chain-filtered.** The original text follows for history.
  - Since M-1, rows carry `chain_id`, but the indexer's bid update/select filters and the web's bid reads do not filter by it.
  - Replaying a block range duplicates bid rows, and a replayed collection-bid acceptance decrements the quantity twice. Both are encoded as `it.fails` markers in `ReplayIdempotency.test.ts`. `nfts_market_view` still joins listings and bids without `chain_id` (the view part of DB-1). Collections and activity reads are only partially chain-filtered. Phases 3–4.
- ~~`indexer_state.chain_id` is numeric~~ → integer in 091500 (unapplied). `nfts_market_view` chain joins are in 091600 (unapplied).
- **Restore-based rollback re-opens SEC-01 ACLs.** Restoring any post-SEC-01 `pg_dump` into Supabase gives anon/authenticated ALL/EXECUTE through the target's default privileges, unless they are suspended around `pg_restore` (§3.10; `docs/PHASE3B_RUNBOOK.md` §R). PITR is not affected.
- **Reorgs deeper than `CONFIRMATIONS`** are detected and halt the indexer (3B); there is no automatic rollback (`docs/REORG_ROLLBACK_DESIGN.md`).
- **Phase 3B is not applied to production.** Applying it is human-gated; see `docs/PHASE3B_RUNBOOK.md`. (Phase 2 is applied, per the operator.)
- **Default privileges.** New tables will still receive Supabase's default `anon`/`authenticated` grants.
- **`user_wallets.supabase_password`** is still stored. After 090000 it is unreadable to clients, but it is not removed (DB-11).
