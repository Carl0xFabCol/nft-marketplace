-- Phase 3B task 1 (IDX-1 follow-up, DB-5): record a Sale and its collection
-- stats in one transaction, exactly once per on-chain log.
--
-- Before (Phase 3A): SaleHandler inserted the SALE activity row
-- (ON CONFLICT (tx_hash, log_index) DO NOTHING) and, only when that row was
-- fresh, called increment_collection_stats in a second request. If that
-- second call failed, a compensating DELETE removed the activity row. A crash
-- between the two requests, or a failed compensating delete, lost one Sale
-- from total_volume/total_sales for good (at-most-once).
--
-- This migration adds indexer_record_sale(...). One call:
--   1. inserts the SALE activity row, ON CONFLICT (tx_hash, log_index) DO NOTHING;
--   2. only if that row was inserted, adds the price to total_volume (ether,
--      exact: wei * 1e-18 by multiplication, never division) and 1 to
--      total_sales of the collection identified by (chain_id, contract_address);
--   3. returns true when the row was fresh, false on a replay.
-- Both writes commit or roll back together, so a replay never double-counts
-- and a failure never undercounts.
--
-- A Sale whose collection has no row on that chain still records the activity
-- row and updates 0 collections (the same as increment_collection_stats did).
--
-- Security: SECURITY DEFINER (owner postgres), search_path = public, pg_temp,
-- every relation schema-qualified. The baseline's default privileges grant
-- EXECUTE on new functions to anon and authenticated, so EXECUTE is revoked
-- explicitly from public, anon and authenticated and granted only to
-- service_role. Inputs are validated (canonical lower-case hex, decimal wei).
--
-- Depends on: 20261028090800 (collections_chain_contract_key), 20261028090900
--   (activity.chain_id integer NOT NULL) and the baseline's
--   activity_unique_event UNIQUE (tx_hash, log_index).
-- Code coupling: the Phase 3B SaleHandler calls this RPC. Older code keeps
--   working against it (it does not call it).
-- Re-runnable: CREATE OR REPLACE and the REVOKE/GRANT are idempotent.

begin;

set local lock_timeout = '5s';

-- Preflight: everything the function relies on must already exist. No change made otherwise.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.activity'::regclass
      and i.indisunique
      and i.indpred is null
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      ) = array['tx_hash', 'log_index']
  ) then
    raise exception 'Sale RPC preflight failed: no unique index on activity (tx_hash, log_index). No change made.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass and conname = 'collections_chain_contract_key'
  ) then
    raise exception 'Sale RPC preflight failed: collections_chain_contract_key missing; apply 20261028090800 first. No change made.';
  end if;

  if (
    select format_type(atttypid, atttypmod) from pg_attribute
    where attrelid = 'public.activity'::regclass and attname = 'chain_id' and not attisdropped
  ) is distinct from 'integer' then
    raise exception 'Sale RPC preflight failed: activity.chain_id is not integer; apply 20261028090900 first. No change made.';
  end if;
end
$$;

create or replace function public.indexer_record_sale(
  p_chain_id integer,
  p_collection_address text,
  p_token_id text,
  p_from text,
  p_to text,
  p_price_wei text,
  p_tx_hash text,
  p_log_index integer,
  p_created_at timestamptz,
  p_source_contract text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_collection text := lower(p_collection_address);
  v_tx_hash text := lower(p_tx_hash);
  v_inserted uuid;
begin
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'indexer_record_sale: invalid chain_id %', p_chain_id using errcode = '22023';
  end if;
  if v_collection is null or v_collection !~ '^0x[0-9a-f]{40}$' then
    raise exception 'indexer_record_sale: invalid collection address %', p_collection_address using errcode = '22023';
  end if;
  if p_token_id is null or p_token_id !~ '^[0-9]{1,78}$' then
    raise exception 'indexer_record_sale: invalid token id %', p_token_id using errcode = '22023';
  end if;
  if p_price_wei is null or p_price_wei !~ '^[0-9]{1,78}$' then
    raise exception 'indexer_record_sale: price must be a decimal wei string, got %', p_price_wei using errcode = '22023';
  end if;
  if v_tx_hash is null or v_tx_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'indexer_record_sale: invalid tx hash %', p_tx_hash using errcode = '22023';
  end if;
  if p_log_index is null or p_log_index < 0 then
    raise exception 'indexer_record_sale: invalid log index %', p_log_index using errcode = '22023';
  end if;
  if p_created_at is null then
    raise exception 'indexer_record_sale: created_at is required' using errcode = '22023';
  end if;

  insert into public.activity
    (event, chain_id, collection_address, token_id, "from", "to", price,
     tx_hash, log_index, created_at, source_contract)
  values
    ('SALE', p_chain_id, v_collection, p_token_id, lower(p_from), lower(p_to), p_price_wei,
     v_tx_hash, p_log_index, p_created_at, p_source_contract)
  on conflict (tx_hash, log_index) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Replay: the Sale is already counted.
    return false;
  end if;

  update public.collections
     set total_volume = coalesce(total_volume, 0) + p_price_wei::numeric * 0.000000000000000001,
         total_sales  = coalesce(total_sales, 0) + 1,
         updated_at   = now()
   where chain_id = p_chain_id
     and contract_address = v_collection;

  return true;
end
$$;

revoke all on function public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)
  to service_role;

-- Postcondition.
do $$
declare
  v_fn regprocedure := to_regprocedure('public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)');
begin
  if v_fn is null then
    raise exception 'Sale RPC postcondition failed: indexer_record_sale missing';
  end if;

  if not exists (select 1 from pg_proc where oid = v_fn and prosecdef) then
    raise exception 'Sale RPC postcondition failed: indexer_record_sale is not SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = v_fn and proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'Sale RPC postcondition failed: search_path is not pinned to public, pg_temp';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Sale RPC postcondition failed: indexer_record_sale is executable by PUBLIC, anon or authenticated';
  end if;

  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'Sale RPC postcondition failed: service_role cannot execute indexer_record_sale';
  end if;
end
$$;

commit;
