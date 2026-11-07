-- Audit M-5 (DB-5): chain-scoped collection RPCs.
--
-- Before: increment_collection_stats, get_collection_stats,
-- update_collection_floor_price, get_top_collections and the three
-- cleanup_expired_* functions take no chain id. Since M-2 the same collection
-- address may exist on several chains, so they would read or update every
-- chain's row. The two floor-price trigger functions on listings
-- (trigger_update_floor_price, update_floor_price) match collections by
-- address only too.
-- Also verified on a local copy of the live schema: get_collection_stats and
-- get_top_collections fail with 42804 ("structure of query does not match
-- function result type") on any non-empty row, because total_sales is numeric
-- and floor_price numeric(78,0) while the declared result types are integer
-- and text. No code calls them today.
--
-- This migration:
--   * drops the chain-less versions and creates new ones with p_chain_id
--     integer as the FIRST argument, scoped by (chain_id, contract_address)
--     everywhere, including the listings/nfts subqueries:
--       increment_collection_stats(integer, text, numeric, integer)
--       get_collection_stats(integer, text)
--       update_collection_floor_price(integer, text)
--       get_top_collections(integer, integer, text)
--       cleanup_expired_listings(integer)
--       cleanup_expired_token_bids(integer)
--       cleanup_expired_collection_bids(integer)
--     The read functions now declare the column types they return
--     (total_sales numeric; floor_price as exact text).
--   * replaces the bodies of the two trigger functions so they recompute the
--     floor of (NEW.chain_id, NEW.collection_address) only. The floor logic is
--     inlined, so the trigger does not depend on EXECUTE of another function.
--     Both triggers are kept (they are duplicates; see PRODUCTION_PLAN).
--   * every function stays SECURITY INVOKER, gets search_path = public,
--     pg_temp, and is executable by service_role only: EXECUTE is revoked from
--     public, anon and authenticated (the baseline default privileges grant it
--     to anon/authenticated). Trigger firing does not check EXECUTE.
--
-- Not changed: expire_stale_records() (chain-less, not in M-5),
--   get_top_collections_volume_24h(), get_collection_nft_stats(),
--   get_collections_by_holders().
--
-- Depends on: 20261028090500 (listings.chain_id NOT NULL), 20261028090700
--   (bid chain_id), 20261028090800 (collections (chain_id, contract_address)).
-- Code coupling: callers must pass p_chain_id. The Phase 3B indexer no longer
--   calls increment_collection_stats (it uses indexer_record_sale); nothing in
--   apps/web calls any of these. A pg_cron job calling the old signatures
--   would break: the preflight aborts if one exists.
-- Re-runnable: DROP ... IF EXISTS, CREATE OR REPLACE, idempotent REVOKE/GRANT.

begin;

set local lock_timeout = '5s';

-- Preflight. No change made on failure.
do $$
declare
  v_old text[] := array[
    'public.increment_collection_stats(text, numeric, integer)',
    'public.get_collection_stats(text)',
    'public.update_collection_floor_price(text)',
    'public.get_top_collections(integer, text)',
    'public.cleanup_expired_listings()',
    'public.cleanup_expired_token_bids()',
    'public.cleanup_expired_collection_bids()'
  ];
  v_sig text;
  v_dependents text;
  v_cron bigint;
begin
  if (select count(*) from pg_attribute
      where attrelid in ('public.listings'::regclass, 'public.token_bids'::regclass, 'public.collection_bids'::regclass)
        and attname = 'chain_id' and attnotnull and not attisdropped) <> 3 then
    raise exception 'M-5 preflight failed: listings/token_bids/collection_bids.chain_id must be NOT NULL (apply 090500 and 090700 first). No change made.';
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.collections'::regclass and conname = 'collections_chain_contract_key') then
    raise exception 'M-5 preflight failed: collections_chain_contract_key missing; apply 20261028090800 first. No change made.';
  end if;

  -- Catalog dependents (views, defaults, ...) of the old signatures would make
  -- the DROP fail or cascade. PL/pgSQL bodies are not tracked; the two trigger
  -- functions that call them by name are replaced below.
  foreach v_sig in array v_old loop
    if to_regprocedure(v_sig) is not null then
      select string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
        into v_dependents
      from pg_depend d
      where d.refclassid = 'pg_proc'::regclass
        and d.refobjid = to_regprocedure(v_sig)
        and d.deptype = 'n';
      if v_dependents is not null then
        raise exception 'M-5 preflight failed: % has dependents (%). No change made.', v_sig, v_dependents;
      end if;
    end if;
  end loop;

  -- pg_cron jobs call functions by name; dropping the old signatures would make
  -- them fail on their next run.
  if to_regclass('cron.job') is not null then
    execute $q$
      select count(*) from cron.job
      where command ~* '(increment_collection_stats|get_collection_stats|update_collection_floor_price|get_top_collections|cleanup_expired_(listings|token_bids|collection_bids))'
    $q$ into v_cron;
    if v_cron > 0 then
      raise exception 'M-5 preflight failed: % pg_cron job(s) call a function whose signature changes; update or unschedule them first. No change made.', v_cron;
    end if;
  end if;
end
$$;

-- ─── Drop the chain-less versions ───────────────────────────────────────────

drop function if exists public.increment_collection_stats(text, numeric, integer);
drop function if exists public.get_collection_stats(text);
drop function if exists public.update_collection_floor_price(text);
drop function if exists public.get_top_collections(integer, text);
drop function if exists public.cleanup_expired_listings();
drop function if exists public.cleanup_expired_token_bids();
drop function if exists public.cleanup_expired_collection_bids();

-- ─── Chain-scoped versions ──────────────────────────────────────────────────

create or replace function public.increment_collection_stats(
  p_chain_id integer,
  p_collection_address text,
  p_volume numeric,
  p_sales integer
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.collections
     set total_volume = coalesce(total_volume, 0) + p_volume,
         total_sales  = coalesce(total_sales, 0) + p_sales,
         updated_at   = now()
   where chain_id = p_chain_id
     and contract_address = lower(p_collection_address);
end
$$;

create or replace function public.get_collection_stats(
  p_chain_id integer,
  p_collection_address text
)
returns table (
  total_volume numeric,
  total_sales numeric,
  floor_price text,
  listed_count bigint,
  owners_count bigint,
  items_count bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    c.total_volume,
    c.total_sales,
    c.floor_price::text,
    (select count(*) from public.listings l
      where l.chain_id = p_chain_id and l.collection_address = c.contract_address and l.is_active),
    (select count(distinct n.owner_wallet) from public.nfts n
      where n.chain_id = p_chain_id and n.collection_address = c.contract_address),
    (select count(*) from public.nfts n
      where n.chain_id = p_chain_id and n.collection_address = c.contract_address)
  from public.collections c
  where c.chain_id = p_chain_id
    and c.contract_address = lower(p_collection_address)
$$;

create or replace function public.update_collection_floor_price(
  p_chain_id integer,
  p_collection_address text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.collections c
     set floor_price = (
           select min(l.price) from public.listings l
           where l.chain_id = p_chain_id
             and l.collection_address = c.contract_address
             and l.is_active
         ),
         updated_at = now()
   where c.chain_id = p_chain_id
     and c.contract_address = lower(p_collection_address);
end
$$;

create or replace function public.get_top_collections(
  p_chain_id integer,
  p_limit integer default 10,
  p_order_by text default 'volume'
)
returns table (
  contract_address text,
  name text,
  symbol text,
  total_volume numeric,
  total_sales numeric,
  floor_price text,
  is_verified boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.contract_address, c.name, c.symbol, c.total_volume, c.total_sales,
         c.floor_price::text, c.is_verified
  from public.collections c
  where c.chain_id = p_chain_id
  order by
    case when p_order_by = 'sales' then c.total_sales else c.total_volume end desc nulls last,
    c.contract_address
  limit p_limit
$$;

create or replace function public.cleanup_expired_listings(p_chain_id integer)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.listings
     set is_active = false
   where chain_id = p_chain_id
     and is_active
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.cleanup_expired_token_bids(p_chain_id integer)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.token_bids
     set is_active = false
   where chain_id = p_chain_id
     and is_active
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.cleanup_expired_collection_bids(p_chain_id integer)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.collection_bids
     set is_active = false
   where chain_id = p_chain_id
     and is_active
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ─── Floor-price trigger functions: chain-scoped, logic inlined ─────────────

create or replace function public.trigger_update_floor_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Recompute the floor of this listing's collection on this listing's chain.
  update public.collections c
     set floor_price = (
           select min(l.price) from public.listings l
           where l.chain_id = NEW.chain_id
             and l.collection_address = NEW.collection_address
             and l.is_active
         ),
         updated_at = now()
   where c.chain_id = NEW.chain_id
     and c.contract_address = NEW.collection_address;
  return NEW;
end
$$;

create or replace function public.update_floor_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.collections c
     set floor_price = (
           select min(l.price) from public.listings l
           where l.chain_id = NEW.chain_id
             and l.collection_address = NEW.collection_address
             and l.is_active
         ),
         updated_at = now()
   where c.chain_id = NEW.chain_id
     and c.contract_address = NEW.collection_address;
  return NEW;
end
$$;

-- ─── Privileges: service_role only ──────────────────────────────────────────

revoke all on function public.increment_collection_stats(integer, text, numeric, integer) from public, anon, authenticated;
revoke all on function public.get_collection_stats(integer, text) from public, anon, authenticated;
revoke all on function public.update_collection_floor_price(integer, text) from public, anon, authenticated;
revoke all on function public.get_top_collections(integer, integer, text) from public, anon, authenticated;
revoke all on function public.cleanup_expired_listings(integer) from public, anon, authenticated;
revoke all on function public.cleanup_expired_token_bids(integer) from public, anon, authenticated;
revoke all on function public.cleanup_expired_collection_bids(integer) from public, anon, authenticated;
revoke all on function public.trigger_update_floor_price() from public, anon, authenticated;
revoke all on function public.update_floor_price() from public, anon, authenticated;

grant execute on function public.increment_collection_stats(integer, text, numeric, integer) to service_role;
grant execute on function public.get_collection_stats(integer, text) to service_role;
grant execute on function public.update_collection_floor_price(integer, text) to service_role;
grant execute on function public.get_top_collections(integer, integer, text) to service_role;
grant execute on function public.cleanup_expired_listings(integer) to service_role;
grant execute on function public.cleanup_expired_token_bids(integer) to service_role;
grant execute on function public.cleanup_expired_collection_bids(integer) to service_role;
grant execute on function public.trigger_update_floor_price() to service_role;
grant execute on function public.update_floor_price() to service_role;

-- Postcondition.
do $$
declare
  v_new text[] := array[
    'public.increment_collection_stats(integer, text, numeric, integer)',
    'public.get_collection_stats(integer, text)',
    'public.update_collection_floor_price(integer, text)',
    'public.get_top_collections(integer, integer, text)',
    'public.cleanup_expired_listings(integer)',
    'public.cleanup_expired_token_bids(integer)',
    'public.cleanup_expired_collection_bids(integer)',
    'public.trigger_update_floor_price()',
    'public.update_floor_price()'
  ];
  v_sig text;
  v_fn regprocedure;
  v_extra text;
begin
  -- Exactly one overload per name, and it is the chain-scoped one.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_extra
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('increment_collection_stats', 'get_collection_stats', 'update_collection_floor_price',
                      'get_top_collections', 'cleanup_expired_listings', 'cleanup_expired_token_bids',
                      'cleanup_expired_collection_bids')
    and not (p.oid::regprocedure::text = any (array[
      'increment_collection_stats(integer,text,numeric,integer)',
      'get_collection_stats(integer,text)',
      'update_collection_floor_price(integer,text)',
      'get_top_collections(integer,integer,text)',
      'cleanup_expired_listings(integer)',
      'cleanup_expired_token_bids(integer)',
      'cleanup_expired_collection_bids(integer)'
    ]));
  if v_extra is not null then
    raise exception 'M-5 postcondition failed: chain-less overloads remain: %', v_extra;
  end if;

  foreach v_sig in array v_new loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception 'M-5 postcondition failed: % missing', v_sig;
    end if;
    if exists (select 1 from pg_proc where oid = v_fn and prosecdef) then
      raise exception 'M-5 postcondition failed: % is SECURITY DEFINER', v_sig;
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn and proconfig @> array['search_path=public, pg_temp']) then
      raise exception 'M-5 postcondition failed: % search_path is not pinned', v_sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception 'M-5 postcondition failed: % is executable by PUBLIC, anon or authenticated', v_sig;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'M-5 postcondition failed: service_role cannot execute %', v_sig;
    end if;
  end loop;

  if (select count(*) from pg_proc
      where oid in ('public.trigger_update_floor_price()'::regprocedure, 'public.update_floor_price()'::regprocedure)
        and prosrc ~ 'NEW\.chain_id') <> 2 then
    raise exception 'M-5 postcondition failed: a floor-price trigger function is not chain-scoped';
  end if;
end
$$;

commit;
