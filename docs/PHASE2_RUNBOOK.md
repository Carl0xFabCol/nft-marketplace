# Phase 2 runbook: production DB cutover (SEC-01 + M-1, M-2, M-4, M-6, M-7)

Operator: you, by hand. Nothing in this repo applies these migrations automatically.

This applies 12 migrations to the production Supabase database. It deploys the `chore/production-readiness-phase2` code (which includes Phase 1) in the same window. Every expected value below comes from the local rehearsal on 2026-11-07, which restored `marketplace_pre_phase2.dump` into a local Supabase stack. The rehearsal results are in `docs/SEC01_STATUS.md` §3.9.

**The one rule:** from step 4 on, the indexer stays stopped until the new code is deployed (step 7). Never run the old indexer against the new schema. Never run the new indexer against the old schema.

- The old indexer fails loudly in some places after the migrations: 42P10 on the collections and listings upserts, 23502 on bid inserts.
- It also fails silently: `updatePrice` and `deactivate` by legacy `listing_id` update 0 rows, so sales and cancels are lost.
- The new indexer fails against the old schema: 42P10, plus "column chain_id does not exist" on bid inserts.

## 0. Files and what they do

All paths are relative to the repo root, on branch `chore/production-readiness-phase2`. `.gitattributes` forces LF on the migrations, so function bodies (and the fingerprint) do not depend on the OS of your checkout.

| # | File | Audit | Effect |
|---|---|---|---|
| 1 | `packages/database/migrations/20261028090000_sec01_wallet_trust_boundary.sql` | SEC-01 | RLS, grants, policies, view `security_invoker` |
| 2 | `…090100_sec01_wallet_uniqueness.sql` | SEC-01 | lower-case CHECKs, wallet uniques |
| 3 | `…090200_sec01_listing_batch_atomicity.sql` | SEC-01 | listing RPC v1, tx/seller trigger |
| 4 | `…090300_sec01_user_wallet_one_to_one.sql` | SEC-01 | UNIQUE `user_wallets.supabase_user_id` |
| 5 | `…090400_sec01_security_definer_hardening.sql` | SEC-01 | definer EXECUTE policy |
| 6 | `…090500_sec01_listing_chain_identity.sql` | M-3 | listings `(chain_id, collection_address, token_id)`, `listing_id` rewrite |
| 7 | `…090600_sec01_listings_drop_unscoped_uniques.sql` | M-3 | drops the 2 non-chain-scoped listings uniques |
| 8 | `…090700_m1_bids_chain_id.sql` | M-1 | bids `chain_id` (backfill 99801), chain-scoped active-bid uniques |
| 9 | `…090800_m2_collections_chain_identity.sql` | M-2 | collections `(chain_id, contract_address)`, 3 FKs repointed |
| 10 | `…090900_m4_activity_chain_id_integer.sql` | M-4 | `activity.chain_id` integer, no default |
| 11 | `…091000_m6_indexer_state_chain_unique.sql` | M-6 | UNIQUE `indexer_state(chain_id)` |
| 12 | `…091100_m7_relist_clears_buyer.sql` | M-7 | RPC clears `buyer_wallet` on relist |

Helpers (all in `packages/database/scripts/`):

| File | Use |
|---|---|
| `rehearsal/phase2_precheck_readonly.sql` | Read-only. Every preflight abort condition, as counts. |
| `rehearsal/catalog_fingerprint.sql` | Read-only. Public schema fingerprint. |
| `rehearsal/catalog_fingerprint.before.txt` | Expected fingerprint before step 5. |
| `rehearsal/catalog_fingerprint.after.txt` | Expected fingerprint after step 5. |
| `rollback/phase2_rollback_prepare.sql` | **Destructive.** Rollback only (§R). |

M-5 (`p_chain_id` on the stats RPCs) is **not** part of this window. It ships in Phase 3 together with the indexer change.

## 1. Prerequisites (go / no-go)

- [ ] The staging dry run (§S) passed with this exact commit. Write down its SHA: `git rev-parse HEAD`.
- [ ] `psql` and `pg_restore`/`pg_dump` version ≥ 17 are available locally.
  - The production server is 17.6. The backup header says `pg_dump 18.0`.
  - A client of version ≥ 18 is needed to read 18.0 archives in general. pg_restore 17.11 read this one in the rehearsal.
- [ ] A **direct** or **session-mode** connection string for the `postgres` role. Do not use the transaction pooler: the migrations use multi-statement transactions and `SET LOCAL`.
  - Put it in a shell variable only, e.g. `read -rs PROD_DB_URL; export PROD_DB_URL`.
  - Never write it to a file in the repo.
