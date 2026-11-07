# SEC-01 status

Last updated: 2026-11-07, Phase 1, branch `chore/production-readiness-phase1` (local DB verification added in §3).

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
| Optimistic batch listings go through the `sec01_save_listing_batch` RPC with the service role. Wei stays a decimal string. Duplicate and canonical-form checks happen client-side too. | `apps/web/actions/listings/createBatch.ts` | `createBatch.test.ts` (mocked RPC) |
| `failListingsByTxHash` scoped by chain and by the authenticated caller's wallet | `apps/web/actions/listings/failBatch.ts` | `failBatch.test.ts` (mocked) |
| Login mapping lookup uses `maybeSingle` with an explicit error | `apps/web/app/api/auth/login/route.ts` | none |
| `chainGuard` (`assertWalletChain`, `requireSupportedChainId`) and an explicit `chainId` through hooks, components and pages. Realtime drops other-chain rows. Merge keys are chain-aware. | `apps/web/lib/chainGuard.ts`, `apps/web/hooks/*`, `apps/web/lib/listingMerge.ts` | `chainGuard.test.ts`, `listingMerge.test.ts`, `nft.service.test.ts` (unit) |

## 2. Written but unapplied to the live database

None of these migrations has been applied to the live Supabase project. Applying them is **Phase 2** and is human-gated. All six assume the existing Supabase schema: the `anon`/`authenticated`/`service_role` roles, the `auth` schema, and the 11 public tables.

| Migration | Effect | Notes for the operator |
| --- | --- | --- |
| `20261028090000_sec01_wallet_trust_boundary.sql` | Enables RLS on 11 tables. Revokes **all** table and column privileges from `public`/`anon`/`authenticated`. Gives public read on the marketplace tables and column-limited read/update on `profiles`. Makes `user_wallets`, `nonces` and `indexer_state*` service-role only. Drops and recreates every `profiles` policy. Revokes the 6 mutating helpers. Sets `nfts_market_view` to `security_invoker`. | Destructive to grants and policies. Transactional, with a postcondition block. Does not change `ALTER DEFAULT PRIVILEGES`. |
| `20261028090100_sec01_wallet_uniqueness.sql` | Lower-case CHECK and UNIQUE on `profiles.wallet` and `user_wallets.wallet_address` | Aborts on non-canonical or duplicate data without changing it. |
| `20261028090200_sec01_listing_batch_atomicity.sql` | UNIQUE(`listing_id`), the tx/seller trigger, and the first version of `sec01_save_listing_batch` | Partly superseded by 090500 in the same series. |
| `20261028090300_sec01_user_wallet_one_to_one.sql` | UNIQUE(`user_wallets.supabase_user_id`) | Aborts on duplicates. |
| `20261028090400_sec01_security_definer_hardening.sql` | Default-deny EXECUTE on every SECURITY DEFINER function in `public`. Re-grants 7 read RPCs. Pins `search_path = public, pg_temp` on known functions. | Reviewed 2026-11-07 (§3): the baseline has **no** SECURITY DEFINER functions, so 090400 only touches `sec01_save_listing_batch`, which is already pinned and fully qualified. It always emits one WARNING, "owned by non-superuser postgres", because `postgres` is not a superuser on Supabase. That warning is noise. |
| `20261028090500_sec01_listing_chain_identity.sql` | Audit **M-3**: UNIQUE(`chain_id, collection_address, token_id`), `chain_id NOT NULL`, canonical-form CHECKs. Drops the single-column `listing_id` unique. Rewrites `listing_id` to `chain:addr-token`. Chain-scoped trigger and RPC. | Not re-runnable (unguarded `ADD CONSTRAINT`), but transactional. **Incomplete (§3):** the baseline's `UNIQUE (collection_address, token_id)` and `UNIQUE (tx_hash, collection_address, token_id)` survive, so cross-chain listings still fail with 23505. A follow-up migration is proposed. |

**Deploy coupling:** the code in §1 and migrations 090000–090500 must go live together. Verified locally on 2026-11-07 (§3.5):
- The new indexer and web code need 090500 (the conflict target) and the RPC.
- The current `main` code (`onConflict: "listing_id"`) fails with **42P10** once 090500 drops that unique.
- Worse, main's indexer `updatePrice`/`deactivate` (`.eq("listing_id", "<addr>-<token>")`) **silently match 0 rows** after 090500 rewrites `listing_id` to `<chain>:<addr>-<token>`. There is no error. An old indexer left running after the migration leaves sold or cancelled listings active.
- Do not deploy this branch before the migrations, and do not run the migrations under the old code. Stop the indexer for the cutover.

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

### 3.7 Proposed fixes (not applied; awaiting approval)

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

## 4. Missing (not implemented anywhere)

- **IDX-4 wei precision in the indexer.** `Number(price)` and `Number(newPrice)` are still used in `CoreEventHandler` and `BidsEventHandler`, and `ListingsRepository`/`BidsRepository` take `price: number`. Planned for Phase 3, with audit test #12.
- **M-7.** `buyer_wallet` is not reset on relist, either in the indexer upsert or in the RPC's `ON CONFLICT` update. `listingMerge.ts` hides an active listing whose stale `buyer_wallet` differs from the owner. Phase 2.
- **M-1, M-2, M-4, M-5, M-6** (bid `chain_id`, collection composite identity, `activity.chain_id` type and default, RPC `p_chain_id`, `indexer_state` unique). Phases 2–3.
- **Bids are not chain-scoped** (IDX-6). Collections and activity reads are only partially chain-filtered. Phases 3–4.
- **Default privileges.** New tables will still receive Supabase's default `anon`/`authenticated` grants.
- **`user_wallets.supabase_password`** is still stored. After 090000 it is unreadable to clients, but it is not removed (DB-11).
