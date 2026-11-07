# Phase 3B runbook: indexer schema cutover (sale RPC, M-5, IDX-6/7, cursor tables, market view)

Operator: you, by hand. Nothing in this repo applies these migrations automatically.

This window does three things:
- applies 5 migrations (`20261028091200` … `091600`) to the production Supabase database;
- deploys the indexer from branch `chore/production-readiness-phase3b`, which includes Phase 3A;
- optionally deploys the web from the same commit (its only change is type declarations).

Every expected value below comes from the local rehearsal on 2026-11-07. The rehearsal ran on the committed baseline plus 090000–091100, and on `marketplace_pre_phase2.dump` restored and migrated to the same point. Results are in `docs/SEC01_STATUS.md` §3.10.

**Precondition:** Phase 2 (090000–091100) is already applied in production. §2 verifies this; if it is not, stop and follow `docs/PHASE2_RUNBOOK.md` first.

**The one rule:** from step 4 on, the indexer stays stopped until the 3B indexer is deployed (step 7).
- **Pre-3B indexer on the 3B schema:** its Sale handler calls `increment_collection_stats(text, numeric, integer)`, which is gone after file 2, so it gets `PGRST202`.
  - A Phase 2 indexer **skips failed events and advances its cursor**, so those Sales would be lost from the stats silently.
  - A 3A indexer halts instead.
- **3B indexer on the pre-3B schema:** it fails with `PGRST202` on `indexer_record_sale` and the bid RPCs, and halts.

## 0. Files

All paths are relative to the repo root. `.gitattributes` forces LF on the migrations and on the rollback/rehearsal SQL.

| # | File | Audit | Effect | Lines |
|---|---|---|---|---|
| 1 | `packages/database/migrations/20261028091200_sale_activity_stats_rpc.sql` | IDX-1 follow-up | `indexer_record_sale` (**SECURITY DEFINER**, service_role only): SALE activity + chain-scoped stats in one transaction, idempotent on `(tx_hash, log_index)` | 183 |
| 2 | `…091300_m5_chain_scoped_rpcs.sql` | M-5 (DB-5) | 7 RPCs re-created with `p_chain_id` first, old signatures dropped, floor triggers chain-scoped; all service_role only | 419 |
| 3 | `…091400_idx7_bid_event_identity.sql` | IDX-6/IDX-7 | bid event identity + `UNIQUE (chain_id, tx_hash, log_index)`; `placed_quantity`; `collection_bid_fills` ledger; 2 bid RPCs | 429 |
| 4 | `…091500_indexer_state_types.sql` | DB-6/7, IDX-3 | `contract_indexer_state` chain_id NOT NULL, PK `(chain_id, contract_address)`; `indexer_state.chain_id` → integer; `last_block_hash` | 176 |
| 5 | `…091600_market_view_chain_join.sql` | DB-1 (view) | `nfts_market_view` joins listings and bids on `chain_id` | 109 |

Helpers in `packages/database/scripts/`:

| File | Use |
|---|---|
| `rehearsal/phase3b_precheck_readonly.sql` | Read-only. Every 3B preflight abort as counts, plus facts to record. |
| `rehearsal/catalog_fingerprint.sql` | Read-only. Public schema fingerprint. |
| `rehearsal/catalog_fingerprint.after.txt` | Expected **before** this window (= after Phase 2). |
| `rehearsal/catalog_fingerprint.after_phase3b.txt` | Expected **after** file 5. |
| `rollback/phase3b_down.sql` | Rollback option A: schema back to the exact post-Phase-2 catalog. Keeps rows. |
| `rollback/phase2_rollback_prepare.sql` | Rollback option B only, **after** `phase3b_down.sql`. Destructive. |

## 1. Prerequisites (go / no-go)