- [ ] The deploy artifacts for indexer + web, built from this commit, are ready to ship.
- [ ] You can stop and start the indexer process, and you know how to check that it is stopped.
- [ ] The indexer's production environment sets `CHAIN_ID=99801` **explicitly**. Check this yourself; it is not in the repo.
  - `apps/indexer/src/config/env.ts` still defaults to 11155111 (ADDR-3, Phase 3).
  - With the wrong chain, every write goes to chain 11155111. Bid inserts then fail with 23503 against the new composite FK, listings fail `listings_nft_fk`, and `getState(11155111)` finds no cursor, so the indexer idles.
- [ ] You have a maintenance window. The total is estimated at 20–40 min (§T). Users can browse throughout, but listing creation is broken between step 5 and step 7.

## 2. Pre-checks (read-only; run the day before and again at the start of the window)

```sh
cd <repo root>
psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f packages/database/scripts/rehearsal/phase2_precheck_readonly.sql
psql "$PROD_DB_URL" -X -At -F ' | ' -f packages/database/scripts/rehearsal/catalog_fingerprint.sql > /tmp/fp_before.txt
diff /tmp/fp_before.txt packages/database/scripts/rehearsal/catalog_fingerprint.before.txt && echo FINGERPRINT-OK
```

Expected:
- The first result set has 16 rows, all with `bad = 0`. Any non-zero row: **stop**. That migration would abort. Its preflight changes nothing, but the window is wasted. Resolve the data first (the check name says which rule).
- `FINGERPRINT-OK`. The rehearsal showed the backup's schema is byte-identical to the committed baseline. Any diff means production changed since the backup: **stop** and review.
- Informational block, rehearsal values in brackets:
  - `server_version_num` 17xxxx [170011 locally; prod is 17.6];
  - `activity.chain_id type` = `text`;
  - distinct chain ids = `99801`;
  - `indexer_state` = `99801:<last_block>` [16454480 in the backup];
  - **realtime publication tables**: copy this line into your notes. The rollback needs it.
  - If `pg_cron installed = yes`, run the printed query and note the jobs. The migrations don't drop functions, but a rollback re-creates them.
- Row counts: note them. Backup values: activity 32, collection_bids 2, collections 1, contract_indexer_state 1, indexer_state 1, listings 1, nfts 7, nonces 158, profiles 8, token_bids 7, user_wallets 8. Production may have grown since.

## 3. Backup (inside the window, after stopping the indexer, so it is the newest consistent state)

Do step 4 (stop the indexer) first, then:

```sh
pg_dump "$PROD_DB_URL" -Fc -n public -f ~/backups/marketplace_phase2_window.dump
pg_restore --list ~/backups/marketplace_phase2_window.dump | grep -E "TOC Entries|Format|Dumped from"
pg_restore --list ~/backups/marketplace_phase2_window.dump | grep -c "TABLE DATA"     # expect 11
```

Expected:
- `Format: CUSTOM`;
- 11 `TABLE DATA` entries;
- about 171 TOC entries (171 in `marketplace_pre_phase2.dump`).

Keep it outside the repo. If your plan has PITR or dashboard backups, also note the timestamp. A PITR restore is the alternative rollback (§R, option B).

**Restore verification** (recommended; it is what the rehearsal did): restore it into the local stack and fingerprint it, as in §S step 2. It must print `FINGERPRINT-OK` against `catalog_fingerprint.before.txt`.

## 4. Stop the indexer

1. Stop the process.
2. Verify it stopped. Run this twice, more than one polling interval apart (default `POLLING_INTERVAL_MS` = 15 s):
   ```sql
   select chain_id, last_block from public.indexer_state;
   select max(created_at) from public.activity;
   ```
   Both values must be unchanged. Record `last_block`: the new indexer resumes from it.
3. Optional: show a maintenance banner, or disable "list for sale" in the web. Between step 5 (file 6) and step 7 the deployed old web gets errors:
   - `createBatch` (`onConflict: "listing_id"`) fails with 42P10;
   - its "Failed to save listings" toast appears after the on-chain listing already succeeded.

   The listing is on-chain. The new indexer picks it up after step 7.

## 5. Apply the migrations (one file at a time, in order)

For each file:

```sh
psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -f packages/database/migrations/<file>
echo "exit=$?"
```

- Do **not** add `-1` / `--single-transaction`: each file has its own `begin … commit`.
- `exit=0` and the expected notices mean go to the next file.
- Anything else means **stop** and go to §F.

