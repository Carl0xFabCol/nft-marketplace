-- Phase 2 ROLLBACK, step 1 of 2: clear the public schema objects so the
-- pre-Phase-2 backup (pg_dump -Fc, public schema only) can be restored.
--
-- DESTRUCTIVE. It drops the 11 application tables WITH THEIR DATA, the
-- nfts_market_view view, and every non-extension function in public. Run it
-- only as part of docs/PHASE2_RUNBOOK.md "Rollback", with the indexer
-- stopped, the old code ready, and a verified backup in hand.
--
-- Why it exists: a plain `pg_restore --clean` cannot roll Phase 2 back. The
-- backup only knows the pre-M-2 FK names, so --clean leaves the new
-- *_chain_collection_fkey FKs in place, cannot drop collections, and ends
-- with a mixed schema (found in the local rehearsal, 2026-11-07).
--
-- Guards (the whole script is one transaction and changes nothing if one fails):
--   * the database must look post-Phase-2 (collections_chain_contract_key exists);
--     pass -v force=1 to skip this check (e.g. after a partially applied migration);
--   * no object outside public may depend on the tables being dropped (such an
--     object would be dropped silently by CASCADE).
-- Realtime publication membership is lost with the tables; the runbook
-- re-adds it from the list recorded in the pre-checks.
--
-- Step 2 is the pg_restore of the backup with the filtered TOC (see the runbook).

\set ON_ERROR_STOP on
\if :{?force}
\else
  \set force 0
\endif

begin;

set local lock_timeout = '10s';

select set_config('phase2.force', :'force', true) as force_flag;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.collections') and conname = 'collections_chain_contract_key'
  ) and current_setting('phase2.force', true) is distinct from '1' then
    raise exception 'rollback prepare: collections_chain_contract_key not found; this does not look like a post-Phase-2 database. Re-run with -v force=1 only if you are sure.';
  end if;
end
$$;

do $$
declare
  v_list text;
begin
  -- Objects outside public that depend on the public tables/view (views,
  -- FKs, triggers, policies...) would be dropped silently by CASCADE.
  -- Each dependent object is resolved to the schema that owns it. Unknown
  -- object kinds resolve to NULL and also abort (fail closed). Publication
  -- membership is expected; the runbook re-adds it.
  with deps as (
    select d.classid, d.objid,
      case d.classid
        when 'pg_class'::regclass      then (select c.relnamespace from pg_class c where c.oid = d.objid)
        when 'pg_constraint'::regclass then (select c.relnamespace from pg_constraint r join pg_class c on c.oid = r.conrelid where r.oid = d.objid)
        when 'pg_trigger'::regclass    then (select c.relnamespace from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.oid = d.objid)
        when 'pg_rewrite'::regclass    then (select c.relnamespace from pg_rewrite w join pg_class c on c.oid = w.ev_class where w.oid = d.objid)
        when 'pg_attrdef'::regclass    then (select c.relnamespace from pg_attrdef a join pg_class c on c.oid = a.adrelid where a.oid = d.objid)
        when 'pg_policy'::regclass     then (select c.relnamespace from pg_policy p join pg_class c on c.oid = p.polrelid where p.oid = d.objid)
        when 'pg_type'::regclass       then (select y.typnamespace from pg_type y where y.oid = d.objid)
        when 'pg_proc'::regclass       then (select p.pronamespace from pg_proc p where p.oid = d.objid)
      end as owner_ns
    from pg_depend d
    join pg_class t on t.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
    where t.relnamespace = 'public'::regnamespace
      and t.relname in ('activity', 'collection_bids', 'collections', 'contract_indexer_state', 'indexer_state',
                        'listings', 'nfts', 'nonces', 'profiles', 'token_bids', 'user_wallets', 'nfts_market_view')
      and d.deptype in ('n', 'a')
      and d.classid <> 'pg_publication_rel'::regclass
  )
  select string_agg(distinct format('%s oid %s in schema %s', classid::regclass, objid,
                                    coalesce(owner_ns::regnamespace::text, '<unknown>')), ', ')
    into v_list
  from deps
  where owner_ns is distinct from 'public'::regnamespace;

  if v_list is not null then
    raise exception 'rollback prepare: objects outside public depend on the tables: %. Nothing dropped.', v_list;
  end if;
end
$$;

do $$
declare
  r record;
begin
  drop view if exists public.nfts_market_view;

  for r in
    select c.oid::regclass as tbl
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and c.relname in ('activity', 'collection_bids', 'collections', 'contract_indexer_state', 'indexer_state',
                        'listings', 'nfts', 'nonces', 'profiles', 'token_bids', 'user_wallets')
  loop
    raise notice 'rollback prepare: dropping table %', r.tbl;
    execute format('drop table %s cascade', r.tbl);
  end loop;

  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    raise notice 'rollback prepare: dropping function %', r.fn;
    execute format('drop function %s', r.fn);
  end loop;

  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'S')) then
    raise exception 'rollback prepare: relations remain in public: %',
      (select string_agg(relname, ', ') from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'S'));
  end if;
end
$$;

commit;
