# SEC-01 status

Last updated: 2026-11-06, Phase 1, branch `chore/production-readiness-phase1`.

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
| `20261028090400_sec01_security_definer_hardening.sql` | Default-deny EXECUTE on every SECURITY DEFINER function in `public`. Re-grants 7 read RPCs. Pins `search_path = public, pg_temp` on known functions. | Function bodies were not reviewed. A body that relies on another schema unqualified will break. |
| `20261028090500_sec01_listing_chain_identity.sql` | Audit **M-3**: UNIQUE(`chain_id, collection_address, token_id`), `chain_id NOT NULL`, canonical-form CHECKs. Drops the single-column `listing_id` unique. Rewrites `listing_id` to `chain:addr-token`. Chain-scoped trigger and RPC. | Not re-runnable (unguarded `ADD CONSTRAINT`), but transactional. |

**Deploy coupling:** the code in §1 and migrations 090000–090500 must go live together.
- The new indexer and web code need 090500 (the conflict target) and the RPC.
- The current `main` code (`onConflict: "listing_id"`) breaks once 090500 drops that unique.
- Do not deploy this branch before the migrations, and do not run the migrations under the old code.

## 3. Not verified

| Suite | State |
| --- | --- |
| `packages/database/tests/sec01_rls_privileges.test.sql` (pgTAP, 102 assertions) | **Never executed.** Needs a disposable Postgres with pgTAP, the schema-only baseline, and migrations 090000–090500. Known fixture assumption: two tests (duplicate `supabase_user_id = 11111111-…`, and another seller's active listing on `0x…10` / token `1`) expect rows that a schema-only baseline does not contain. |
| `apps/web/lib/supabase/rls.integration.test.ts` (22 tests) | **Skipped** (`describe.skipIf`). Needs a full local Supabase stack (GoTrue + PostgREST) via `SEC01_TEST_SUPABASE_*`. These are the "22 skipped tests". They are not pgTAP. |

The environment needed for both is not available yet: Docker and the Supabase CLI are not installed. The baseline dump exists at `packages/database/baseline/`, untracked.

## 4. Missing (not implemented anywhere)

- **IDX-4 wei precision in the indexer.** `Number(price)` and `Number(newPrice)` are still used in `CoreEventHandler` and `BidsEventHandler`, and `ListingsRepository`/`BidsRepository` take `price: number`. Planned for Phase 3, with audit test #12.
- **M-7.** `buyer_wallet` is not reset on relist, either in the indexer upsert or in the RPC's `ON CONFLICT` update. `listingMerge.ts` hides an active listing whose stale `buyer_wallet` differs from the owner. Phase 2.
- **M-1, M-2, M-4, M-5, M-6** (bid `chain_id`, collection composite identity, `activity.chain_id` type and default, RPC `p_chain_id`, `indexer_state` unique). Phases 2–3.
- **Bids are not chain-scoped** (IDX-6). Collections and activity reads are only partially chain-filtered. Phases 3–4.
- **Default privileges.** New tables will still receive Supabase's default `anon`/`authenticated` grants.
- **`user_wallets.supabase_password`** is still stored. After 090000 it is unreadable to clients, but it is not removed (DB-11).
