-- Audit #20: migration round-trip on a snapshot of real data.
--
-- LOCAL REHEARSAL DATABASE ONLY. Prerequisites, in order:
--   1. restore the production backup into a disposable local database;
--   2. psql -v phase=before -f packages/database/scripts/rehearsal/capture_counts.sql
--   3. apply migrations 20261028090000 .. 20261028091100;
--   4. psql -v phase=after  -f packages/database/scripts/rehearsal/capture_counts.sql
--   5. run this file (psql -f, or `npx supabase test db <this dir> --db-url ...`).
--
-- It lives outside packages/database/tests/ on purpose: an empty-baseline
-- database has no phase2_rehearsal snapshot, and the counts are data-specific.
-- All live data is on Elysium, so the expected chain is 99801 everywhere.
-- Read-only apart from the rolled-back transaction.

begin;

select no_plan();

select has_table('phase2_rehearsal', 'row_counts', 'rehearsal snapshot table exists (run capture_counts.sql before and after)');

select ok(
  exists (select 1 from phase2_rehearsal.row_counts where phase = 'before')
  and exists (select 1 from phase2_rehearsal.row_counts where phase = 'after'),
  'both the before and after snapshots exist'
);

-- Row counts are unchanged for every relation.
select is(
  (select coalesce(string_agg(format('%s: %s -> %s', b.relation, b.n, coalesce(a.n::text, 'missing')), '; '), '')
   from phase2_rehearsal.row_counts b
   left join phase2_rehearsal.row_counts a
     on a.phase = 'after' and a.relation = b.relation and a.chain_id = '*'
   where b.phase = 'before' and b.chain_id = '*' and a.n is distinct from b.n),
  '',
  'every relation has the same row count before and after the migrations'
);

-- The live counts still equal the "after" snapshot (nothing drifted since).
select is(
  (select n from phase2_rehearsal.row_counts where phase = 'after' and relation = 'listings' and chain_id = '*'),
  (select count(*) from public.listings),
  'listings count matches the after snapshot'
);
select is(
  (select n from phase2_rehearsal.row_counts where phase = 'after' and relation = 'token_bids' and chain_id = '*'),
  (select count(*) from public.token_bids),
  'token_bids count matches the after snapshot'
);
select is(
  (select n from phase2_rehearsal.row_counts where phase = 'after' and relation = 'collection_bids' and chain_id = '*'),
  (select count(*) from public.collection_bids),
  'collection_bids count matches the after snapshot'
);

-- Per-chain distributions that existed before are unchanged (activity's text
-- '99801' and integer 99801 both render as 99801).
select is(
  (select coalesce(string_agg(format('%s[%s]: %s -> %s', b.relation, b.chain_id, b.n, coalesce(a.n::text, 'missing')), '; '), '')
   from phase2_rehearsal.row_counts b
   left join phase2_rehearsal.row_counts a
     on a.phase = 'after' and a.relation = b.relation and a.chain_id = b.chain_id
   where b.phase = 'before' and b.chain_id <> '*' and a.n is distinct from b.n),
  '',
  'per-chain row counts are unchanged'
);

-- Every chain_id is 99801.
select is((select count(*)::int from public.listings where chain_id is distinct from 99801), 0, 'every listings.chain_id = 99801');
select is((select count(*)::int from public.nfts where chain_id is distinct from 99801), 0, 'every nfts.chain_id = 99801');
select is((select count(*)::int from public.collections where chain_id is distinct from 99801), 0, 'every collections.chain_id = 99801');
select is((select count(*)::int from public.token_bids where chain_id is distinct from 99801), 0, 'every token_bids.chain_id = 99801 (M-1 backfill)');
select is((select count(*)::int from public.collection_bids where chain_id is distinct from 99801), 0, 'every collection_bids.chain_id = 99801 (M-1 backfill)');
select is((select count(*)::int from public.activity where chain_id is distinct from 99801), 0, 'every activity.chain_id = 99801 (M-4 cast)');
select is((select count(*)::int from public.indexer_state where chain_id is distinct from 99801), 0, 'every indexer_state.chain_id = 99801');
select is(
  (select count(*)::int from public.contract_indexer_state where chain_id is not null and chain_id <> 99801),
  0,
  'every non-null contract_indexer_state.chain_id = 99801'
);

-- Derived identity after 090500.
select is(
  (select count(*)::int from public.listings
   where listing_id is distinct from chain_id::text || ':' || collection_address || '-' || token_id),
  0,
  'every listing_id is <chain>:<collection>-<token>'
);

-- Relationships survived the FK repoint (M-2).
select is(
  (select count(*)::int from public.nfts n
   where not exists (select 1 from public.collections c
                     where c.chain_id = n.chain_id and c.contract_address = n.collection_address)),
  0,
  'every nft has a collection on the same chain'
);
select is(
  (select count(*)::int from (
     select chain_id, collection_address from public.token_bids where collection_address is not null
     union all
     select chain_id, collection_address from public.collection_bids where collection_address is not null) b
   where not exists (select 1 from public.collections c
                     where c.chain_id = b.chain_id and c.contract_address = b.collection_address)),
  0,
  'every bid has a collection on the same chain'
);
select is(
  (select count(*)::int from public.listings l
   where not exists (select 1 from public.nfts n
                     where n.chain_id = l.chain_id and n.collection_address = l.collection_address
                       and n.token_id = l.token_id)),
  0,
  'every listing has its nft row on the same chain'
);

select * from finish();

rollback;
