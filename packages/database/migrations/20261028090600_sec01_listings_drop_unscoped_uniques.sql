-- SEC-01 follow-up: finish audit M-3 (chain-scoped listing identity).
--
-- 090500 drops only single-column listing_id uniques. The live schema also has
-- UNIQUE (collection_address, token_id) and UNIQUE (tx_hash,
-- collection_address, token_id). Neither includes chain_id, so the same
-- collection/token cannot be listed on two chains. The indexer upsert and
-- sec01_save_listing_batch then fail with 23505 on the second chain.
-- sec01_listings_chain_identity_key (chain_id, collection_address, token_id)
-- makes both of them redundant.
--
-- Run after 20261028090500. Re-runnable: the drops are discovered from the
-- catalog, and a second run finds nothing to drop.

begin;

do $$
declare
  r record;
begin
  -- Unique constraints on listings that do not include chain_id.
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.listings'::regclass
      and c.contype = 'u'
      and not exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.conrelid
          and a.attnum = any (c.conkey)
          and a.attname = 'chain_id'
      )
  loop
    raise notice 'SEC-01 dropping non-chain-scoped unique constraint %', r.conname;
    execute format('alter table public.listings drop constraint %I', r.conname);
  end loop;

  -- Standalone unique indexes (not backing a constraint) without chain_id.
  for r in
    select i.indexrelid::regclass as index_name
    from pg_index i
    where i.indrelid = 'public.listings'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and not exists (
        select 1
        from pg_attribute a
        where a.attrelid = i.indrelid
          and a.attnum = any (i.indkey::int2[])
          and a.attname = 'chain_id'
      )
  loop
    raise notice 'SEC-01 dropping non-chain-scoped unique index %', r.index_name;
    execute format('drop index %s', r.index_name);
  end loop;
end
$$;

-- Postcondition: no unique constraint and no unique index on public.listings
-- lacks chain_id (the primary key on id is the only exception), and the
-- chain-scoped identity constraint is present.
do $$
declare
  offenders text;
begin
  select string_agg(c.conname, ', ') into offenders
  from pg_constraint c
  where c.conrelid = 'public.listings'::regclass
    and c.contype = 'u'
    and not exists (
      select 1
      from pg_attribute a
      where a.attrelid = c.conrelid
        and a.attnum = any (c.conkey)
        and a.attname = 'chain_id'
    );

  if offenders is not null then
    raise exception
      'SEC-01 postcondition failed: unique constraint(s) on public.listings without chain_id: %',
      offenders;
  end if;

  select string_agg(i.indexrelid::regclass::text, ', ') into offenders
  from pg_index i
  where i.indrelid = 'public.listings'::regclass
    and i.indisunique
    and not i.indisprimary
    and not exists (
      select 1
      from pg_attribute a
      where a.attrelid = i.indrelid
        and a.attnum = any (i.indkey::int2[])
        and a.attname = 'chain_id'
    );

  if offenders is not null then
    raise exception
      'SEC-01 postcondition failed: unique index(es) on public.listings without chain_id: %',
      offenders;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.listings'::regclass
      and conname = 'sec01_listings_chain_identity_key'
      and contype = 'u'
  ) then
    raise exception 'SEC-01 postcondition failed: sec01_listings_chain_identity_key is missing';
  end if;
end
$$;

commit;