Every new file (8–12) sets `lock_timeout = '5s'`. If a lock can't be taken because a long query holds the table, the file aborts with `55P03 canceling statement due to lock timeout` and **changes nothing**. Find the blocker and retry:

```sql
select pid, state, now() - xact_start as age, left(query, 80) from pg_stat_activity where datname = current_database() and state <> 'idle';
```

Then retry the same file.

| # | Expected output (from the real-data rehearsal) | Verification query → expected |
|---|---|---|
| 1 | 15 NOTICEs: 3× `replacing profiles policy …`, 6× `policy "sec01_public_read" … does not exist, skipping`, 6× `execute grants for … (security_definer=f …)` | `select has_table_privilege('anon','public.user_wallets','SELECT'), has_table_privilege('anon','public.listings','SELECT'), has_table_privilege('anon','public.nonces','SELECT');` → `f \| t \| f` |
| 2 | none | `select count(*) from pg_constraint where conname in ('sec01_profiles_wallet_lowercase','sec01_user_wallets_address_lowercase');` → `2` |
| 3 | 1 NOTICE: `trigger "sec01_listings_tx_seller" … does not exist, skipping` | `select count(*) from pg_trigger where tgname = 'sec01_listings_tx_seller';` → `1` |
| 4 | none | `select count(*) from pg_constraint where conname = 'sec01_user_wallets_supabase_user_id_key';` → `1` |
| 5 | 1 NOTICE (`SECURITY DEFINER sec01_save_listing_batch … owner=postgres superuser=f …`) and **1 WARNING `… is owned by non-superuser postgres; review ownership`. This is expected on Supabase.** | `select prosecdef, proconfig from pg_proc where proname = 'sec01_save_listing_batch';` → `t \| {"search_path=public, pg_temp"}` |
| 6 | none | `select listing_id from public.listings limit 3;` → every value is `99801:0x…-<token>`. `select count(*) from public.listings where chain_id is null;` → `0` |
| 7 | 2 NOTICEs: `dropping non-chain-scoped unique constraint listings_collection_address_token_id_key`, `… unique_tx_token` | `select conname from pg_constraint where conrelid='public.listings'::regclass and contype='u';` → only `sec01_listings_chain_identity_key` |
| 8 | 3 NOTICEs: `M-1 backfilled chain_id = 99801: token_bids N row(s), collection_bids M row(s)` (backup: 7 and 2; N/M = your current counts), `dropping … idx_token_bids_unique_active`, `… idx_collection_bids_unique_active` | `select chain_id, count(*) from public.token_bids group by 1 union all select chain_id, count(*) from public.collection_bids group by 1;` → only `99801` |
| 9 | 5 NOTICEs: repointing `collection_bids…`, `nfts…` (`on update cascade on delete set default (collection_address)`), `token_bids…`; dropping `collections_contract_address_unique` and `collections_contract_address_idx` | `select conrelid::regclass, conname from pg_constraint where confrelid='public.collections'::regclass;` → `nfts_chain_collection_fkey`, `token_bids_chain_collection_fkey`, `collection_bids_chain_collection_fkey` |
| 10 | 1 NOTICE: `M-4 converting activity.chain_id text -> integer` | `select format_type(atttypid,atttypmod), attnotnull, atthasdef from pg_attribute where attrelid='public.activity'::regclass and attname='chain_id';` → `integer \| t \| f` |
| 11 | none | `select conname from pg_constraint where conname='indexer_state_chain_id_key';` → 1 row |
| 12 | none | `select prosrc ~ 'buyer_wallet = null', prosecdef, has_function_privilege('anon', oid, 'EXECUTE') from pg_proc where proname='sec01_save_listing_batch';` → `t \| t \| f` |

Every file has a postcondition block, so `exit=0` already implies its own invariants hold. The verification queries are a cheap second look.

**After file 12:**

```sh
psql "$PROD_DB_URL" -X -At -F ' | ' -f packages/database/scripts/rehearsal/catalog_fingerprint.sql > /tmp/fp_after.txt
diff /tmp/fp_after.txt packages/database/scripts/rehearsal/catalog_fingerprint.after.txt && echo FINGERPRINT-OK
```

Expected `FINGERPRINT-OK`. This was verified identical for the empty baseline and the restored production data.

Row counts must equal the step 2 numbers. Re-run the last result set of `phase2_precheck_readonly.sql`; its checks section is pre-migration only, so ignore it. Then run:

