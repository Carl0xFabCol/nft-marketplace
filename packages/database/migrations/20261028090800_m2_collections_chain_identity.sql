-- Audit M-2 (DB-2): collections identity becomes (chain_id, contract_address).
--
-- Before: collections is unique on contract_address alone, enforced twice:
-- by the constraint collections_contract_address_unique and by the standalone
-- unique index collections_contract_address_idx. nfts, token_bids and
-- collection_bids each have a single-column FK (collection_address) ->
-- collections(contract_address). So one collection address cannot exist on
-- two chains.
--
-- This migration:
--   1. adds collections_chain_contract_key UNIQUE (chain_id, contract_address);
--   2. finds every FK that references collections(contract_address) in the
--      catalog (no hardcoded names), and recreates each one as
--      (chain_id, collection_address) -> collections(chain_id, contract_address),
--      keeping its ON UPDATE / ON DELETE actions, match type and deferrability.
--      A SET NULL / SET DEFAULT delete action is limited to collection_address
--      (PG15+ column list) so chain_id is never nulled. Baseline nfts FK:
--      ON UPDATE CASCADE ON DELETE SET DEFAULT;
--   3. drops every unique constraint / unique index on collections whose key
--      is exactly (contract_address).
--
-- Depends on: 20261028090700 (M-1): the bid tables need chain_id NOT NULL.
-- Code coupling: after this, upsert(onConflict: "contract_address") fails with
--   42P10. Deploy CollectionsRepository (onConflict "chain_id,contract_address")
--   with it, and keep the indexer stopped in between.
-- Re-runnable: the composite unique is guarded, FKs already on the composite
--   key are left alone, and the drops are found in the catalog.
-- Transactional: a preflight failure raises, and nothing is changed.

begin;

set local lock_timeout = '5s';

-- Preflight.
do $$
declare
  v_count bigint;
  v_list text;
  v_addr int2 := (select attnum from pg_attribute
                  where attrelid = 'public.collections'::regclass and attname = 'contract_address');
  v_chain int2 := (select attnum from pg_attribute
                   where attrelid = 'public.collections'::regclass and attname = 'chain_id');
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.token_bids'::regclass and attname = 'chain_id' and attnotnull and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.collection_bids'::regclass and attname = 'chain_id' and attnotnull and not attisdropped
  ) then
    raise exception 'M-2 preflight failed: bid tables have no NOT NULL chain_id; apply 20261028090700 (M-1) first. No data changed.';
  end if;

  select count(*) into v_count
  from (
    select 1 from public.collections
    group by chain_id, contract_address
    having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M-2 preflight failed: % duplicate (chain_id, contract_address) group(s) in collections. No data changed.', v_count;
  end if;

  -- Children whose (chain_id, collection_address) has no parent would fail the new FKs.
  select count(*) into v_count
  from public.nfts n
  where not exists (
    select 1 from public.collections c
    where c.chain_id = n.chain_id and c.contract_address = n.collection_address
  );
  if v_count > 0 then
    raise exception 'M-2 preflight failed: % nfts row(s) have no collections row on the same chain. No data changed.', v_count;
  end if;

  select count(*) into v_count
  from (
    select chain_id, collection_address from public.token_bids where collection_address is not null
    union all
    select chain_id, collection_address from public.collection_bids where collection_address is not null
  ) b
  where not exists (
    select 1 from public.collections c
    where c.chain_id = b.chain_id and c.contract_address = b.collection_address
  );
  if v_count > 0 then
    raise exception 'M-2 preflight failed: % bid row(s) have no collections row on the same chain. No data changed.', v_count;
  end if;

  -- Every FK into collections must be one we know how to repoint: from nfts,
  -- token_bids or collection_bids, on (contract_address) (to be repointed) or
  -- already on (chain_id, contract_address) (left alone).
  select string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ') into v_list
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.collections'::regclass
    and (
      c.conrelid not in ('public.nfts'::regclass, 'public.token_bids'::regclass, 'public.collection_bids'::regclass)
      or not (c.confkey = array[v_addr] or c.confkey = array[v_chain, v_addr])
    );
  if v_list is not null then
    raise exception 'M-2 preflight failed: unexpected foreign key(s) into collections: %. Review before migrating. No data changed.', v_list;
  end if;

  -- An ON UPDATE SET NULL / SET DEFAULT cannot be scoped to one column and
  -- would null chain_id; refuse rather than change semantics silently.
  select string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ') into v_list
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.collections'::regclass
    and c.confkey = array[v_addr]
    and c.confupdtype in ('n', 'd');
  if v_list is not null then
    raise exception 'M-2 preflight failed: FK(s) with ON UPDATE SET NULL/SET DEFAULT: %. No data changed.', v_list;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass and conname = 'collections_chain_contract_key'
  ) then
    alter table public.collections
      add constraint collections_chain_contract_key unique (chain_id, contract_address);
  end if;