- [ ] The staging dry run (§S) passed with this exact commit. Write down its SHA: `git rev-parse HEAD`.
- [ ] `psql`, `pg_dump`, `pg_restore` ≥ 17 locally (the server is 17.6).
- [ ] A **session-pooler** (or direct) connection string for `postgres`, as in Phase 2. Never use the transaction pooler: the files use `BEGIN … COMMIT` and `SET LOCAL`. Keep it in a shell variable only: `read -rs PROD_DB_URL; export PROD_DB_URL`.
- [ ] The indexer artifact is built from this commit. It requires these environment variables:
  - `CHAIN_ID=99801`. **Required**: the 3A indexer refuses to start without it.
  - `CONFIRMATIONS` is optional, default 12.
  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are unchanged.
- [ ] You can stop and start the indexer and verify that it is stopped.
- [ ] A short window, 15–30 min (§T). The web keeps working throughout. Nothing it calls changes, and `nfts_market_view` keeps its columns.

## 2. Pre-checks (read-only; the day before and again at the start of the window)

```sh
cd <repo root>
psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f packages/database/scripts/rehearsal/phase3b_precheck_readonly.sql
psql "$PROD_DB_URL" -X -At -F ' | ' -f packages/database/scripts/rehearsal/catalog_fingerprint.sql > /tmp/fp_pre3b.txt
diff /tmp/fp_pre3b.txt packages/database/scripts/rehearsal/catalog_fingerprint.after.txt && echo FINGERPRINT-OK
```

Expected:
- **First result: 14 rows, all `bad = 0`**, and the line `091300 pg_cron: cron.job does not exist (bad = 0)`. If `pg_cron` is installed, that line is replaced by a `bad` count instead. Any non-zero value: **stop**. That migration would abort and change nothing, but the window is wasted. The check name says which rule failed:
  - `phase2 applied: …` means Phase 2 is not (fully) applied;
  - `091300 catalog objects depending …` means a view or default calls an old M-5 function;
  - `091300 pg_cron jobs …` means a scheduled job calls `cleanup_expired_*()` or another changed function. Unschedule it, or plan to re-create it with `p_chain_id` after the window.
- **`FINGERPRINT-OK`** against `after.txt`. This proves production is exactly the rehearsed post-Phase-2 schema. Any diff: **stop** and review it.
- **Informational block.** Copy it into your notes. Rehearsal values (backup) are in brackets:
  - `3B already applied?` = `false`;
  - rows activity / token_bids / collection_bids / collections [32 / 7 / 2 / 1];
  - active bids [0 / 0];
  - collection stats [`99801:0.215/6`];
  - indexer cursor [`99801:16454480`];
  - contract_indexer_state rows [1];
  - **realtime publication tables**: needed only for rollback option B.

## 3. Stop the indexer, then back up

1. Stop the indexer. Verify it, twice, more than one `POLLING_INTERVAL_MS` apart (default 15 s):
   ```sql
   select chain_id, last_block from public.indexer_state;
   select max(created_at) from public.activity;
   ```
   Both values must be unchanged. Record `last_block`: the 3B indexer resumes from it.
2. Backup. Use a fresh file name, kept outside the repo:
   ```sh
   pg_dump "$PROD_DB_URL" -Fc -n public -f ~/backups/marketplace_phase3b_window.dump
   pg_restore --list ~/backups/marketplace_phase3b_window.dump | grep -E "Format|Dumped from"
   pg_restore --list ~/backups/marketplace_phase3b_window.dump | grep -c "TABLE DATA"     # expect 11
   ```
   If your plan has PITR, note the timestamp too.

## 4. Apply the migrations (one file at a time, in order)

```sh
psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -f packages/database/migrations/<file>
echo "exit=$?"
```

- Never add `-1`: each file has its own `begin … commit` and `lock_timeout = '5s'`.
- On `55P03` (lock timeout), nothing changed. Find the blocker and re-run the same file:
  ```sql
  select pid, state, now() - xact_start as age, left(query, 80) from pg_stat_activity where datname = current_database() and state <> 'idle';
  ```
- `exit=0` plus the expected output means go to the next file. Anything else: §F.