```sql
select 'listings', count(*) from public.listings where chain_id <> 99801
union all select 'nfts', count(*) from public.nfts where chain_id <> 99801
union all select 'collections', count(*) from public.collections where chain_id <> 99801
union all select 'token_bids', count(*) from public.token_bids where chain_id <> 99801
union all select 'collection_bids', count(*) from public.collection_bids where chain_id <> 99801
union all select 'activity', count(*) from public.activity where chain_id <> 99801;
```

Expected: all 0.

These migrations are applied with psql, so `supabase_migrations.schema_migrations` does not record them. If you later adopt `supabase db push`, mark them applied first.

## 6. Realtime publication

The migrations do not drop tables, so publication membership is preserved. The rehearsal verified this for all 6 marketplace tables, including `activity` across the type change. Compare against your step 2 note:

```sql
select pubname, tablename from pg_publication_tables where schemaname = 'public' order by 1, 2;
```

## 7. Deploy the code, then restart the indexer

1. Deploy **indexer and web** from the same commit. Phase 1 changes plus the Phase 2 code changes:
   - `CollectionsRepository` `onConflict: "chain_id,contract_address"`;
   - `BidsRepository` inserts send `chain_id`;
   - `ListingsRepository` upsert sends `buyer_wallet: null`.
2. Confirm once more that the indexer environment has `CHAIN_ID=99801`.
3. Start the indexer. It resumes from the `last_block` recorded in step 4.

## 8. Post-checks (first 15–30 min)

- The indexer log shows no `❌` errors, and `select last_block from public.indexer_state;` advances.
- Rows written after the restart are on 99801, and activity keeps flowing:
  ```sql
  select chain_id, count(*) from public.activity where created_at > now() - interval '30 minutes' group by 1;
  ```
- Web smoke test, connected to Elysium:
  - collection page: listings, bids, floor;
  - a token page: bids and activity;
  - user page: their bids. This exercises the `collections!inner` embed, which goes over the new composite FK.
- List a test token from the UI. It must succeed: the RPC writes `source = optimistic`, and then the indexer confirms it.
- When a sale or relist happens, the relisted row has `buyer_wallet` NULL (M-7).
- Remove the maintenance banner.

## F. If a migration fails during step 5

Each file is one transaction. A failure (preflight abort, lock timeout, anything else) leaves the database exactly as it was after the previous file.

| Failure | Action |
|---|---|
| `… preflight failed: …` (files 2, 4, 6, 8–12) | No change was made. The message gives counts. Decide: fix the data with a reviewed one-off SQL, then re-run the same file and continue (fix forward), **or** stop here and roll back (§R) if you can't fix it in the window. Never edit a committed migration. |
| `55P03` lock timeout | No change. Clear the blocker and re-run the same file. |
| Files 8–12 re-run | They are re-runnable: catalog-guarded, so a re-run is a no-op where already applied. Files 1–7 are not all re-runnable: 090500 has unguarded `ADD CONSTRAINT`. Never re-run 1–7 after they succeed. |
| Anything unexpected after some files succeeded | Keep the indexer **stopped** and keep the old code deployed. Either fix forward, or roll back completely (§R). There is no supported "run old code on a half-migrated schema". |

## R. Rollback (restore the backup and the old code together)

**When:** the post-checks fail in a way you can't fix forward, or a migration fails and you won't fix forward.

**Cost:** writes after the backup are lost:
- indexer data is re-derived from chain on restart, from the restored cursor;
- web-only writes (new users, profiles, nonces, optimistic listings) made after the backup are lost.

That's why the backup is taken inside the window, with the indexer stopped.

**Option A: from the step 3 dump.** Rehearsed locally: the result is the exact `before` fingerprint and identical row counts.

1. Stop the indexer. Put the web in maintenance.
2. Clear the public objects. This is **destructive** and runs as one transaction. It refuses if the database isn't post-Phase-2 (`-v force=1` overrides; use it only after a partial apply). It aborts if anything outside `public` depends on these tables.
   ```sh
   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f packages/database/scripts/rollback/phase2_rollback_prepare.sql
   ```
   Expected: NOTICEs `dropping table …` ×11 and `dropping function …` (15 baseline functions plus `sec01_*`).

   A plain `pg_restore --clean` is **not** a rollback. The rehearsal showed that it cannot drop `collections`, because the new composite FKs are unknown to the dump, and it leaves a mixed schema.