end
$$;

-- Repoint the single-column FKs to the composite key.
do $$
declare
  r record;
  v_addr int2 := (select attnum from pg_attribute
                  where attrelid = 'public.collections'::regclass and attname = 'contract_address');
  v_child_col text;
  v_upd text;
  v_del text;
  v_match text;
  v_defer text;
  v_new_name text;
begin
  for r in
    select c.conname, c.conrelid, c.conrelid::regclass as tbl, c.conkey,
           c.confupdtype, c.confdeltype, c.confmatchtype, c.condeferrable, c.condeferred
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.collections'::regclass
      and c.confkey = array[v_addr]
    order by c.conrelid::regclass::text
  loop
    select a.attname into v_child_col
    from pg_attribute a
    where a.attrelid = r.conrelid and a.attnum = r.conkey[1];

    if array_length(r.conkey, 1) <> 1 or v_child_col <> 'collection_address' then
      raise exception 'M-2: FK %.% is on column(s) %, expected collection_address', r.tbl, r.conname, v_child_col;
    end if;

    v_upd := case r.confupdtype
      when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' end;
    v_del := case r.confdeltype
      when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
      when 'n' then 'set null (collection_address)'
      when 'd' then 'set default (collection_address)' end;
    v_match := case r.confmatchtype when 'f' then 'match full' else 'match simple' end;
    v_defer := case
      when not r.condeferrable then 'not deferrable'
      when r.condeferred then 'deferrable initially deferred'
      else 'deferrable initially immediate' end;
    v_new_name := (select relname from pg_class where oid = r.conrelid) || '_chain_collection_fkey';

    raise notice 'M-2 repointing %.% -> % (chain_id, collection_address) on update % on delete % % %',
      r.tbl, r.conname, v_new_name, v_upd, v_del, v_match, v_defer;

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (chain_id, collection_address) '
      'references public.collections (chain_id, contract_address) %s on update %s on delete %s %s',
      r.tbl, v_new_name, v_match, v_upd, v_del, v_defer);
  end loop;
end
$$;

-- Drop the address-only uniques (constraints first, then standalone indexes).
do $$
declare
  r record;
  v_addr int2 := (select attnum from pg_attribute
                  where attrelid = 'public.collections'::regclass and attname = 'contract_address');
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.collections'::regclass
      and c.contype = 'u'
      and c.conkey = array[v_addr]
  loop
    raise notice 'M-2 dropping address-only unique constraint %', r.conname;
    execute format('alter table public.collections drop constraint %I', r.conname);
  end loop;

  for r in
    select i.indexrelid::regclass as index_name
    from pg_index i
    where i.indrelid = 'public.collections'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and i.indnkeyatts = 1
      and i.indkey[0] = v_addr
  loop
    raise notice 'M-2 dropping address-only unique index %', r.index_name;
    execute format('drop index %s', r.index_name);
  end loop;
end
$$;

-- Postcondition.
do $$
declare
  v_addr int2 := (select attnum from pg_attribute
                  where attrelid = 'public.collections'::regclass and attname = 'contract_address');
  v_chain int2 := (select attnum from pg_attribute
                   where attrelid = 'public.collections'::regclass and attname = 'chain_id');
  v_list text;
  t text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass
      and conname = 'collections_chain_contract_key'
      and contype = 'u'
      and conkey = array[v_chain, v_addr]
  ) then
    raise exception 'M-2 postcondition failed: collections_chain_contract_key (chain_id, contract_address) missing';
  end if;

  select string_agg(i.indexrelid::regclass::text, ', ') into v_list
  from pg_index i
  where i.indrelid = 'public.collections'::regclass
    and i.indisunique and not i.indisprimary
    and not (v_chain = any (i.indkey::int2[]));
  if v_list is not null then
    raise exception 'M-2 postcondition failed: unique index(es) on collections without chain_id: %', v_list;
  end if;

  select string_agg(format('%s.%s', conrelid::regclass, conname), ', ') into v_list
  from pg_constraint
  where contype = 'f' and confrelid = 'public.collections'::regclass
    and (confkey <> array[v_chain, v_addr] or not convalidated);
  if v_list is not null then
    raise exception 'M-2 postcondition failed: FK(s) into collections not on a validated (chain_id, contract_address): %', v_list;
  end if;

  foreach t in array array['nfts', 'token_bids', 'collection_bids'] loop
    if not exists (
      select 1 from pg_constraint
      where contype = 'f'
        and conrelid = format('public.%I', t)::regclass
        and confrelid = 'public.collections'::regclass
        and confkey = array[v_chain, v_addr]
    ) then
      raise exception 'M-2 postcondition failed: public.% has no FK to collections (chain_id, contract_address)', t;
    end if;
  end loop;
end
$$;

commit;