| # | Expected output (first apply; rehearsal) | Verification query → expected |
|---|---|---|
| 1 | none | `select prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE'), has_function_privilege('service_role', oid, 'EXECUTE') from pg_proc where proname = 'indexer_record_sale';` → `t \| {"search_path=public, pg_temp"} \| f \| t` |
| 2 | none | `select oid::regprocedure from pg_proc where proname in ('increment_collection_stats','get_collection_stats','update_collection_floor_price','get_top_collections','cleanup_expired_listings','cleanup_expired_token_bids','cleanup_expired_collection_bids') order by 1;` → 7 rows, each with `integer` as its **first** argument. `select count(*) from pg_proc where proname like 'cleanup_expired_%' and has_function_privilege('anon', oid, 'EXECUTE');` → `0` |
| 3 | none | `select conname from pg_constraint where conname in ('token_bids_chain_event_key','collection_bids_chain_event_key');` → 2 rows. `select count(*) filter (where placed_quantity = quantity), count(*) from public.collection_bids;` → equal [2 \| 2]. `select relrowsecurity, has_table_privilege('anon','public.collection_bid_fills','SELECT') from pg_class where relname = 'collection_bid_fills';` → `t \| f` |
| 4 | 3 NOTICEs: `contract_indexer_state primary key {contract_address} -> (chain_id, contract_address)`, `dropping redundant contract_indexer_state_contract_chain_unique`, `converting indexer_state.chain_id numeric -> integer` | `select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id';` → `integer`. `select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.contract_indexer_state'::regclass and contype = 'p';` → `PRIMARY KEY (chain_id, contract_address)` |
| 5 | none | `select pg_get_viewdef('public.nfts_market_view') ~ 'l.chain_id = n.chain_id';` → `t`. `select count(*) from public.nfts_market_view;` → same as `nfts` [7] |

Every file has a postcondition block, so `exit=0` already implies its invariants. The queries are a second look.

**After file 5:**

```sh
psql "$PROD_DB_URL" -X -q -c "notify pgrst, 'reload schema';"
psql "$PROD_DB_URL" -X -At -F ' | ' -f packages/database/scripts/rehearsal/catalog_fingerprint.sql > /tmp/fp_post3b.txt
diff /tmp/fp_post3b.txt packages/database/scripts/rehearsal/catalog_fingerprint.after_phase3b.txt && echo FINGERPRINT-OK
```

- Expect `FINGERPRINT-OK`. It was identical for the empty baseline and the restored backup.
- Re-run the **informational block** of the pre-check (its checks are pre-migration only). Every count, the stats line (`99801:0.215/6` in the backup) and the cursor must equal your step 2 notes. `3B already applied?` is now `true`.

These files are applied with psql, so `supabase_migrations.schema_migrations` does not record them (same as Phase 2).

## 5. Realtime publication

The migrations drop no table that is in the publication (`collection_bid_fills` is new and not published). Compare with your step 2 note:

```sql
select pubname, tablename from pg_publication_tables where schemaname = 'public' order by 1, 2;
```

## 6. Do **not** run prepare-deployment in this window

`pnpm --filter @marketplace/indexer prepare-deployment` seeds the cursors for a **new, verified** contract deployment (audit §8 step 8, Phase 6). Here the contracts are unchanged and the cursor already exists, so leave it alone. It would refuse anyway: there is no `deployments/elysium.json` with `stage=verified`, only the archived legacy record.

## 7. Deploy the indexer, then restart it

1. Deploy the indexer from this commit. Changes, relative to a Phase 2 indexer:
   - Phase 3A, already documented:
     - `CHAIN_ID` is required;
     - indexing up to `head - CONFIRMATIONS`;
     - the cursor halts at a failing event instead of skipping it;
     - new listeners;
     - wei as exact strings.
   - Phase 3B:
     - Sales go through `indexer_record_sale`;
     - bids go through `indexer_apply_{token,collection}_bid_event`, with every bid write chain-scoped;
     - each checkpoint stores `last_block_hash`, and the indexer halts on `REORG_DETECTED`.
2. The web is optional, from the same commit. Its only change is `lib/supabase/types.ts`, so there is no runtime change.
3. Start the indexer. It resumes from the step 3 `last_block`. The first run accepts the NULL `last_block_hash`, and the first checkpoint fills it.

## 8. Post-checks (first 15–30 min)

