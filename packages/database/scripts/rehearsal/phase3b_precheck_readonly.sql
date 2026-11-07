-- Phase 3B read-only pre-check: every abort condition of the preflights in
-- 20261028091200 .. 20261028091600, as counts, plus the facts the runbook
-- records before the window. Run it BEFORE the migrations.
--
-- Safe on production: one READ ONLY transaction, SELECTs on the catalog and
-- counts only; it never prints row contents.
--   psql "<db url>" -X -v ON_ERROR_STOP=1 -f phase3b_precheck_readonly.sql
-- Expected: every row of the first result has bad = 0. A non-zero row means
-- that migration would abort (without changing data). Resolve it before the
-- window. The second result is informational: copy it into the change log.

begin transaction read only;

select check_name, bad from (values
  -- Phase 2 must be in place (the 3B preflights also check these).
  ('phase2 applied: collections_chain_contract_key missing',
     (select count(*) from (select 1 where not exists (
        select 1 from pg_constraint where conrelid = 'public.collections'::regclass and conname = 'collections_chain_contract_key')) x)),
  ('phase2 applied: indexer_state_chain_id_key missing',
     (select count(*) from (select 1 where not exists (
        select 1 from pg_constraint where conrelid = 'public.indexer_state'::regclass and conname = 'indexer_state_chain_id_key')) x)),
  ('phase2 applied: activity.chain_id is not integer',
     (select count(*) from pg_attribute where attrelid = 'public.activity'::regclass and attname = 'chain_id'
        and format_type(atttypid, atttypmod) <> 'integer')),
  ('phase2 applied: listings/bids chain_id nullable',
     (select 3 - count(*) from pg_attribute
       where attrelid in ('public.listings'::regclass, 'public.token_bids'::regclass, 'public.collection_bids'::regclass)
         and attname = 'chain_id' and attnotnull and not attisdropped)),
  ('phase2 applied: chain-scoped active-bid uniques missing',
     (select 2 - count(*) from pg_class where oid in (
        coalesce(to_regclass('public.idx_token_bids_unique_active_chain'), 0::oid),
        coalesce(to_regclass('public.idx_collection_bids_unique_active_chain'), 0::oid)))),
  ('091200 activity has no unique index on (tx_hash, log_index)',
     (select count(*) from (select 1 where not exists (
        select 1 from pg_index i where i.indrelid = 'public.activity'::regclass and i.indisunique and i.indpred is null
          and (select array_agg(a.attname::text order by k.ord)
               from unnest(i.indkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['tx_hash', 'log_index'])) x)),
  -- 091300: catalog dependents of the signatures it drops.
  ('091300 catalog objects depending on an old M-5 signature',
     (select count(*) from pg_depend d
       where d.refclassid = 'pg_proc'::regclass and d.deptype = 'n'
         and d.refobjid in (
           select oid from pg_proc where oid::regprocedure::text in (
             'increment_collection_stats(text,numeric,integer)', 'get_collection_stats(text)',
             'update_collection_floor_price(text)', 'get_top_collections(integer,text)',
             'cleanup_expired_listings()', 'cleanup_expired_token_bids()', 'cleanup_expired_collection_bids()')))),
  -- 091400
  ('091400 collection_bid_fills exists without its primary key',
     (select count(*) from (select 1 where to_regclass('public.collection_bid_fills') is not null
        and not exists (select 1 from pg_constraint where conrelid = to_regclass('public.collection_bid_fills') and conname = 'collection_bid_fills_pkey')) x)),
  ('091400 bid columns tx_hash/log_index/block_number/placed_quantity with an unexpected type',
     (select count(*) from pg_attribute
       where attrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass) and not attisdropped
         and ((attname = 'tx_hash' and atttypid <> 'text'::regtype)
           or (attname = 'log_index' and atttypid <> 'integer'::regtype)
           or (attname = 'block_number' and atttypid <> 'bigint'::regtype)
           or (attname = 'placed_quantity' and atttypid <> 'bigint'::regtype)))),
  -- 091500
  ('091500 contract_indexer_state.chain_id NULL or <= 0',
     (select count(*) from public.contract_indexer_state where chain_id is null or chain_id <= 0)),
  ('091500 contract_indexer_state duplicate (chain_id, contract_address)',
     (select count(*) from (select 1 from public.contract_indexer_state group by chain_id, contract_address having count(*) > 1) d)),
  ('091500 indexer_state.chain_id not a positive int4',
     (select count(*) from public.indexer_state
       where chain_id::numeric <> trunc(chain_id::numeric) or chain_id::numeric <= 0 or chain_id::numeric > 2147483647)),
  ('091500 indexer_state.last_block_hash exists with a non-text type',
     (select count(*) from pg_attribute where attrelid = 'public.indexer_state'::regclass and attname = 'last_block_hash'
        and not attisdropped and atttypid <> 'text'::regtype)),
  -- 091600
  ('091600 nfts_market_view columns differ from the expected list',
     (select count(*) from (select 1 where (
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
        from pg_attribute where attrelid = to_regclass('public.nfts_market_view') and attnum > 0 and not attisdropped
      ) is distinct from
        'id uuid, collection_address text, token_id text, owner_wallet text, name text, image_url text, metadata jsonb, chain_id integer, '
        'listing_price numeric(78,0), listing_seller text, listing_expires_at timestamp with time zone, listing_id text, '
        'best_token_bid numeric(78,0), best_token_bidder text, best_collection_bid numeric(78,0)') x))
) as t(check_name, bad)
order by check_name;

-- Informational (record before the window, compare after).
select item, value from (values
  ('3B already applied? (indexer_record_sale exists)',
     (to_regprocedure('public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)') is not null)::text),
  ('pg_cron installed', (select count(*) from pg_extension where extname = 'pg_cron')::text),
  ('rows: activity / token_bids / collection_bids / collections',
     (select count(*) from public.activity)::text || ' / ' || (select count(*) from public.token_bids)::text || ' / '
     || (select count(*) from public.collection_bids)::text || ' / ' || (select count(*) from public.collections)::text),
  ('active bids: token / collection',
     (select count(*) from public.token_bids where is_active)::text || ' / ' || (select count(*) from public.collection_bids where is_active)::text),
  ('collection stats (chain:volume/sales)',
     (select coalesce(string_agg(chain_id || ':' || coalesce(total_volume::text, 'null') || '/' || coalesce(total_sales::text, 'null'), ', ' order by chain_id, contract_address), '-')
      from public.collections)),
  ('indexer cursor (chain:last_block)',
     (select coalesce(string_agg(chain_id::text || ':' || coalesce(last_block::text, 'null'), ', '), '-') from public.indexer_state)),
  ('contract_indexer_state rows', (select count(*) from public.contract_indexer_state)::text),
  ('realtime publication tables',
     (select coalesce(string_agg(tablename, ', ' order by tablename), '-') from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'))
) as t(item, value);

-- 091300: pg_cron jobs that call a function whose signature changes. Expected 0.
-- Runs only when cron.job exists.
select (to_regclass('cron.job') is not null) as has_cron_job \gset
\if :has_cron_job
select '091300 pg_cron jobs calling a changed M-5 function' as check_name, count(*) as bad
from cron.job
where command ~* '(increment_collection_stats|get_collection_stats|update_collection_floor_price|get_top_collections|cleanup_expired_(listings|token_bids|collection_bids))';
\else
\echo '091300 pg_cron: cron.job does not exist (bad = 0)'
\endif

rollback;
