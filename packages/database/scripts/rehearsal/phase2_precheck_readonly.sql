-- Phase 2 read-only pre-check: every abort condition of the preflights in
-- 20261028090000 .. 20261028091100, as counts. Run it BEFORE the migrations.
--
-- Safe on production: one READ ONLY transaction, SELECTs only, prints
-- counts, never row contents.
--   psql "<db url>" -X -v ON_ERROR_STOP=1 -f phase2_precheck_readonly.sql
-- Expected: every row in the first result has bad = 0. Any non-zero row
-- means that migration would abort (without changing data). Resolve it
-- before the window.

begin transaction read only;

select check_name, bad from (values
  -- 090100 wallet uniqueness
  ('090100 profiles.wallet not lower-case',
     (select count(*) from public.profiles where wallet is not null and wallet <> lower(wallet))),
  ('090100 user_wallets.wallet_address not lower-case',
     (select count(*) from public.user_wallets where wallet_address is not null and wallet_address <> lower(wallet_address))),
  ('090100 profiles.wallet duplicates (case-insensitive)',
     (select count(*) from (select 1 from public.profiles where wallet is not null group by lower(wallet) having count(*) > 1) d)),
  ('090100 user_wallets.wallet_address duplicates (case-insensitive)',
     (select count(*) from (select 1 from public.user_wallets where wallet_address is not null group by lower(wallet_address) having count(*) > 1) d)),
  -- 090300 one wallet per auth user
  ('090300 user_wallets.supabase_user_id duplicates',
     (select count(*) from (select 1 from public.user_wallets group by supabase_user_id having count(*) > 1) d)),
  -- 090500 listing chain identity
  ('090500 listings.chain_id null or <= 0',
     (select count(*) from public.listings where chain_id is null or chain_id <= 0)),
  ('090500 listings.collection_address not canonical',
     (select count(*) from public.listings where collection_address is null or collection_address !~ '^0x[0-9a-f]{40}$')),
  ('090500 listings.token_id not canonical',
     (select count(*) from public.listings where token_id is null or token_id !~ '^(0|[1-9][0-9]{0,77})$')),
  ('090500 listings duplicate (chain_id, collection_address, token_id)',
     (select count(*) from (select 1 from public.listings group by chain_id, collection_address, token_id having count(*) > 1) d)),
  ('090500 listings tx hash shared by two sellers on one chain',
     (select count(*) from (select 1 from public.listings where tx_hash is not null and seller_wallet is not null
                            group by chain_id, lower(tx_hash) having count(distinct lower(seller_wallet)) > 1) d)),
  -- 090700 M-1
  ('090700 bids referencing a collection not on 99801',
     (select count(*) from (select collection_address from public.token_bids where collection_address is not null
                            union all select collection_address from public.collection_bids where collection_address is not null) b
      where exists (select 1 from public.collections c where c.contract_address = b.collection_address and c.chain_id <> 99801))),
  -- 090800 M-2
  ('090800 nfts whose collection row is on another chain',
     (select count(*) from public.nfts n where not exists (
        select 1 from public.collections c where c.chain_id = n.chain_id and c.contract_address = n.collection_address))),
  ('090800 FKs into collections other than nfts/token_bids/collection_bids on contract_address',
     (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.collections'::regclass
        and (c.conrelid not in ('public.nfts'::regclass, 'public.token_bids'::regclass, 'public.collection_bids'::regclass)
             or c.confkey <> array[(select attnum from pg_attribute where attrelid = 'public.collections'::regclass and attname = 'contract_address')]::int2[]))),
  -- 090900 M-4 (pre-migration column type is text)
  ('090900 activity.chain_id null',
     (select count(*) from public.activity where chain_id is null)),
  ('090900 activity.chain_id not a lossless positive int4',
     (select count(*) from public.activity
      where case when chain_id::text ~ '^[1-9][0-9]{0,9}$' then chain_id::text::bigint > 2147483647 else true end)),
  -- 091000 M-6
  ('091000 indexer_state duplicate chain_id',
     (select count(*) from (select 1 from public.indexer_state group by chain_id having count(*) > 1) d))
) as t(check_name, bad)
order by check_name;

-- Informational (record these in the change log; compare after the window).
select 'server_version_num' as item, current_setting('server_version_num') as value
union all select 'activity.chain_id type', format_type(atttypid, atttypmod)
  from pg_attribute where attrelid = 'public.activity'::regclass and attname = 'chain_id'
union all select 'distinct chain_ids (listings, nfts, collections, activity, indexer_state)',
  (select string_agg(distinct x, ',') from (
     select chain_id::text x from public.listings union all select chain_id::text from public.nfts
     union all select chain_id::text from public.collections union all select chain_id::text from public.activity
     union all select chain_id::text from public.indexer_state) s)
union all select 'indexer_state (chain_id:last_block)',
  (select string_agg(chain_id || ':' || coalesce(last_block::text, 'null'), ',') from public.indexer_state)
union all select 'realtime publication tables (public)',
  (select coalesce(string_agg(pubname || ':' || tablename, ',' order by pubname, tablename), '<none>')
   from pg_publication_tables where schemaname = 'public')
union all select 'pg_cron installed',
  (select case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'yes: run  select jobid, schedule, command from cron.job;' else 'no' end);

-- Row counts.
select 'activity' as relation, count(*) from public.activity
union all select 'collection_bids', count(*) from public.collection_bids
union all select 'collections', count(*) from public.collections
union all select 'contract_indexer_state', count(*) from public.contract_indexer_state
union all select 'indexer_state', count(*) from public.indexer_state
union all select 'listings', count(*) from public.listings
union all select 'nfts', count(*) from public.nfts
union all select 'nonces', count(*) from public.nonces
union all select 'profiles', count(*) from public.profiles
union all select 'token_bids', count(*) from public.token_bids
union all select 'user_wallets', count(*) from public.user_wallets
order by 1;

rollback;