- The indexer log shows no `❌` and no `REORG_DETECTED`. Then check the cursor:
  ```sql
  select chain_id, last_block, last_block_hash is not null as has_hash from public.indexer_state;
  ```
  `last_block` advances and `has_hash` becomes `t` after the first checkpoint.
- If there was a sale: `select total_volume, total_sales from public.collections where chain_id = 99801;` grew by exactly the new Sales. The activity row and the stats are written in one transaction.
- If there was a bid:
  ```sql
  select count(*) filter (where tx_hash is not null), count(*) from public.token_bids;
  ```
  New rows carry `tx_hash`; the legacy rows keep NULL. The same holds for `collection_bids`.
- Web smoke test on Elysium: a collection page (listings, bids, floor), a token page (bids, the market view) and a user page (bids).
- `consecutiveFailedRuns` in the logs stays at 0.

## F. If a migration fails during step 4

Each file is one transaction. A failure leaves the database exactly as it was after the previous file.

| Failure | Action |
|---|---|
| `… preflight failed: …` | No change. The message gives the reason (and counts). Either fix the cause with a reviewed one-off SQL and re-run the same file, **or** stop and roll back the files already applied (§R option A). Never edit a committed migration. |
| `55P03` lock timeout | No change. Clear the blocker and re-run the same file. |
| Re-running a file | All 5 are re-runnable. A second run is a verified no-op, with the same fingerprint. Its expected NOTICEs: file 2 gives 7× `function … does not exist, skipping`; file 3 gives 9× `… already exists, skipping`; file 4 gives 1× `column "last_block_hash" … already exists, skipping`. |
| Something unexpected after some files succeeded | Keep the indexer **stopped**. Fix forward, or roll back (§R option A). Do not start any indexer on a partially migrated schema. |

## R. Rollback

**Option A (preferred): `phase3b_down.sql`, schema only, keeps the data.** Rehearsed on the empty baseline and on the restored backup: the result is the exact `catalog_fingerprint.after.txt` with identical row counts, and a re-apply is again exactly `after_phase3b.txt`.

1. Stop the indexer.
2. Run:
   ```sh
   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f packages/database/scripts/rollback/phase3b_down.sql
   psql "$PROD_DB_URL" -X -q -c "notify pgrst, 'reload schema';"
   ```
   - It is one transaction.
   - It refuses on a database without `indexer_record_sale`. After a *partial* 3B apply, use `-v force=1`: every step is `IF EXISTS`/catalog-guarded.
   - It also refuses if `contract_indexer_state` has the same address on two chains.
   - **It loses:** `last_block_hash`, the bid event identity (`tx_hash`, `log_index`, `block_number`, `placed_quantity`) and every `collection_bid_fills` row.
   - **It keeps:** every bid row with its current `quantity` and `is_active`, and every activity row and stat written by the 3B indexer. These are valid Phase 2 data.
3. Verify with `FINGERPRINT-OK` against `catalog_fingerprint.after.txt`. Counts equal step 2.
4. Redeploy the indexer that ran before this window (Phase 2 or 3A), then start it.

**Option B: restore the step 3 backup.** Use it only if option A is impossible. Rehearsed with a post-Phase-2 dump of the restored backup.

1. Stop the indexer. Put the web in maintenance.
2. Run `phase3b_down.sql` **first** (option A, step 2).
   - `phase2_rollback_prepare.sql` alone refuses on a 3B database: `relations remain in public: collection_bid_fills`.
   - Then run:
     ```sh
     psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f packages/database/scripts/rollback/phase2_rollback_prepare.sql
     ```
     It drops the 11 tables, the view and the public functions (29 NOTICEs in the rehearsal).