3. Restore. Skip the `public` schema entry, which already exists, and the 3 `FOR ROLE supabase_admin` default-ACL entries: you can't run those as `postgres`, and the migrations never changed them.
   ```sh
   pg_restore --list ~/backups/marketplace_phase2_window.dump \
     | grep -v -E " SCHEMA - public | DEFAULT ACL .* supabase_admin$" > /tmp/rollback.toc
   pg_restore -d "$PROD_DB_URL" -L /tmp/rollback.toc ~/backups/marketplace_phase2_window.dump   # connect as postgres: the dump's objects are owned by postgres
   ```
   Expected: no errors.
4. Verify: the fingerprint against `catalog_fingerprint.before.txt` gives `FINGERPRINT-OK`, and the row counts equal the step 3 backup.
5. Re-add realtime publication membership from your step 2 note, e.g.:
   ```sql
   alter publication supabase_realtime add table public.activity, public.listings;
   ```
   Dropping the tables removed them. The dump does not carry membership.
6. Redeploy the **old** code (current `main`) for indexer and web, then start the old indexer. The old code is consistent with the old schema.

**Option B: Supabase PITR / dashboard restore** to a timestamp before step 5, if your plan has it. This restores the whole database, including `auth`. Then do step 6 above. Use it if option A fails.

## S. Dry-run checklist on staging (do this first, with the same commit)

Staging can be a Supabase staging project, or a local stack (`npx supabase start`) as in the rehearsal.

1. [ ] Fresh backup of production: `pg_dump -Fc -n public`.
2. [ ] Restore it into staging, as the rehearsal did:
   - restore everything except the `SCHEMA - public` entry, as `postgres`;
   - restore the 3 `supabase_admin` default ACLs as `supabase_admin` (local) or skip them (hosted);
   - on a database without the production `auth.users`, insert placeholder `auth.users` rows for the restored `profiles.id`, then restore the single `profiles_id_fkey` TOC entry.
3. [ ] `catalog_fingerprint.sql` gives `FINGERPRINT-OK` against `before.txt`.
4. [ ] `phase2_precheck_readonly.sql`: all 16 checks are 0.
5. [ ] Apply files 1–12 exactly as in §5. Compare every notice and verification result with the table. Time each file.
6. [ ] The fingerprint gives `FINGERPRINT-OK` against `after.txt`. Row counts are unchanged, and every chain_id is 99801.
7. [ ] Run the test suites:
   - `capture_counts.sql` before and after, then `npx supabase test db packages/database/tests-realdata --db-url <staging>` gives 19/19;
   - `pnpm --filter @marketplace/database test:rls -- --workdir <local project>` gives 159/159;
   - the vitest RLS suite (22) with `SEC01_TEST_SUPABASE_*` pointing at staging.
8. [ ] Run the new indexer against staging (`CHAIN_ID=99801`) and the new web, then do §8.
9. [ ] Re-apply files 8–12. Each must be a no-op with exit 0.
10. [ ] Rehearse §R option A on staging. It must end in `FINGERPRINT-OK` against `before.txt` and the same counts.
11. [ ] Write down the timings, and any notice that differs from this runbook.

## T. Locks and duration

Locks were measured in the rehearsal (`pg_locks` of the migrating backend just before `commit`):

| File | Strongest locks (held until commit) | Effect on traffic |
|---|---|---|
| 1–7 (SEC-01) | ACCESS EXCLUSIVE on the tables they alter (profiles, user_wallets, listings, …) | Reads and writes on those tables wait for the few ms each file runs |
| 8 M-1 | ACCESS EXCLUSIVE `token_bids`, `collection_bids`; ACCESS SHARE `collections` | bid reads wait |
| 9 M-2 | ACCESS EXCLUSIVE `collections`, `nfts`, `token_bids`, `collection_bids` | collection/NFT/bid pages and `nfts_market_view` wait |
| 10 M-4 | ACCESS EXCLUSIVE `activity` (table rewrite for the type change) | activity reads wait |
| 11 M-6 | ACCESS EXCLUSIVE `indexer_state` | none (indexer stopped) |
| 12 M-7 | no table locks (function replace only) | none |

Duration:
- **Rehearsal timing:** every file finished in ≤ 0.33 s wall time locally. That includes `docker exec` and psql start-up; the statements themselves take milliseconds at about 230 rows total. Against hosted Supabase, add your network round-trips. The 12 files together should take under 10 s.
- **Lock waits:** with the indexer stopped, the only competing traffic is web reads, which are short. Files 8–12 give up after 5 s instead of queueing (`lock_timeout`).
- **Whole window:** 20–40 min. That is stop, verify and backup (5–10), apply and verify (5–10), deploy (5–15) and post-checks (5).
