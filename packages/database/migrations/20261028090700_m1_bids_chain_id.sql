-- Audit M-1 (DB-1, IDX-6): give token_bids and collection_bids a chain identity.
--
-- Before: neither bid table has chain_id, so bids from two chains share rows,
-- and the "one active bid per bidder" partial uniques
--   idx_token_bids_unique_active      (collection_address, token_id, bidder_wallet) WHERE is_active
--   idx_collection_bids_unique_active (collection_address, bidder_wallet)           WHERE is_active
-- collide across chains.
--
-- This migration:
--   1. adds chain_id integer to both tables;
--   2. backfills 99801 (Elysium) - the only chain with data. The preflight
--      proves it: every bid's collection must be a 99801 collection;
--   3. sets chain_id NOT NULL and CHECK (chain_id > 0);
--   4. replaces every unique index/constraint on the bid tables that lacks
--      chain_id (found through the catalog) with a chain-scoped partial unique
--      that has the same predicate.
--
-- Depends on: the baseline schema. Independent of 090000-090600.
-- Required before: 20261028090800 (M-2), which points the bid FKs at
--   collections (chain_id, contract_address).
-- Code coupling: once this runs, an insert without chain_id fails with 23502.
--   Deploy apps/indexer BidsRepository (chain_id on insertCollectionBid /
--   insertTokenBid) together with it, and keep the indexer stopped in between.
-- Re-runnable: the column is added with IF NOT EXISTS, the backfill only
--   touches NULLs, and constraints/indexes are guarded or found in the catalog.
-- Transactional: a preflight failure raises, and the whole transaction,
--   including the column add, rolls back.

begin;

set local lock_timeout = '5s';

alter table public.token_bids add column if not exists chain_id integer;
alter table public.collection_bids add column if not exists chain_id integer;

-- Preflight: the 99801 backfill must be correct for every row it touches.
do $$
declare
  v_wrong_chain bigint;
  v_null_collection bigint;
begin
  select count(*) into v_wrong_chain
  from (
    select b.collection_address from public.token_bids b
    where b.chain_id is null and b.collection_address is not null
    union all
    select b.collection_address from public.collection_bids b
    where b.chain_id is null and b.collection_address is not null
  ) b
  where exists (
    select 1 from public.collections c
    where c.contract_address = b.collection_address
      and c.chain_id <> 99801
  );

  if v_wrong_chain > 0 then
    raise exception
      'M-1 preflight failed: % bid row(s) reference a collection whose chain_id is not 99801; backfilling 99801 would be wrong. No data changed.',
      v_wrong_chain;
  end if;

  select
    (select count(*) from public.token_bids where chain_id is null and collection_address is null)
    + (select count(*) from public.collection_bids where chain_id is null and collection_address is null)
  into v_null_collection;

  if v_null_collection > 0 then
    raise notice 'M-1: % bid row(s) have no collection_address; they are backfilled with 99801 too (all live data is Elysium)',
      v_null_collection;
  end if;
end
$$;

do $$
declare
  v_tb bigint;
  v_cb bigint;
begin
  update public.token_bids set chain_id = 99801 where chain_id is null;
  get diagnostics v_tb = row_count;
  update public.collection_bids set chain_id = 99801 where chain_id is null;
  get diagnostics v_cb = row_count;
  raise notice 'M-1 backfilled chain_id = 99801: token_bids % row(s), collection_bids % row(s)', v_tb, v_cb;
end
$$;

alter table public.token_bids alter column chain_id set not null;
alter table public.collection_bids alter column chain_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.token_bids'::regclass and conname = 'token_bids_chain_id_positive'
  ) then
    alter table public.token_bids
      add constraint token_bids_chain_id_positive check (chain_id > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_bids'::regclass and conname = 'collection_bids_chain_id_positive'
  ) then
    alter table public.collection_bids
      add constraint collection_bids_chain_id_positive check (chain_id > 0);
  end if;
end
$$;

-- Chain-scoped "one active bid per bidder" uniques. Same predicate as the
-- baseline indexes, with chain_id leading.
create unique index if not exists idx_token_bids_unique_active_chain
  on public.token_bids (chain_id, collection_address, token_id, bidder_wallet)
  where (is_active = true);

create unique index if not exists idx_collection_bids_unique_active_chain
  on public.collection_bids (chain_id, collection_address, bidder_wallet)
  where (is_active = true);

-- Drop every unique constraint / standalone unique index on the bid tables
-- that does not include chain_id (today: idx_token_bids_unique_active and
-- idx_collection_bids_unique_active). Primary keys are kept.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.conrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass)
      and c.contype = 'u'
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname = 'chain_id'
      )
  loop
    raise notice 'M-1 dropping non-chain-scoped unique constraint %.%', r.tbl, r.conname;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  for r in
    select i.indexrelid::regclass as index_name
    from pg_index i
    where i.indrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass)
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]) and a.attname = 'chain_id'
      )
  loop
    raise notice 'M-1 dropping non-chain-scoped unique index %', r.index_name;
    execute format('drop index %s', r.index_name);
  end loop;
end
$$;

-- Postcondition.
do $$
declare
  t text;
  v_offenders text;
begin
  foreach t in array array['token_bids', 'collection_bids'] loop
    if not exists (
      select 1 from pg_attribute
      where attrelid = format('public.%I', t)::regclass
        and attname = 'chain_id' and not attisdropped and attnotnull
        and atttypid = 'integer'::regtype
    ) then
      raise exception 'M-1 postcondition failed: public.%.chain_id is not an integer NOT NULL column', t;
    end if;

    if exists (select 1 from public.token_bids where chain_id is null)
       or exists (select 1 from public.collection_bids where chain_id is null) then
      raise exception 'M-1 postcondition failed: NULL chain_id remains';
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and conname = t || '_chain_id_positive' and contype = 'c' and convalidated
    ) then
      raise exception 'M-1 postcondition failed: %_chain_id_positive missing or not validated', t;
    end if;

    select string_agg(i.indexrelid::regclass::text, ', ') into v_offenders
    from pg_index i
    where i.indrelid = format('public.%I', t)::regclass
      and i.indisunique and not i.indisprimary
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]) and a.attname = 'chain_id'
      );
    if v_offenders is not null then
      raise exception 'M-1 postcondition failed: unique index(es) on public.% without chain_id: %', t, v_offenders;
    end if;
  end loop;

  if to_regclass('public.idx_token_bids_unique_active_chain') is null
     or to_regclass('public.idx_collection_bids_unique_active_chain') is null then
    raise exception 'M-1 postcondition failed: chain-scoped active-bid unique index missing';
  end if;
end
$$;

commit;