3. **Suspend `postgres`'s default privileges for anon/authenticated** during the restore. Otherwise every restored table and function gets ALL for anon/authenticated (including EXECUTE on `sec01_save_listing_batch`), because `pg_dump` emits GRANTs but never REVOKEs what the target's default privileges add.

   This was found in the rehearsal: without this step, the restored post-Phase-2 schema was **wide open**.
   ```sh
   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
   alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
   SQL
   pg_restore --list ~/backups/marketplace_phase3b_window.dump \
     | grep -v -E " SCHEMA - public | DEFAULT ACL .* supabase_admin$" > /tmp/rollback3b.toc
   pg_restore -d "$PROD_DB_URL" -L /tmp/rollback3b.toc ~/backups/marketplace_phase3b_window.dump
   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
   alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated;
   alter default privileges for role postgres in schema public grant all on functions to anon, authenticated;
   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
   SQL
   ```
   Note: the dump's own `DEFAULT ACL … postgres` entries are restored too. The final `grant` puts back exactly the baseline defaults; the rehearsal checked `pg_default_acl` before and after.
4. Verify:
   - the fingerprint against `catalog_fingerprint.after.txt`. The only expected differences are the **order** of items inside some ACL arrays (rehearsal: 10 `acl`/`facl` lines). Grantees and privileges must be identical. Check the security-relevant part directly:
     ```sql
     select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
        and a.grantee in ('anon'::regrole, 'authenticated'::regrole) and a.privilege_type <> 'SELECT';   -- expect 0
     select has_function_privilege('anon', 'public.sec01_save_listing_batch(text,text,integer,jsonb)', 'EXECUTE');  -- expect f
     ```
   - row counts equal step 3.
5. Re-add realtime publication membership from your step 2 note, e.g. `alter publication supabase_realtime add table public.activity, …;`.
6. Redeploy the previous indexer and start it.

**Option C:** Supabase PITR to a timestamp before step 4, if your plan has it. It restores the whole database, ACLs included. Then do option B steps 5–6.

## S. Dry-run checklist on staging (same commit)

1. [ ] Restore a fresh production backup into staging or a local stack, as in Phase 2 §S step 2. Apply 090000–091100 if the backup predates Phase 2.
2. [ ] `catalog_fingerprint.sql` gives `FINGERPRINT-OK` against `after.txt`, and the 3B pre-check is all 0.
3. [ ] Apply files 1–5 as in §4. Compare notices and verification results, and time each file.
4. [ ] `FINGERPRINT-OK` against `after_phase3b.txt`. Counts and stats are unchanged.
5. [ ] Run the suites against staging:
   - pgTAP: `pnpm --filter @marketplace/database test:rls -- --workdir <local project>` gives **237/237** (103 SEC-01 + 56 Phase 2 + 78 Phase 3B);
   - real-data round-trip: **19/19** with `capture_counts.sql` before and after;
   - the vitest RLS suite: 22/22;
   - the indexer localdb suite (local stacks only; it refuses non-local URLs): `INDEXER_TEST_SUPABASE_URL=… INDEXER_TEST_SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @marketplace/indexer test:localdb` gives 8/8.
6. [ ] Run the 3B indexer against staging and do §8.
7. [ ] Re-apply files 1–5: no-op, identical fingerprint.
8. [ ] Rehearse §R option A, then re-apply. Optionally rehearse option B, including the default-privileges step.

## T. Locks and duration

Locks were measured in the rehearsal (`pg_locks` of the migrating backend just before `commit`):

| File | Strongest locks | Effect on traffic |
|---|---|---|
| 1 sale RPC | none on tables | none |
| 2 M-5 | none on tables (functions only) | none. Listing writes during the replace use the old or the new trigger body; both are correct for 99801. |
| 3 IDX-7 | ACCESS EXCLUSIVE `token_bids`, `collection_bids`, new `collection_bid_fills` | bid reads and `nfts_market_view` wait for ms |
| 4 cursor tables | ACCESS EXCLUSIVE `indexer_state`, `contract_indexer_state` (type change and PK rebuild) | none (indexer stopped; web never reads them) |
| 5 view | ACCESS EXCLUSIVE `nfts_market_view` | market-view reads wait for ms |

Duration:
- Every file took ≤ 0.38 s wall time locally, including `docker exec`. Against hosted Supabase, add your round-trips. The 5 files together take seconds.
- **Whole window:** 15–30 min. That is stop, verify and backup (5–10), apply and verify (5), deploy (5–10) and post-checks (5).
