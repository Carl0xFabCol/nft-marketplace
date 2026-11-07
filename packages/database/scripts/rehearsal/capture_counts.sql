-- Phase 2 rehearsal: snapshot row counts per relation and per chain_id.
--
-- LOCAL REHEARSAL DATABASE ONLY. This creates a schema
-- (phase2_rehearsal) and writes to it. Never run it against production; the
-- runbook uses read-only SELECTs there instead.
--
-- Usage (psql, as postgres):
--   psql -v phase=before -f capture_counts.sql   -- after restore, before migrations
--   psql -v phase=after  -f capture_counts.sql   -- after all migrations
-- packages/database/tests-realdata/phase2_roundtrip.test.sql compares the two.
--
-- Prints counts only, never row contents.

\if :{?phase}
\else
  \echo 'set -v phase=before|after'
  \quit
\endif

create schema if not exists phase2_rehearsal;

create table if not exists phase2_rehearsal.row_counts (
  phase text not null,
  relation text not null,
  chain_id text not null,   -- '*' = whole table; text so activity's pre-M-4 text values fit
  n bigint not null,
  captured_at timestamptz not null default now(),
  primary key (phase, relation, chain_id)
);

delete from phase2_rehearsal.row_counts where phase = :'phase';

insert into phase2_rehearsal.row_counts (phase, relation, chain_id, n)
select :'phase', t.relation, '*', t.n
from (
  select 'activity' as relation, count(*) as n from public.activity
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
  union all select 'nfts_market_view', count(*) from public.nfts_market_view
) t;

-- Per-chain distribution for the tables that have chain_id. The bid tables
-- only get chain_id from M-1, so their per-chain rows exist only in the
-- "after" snapshot.
insert into phase2_rehearsal.row_counts (phase, relation, chain_id, n)
select :'phase', relation, coalesce(chain_id, '<null>'), count(*)
from (
  select 'activity' as relation, chain_id::text as chain_id from public.activity
  union all select 'collections', chain_id::text from public.collections
  union all select 'contract_indexer_state', chain_id::text from public.contract_indexer_state
  union all select 'indexer_state', chain_id::text from public.indexer_state
  union all select 'listings', chain_id::text from public.listings
  union all select 'nfts', chain_id::text from public.nfts
) t
group by relation, chain_id;

-- Bid chain distribution, only once the column exists (after M-1).
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'token_bids' and column_name = 'chain_id'
) as has_bid_chain \gset
\if :has_bid_chain
insert into phase2_rehearsal.row_counts (phase, relation, chain_id, n)
select :'phase', relation, coalesce(chain_id, '<null>'), count(*)
from (
  select 'token_bids' as relation, chain_id::text as chain_id from public.token_bids
  union all select 'collection_bids', chain_id::text from public.collection_bids
) t
group by relation, chain_id;
\endif

select relation, chain_id, n
from phase2_rehearsal.row_counts
where phase = :'phase'
order by relation, chain_id;
