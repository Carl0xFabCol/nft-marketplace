-- Audit IDX-6 / IDX-7: chain-scoped, replay-safe bid writes.
--
-- Before: the indexer inserted a new token_bids / collection_bids row for
-- every *BidPlaced event (plain INSERT, no on-chain identity), deactivated
-- bids by (collection, [token,] bidder) without chain_id and without regard to
-- event order, and computed a collection bid's remaining quantity as
-- "quantity in the DB row - tokenIds.length". Replaying a block range
-- duplicated bid rows, decremented quantities twice, and a replayed cancel
-- could deactivate a later bid.
--
-- On-chain there is no bid id: a bid is the slot
-- tokenBids[collection][tokenId][bidder] / collectionBids[collection][bidder],
-- overwritten by each new placement. This migration gives every bid row the
-- identity of the event that placed it, and moves each bid state transition
-- into one atomic, idempotent, order-aware function:
--
--   * token_bids, collection_bids: + tx_hash, log_index, block_number (the
--     placement event), UNIQUE (chain_id, tx_hash, log_index), a CHECK that
--     the three are all set or all NULL, and canonical lower-case tx_hash.
--     Existing (legacy) rows keep NULLs: they predate the identity and are
--     treated as older than any event.
--   * collection_bids.placed_quantity: the quantity of the placement event.
--     Legacy rows are backfilled with their current quantity (their earlier
--     fills are not recorded anywhere).
--   * collection_bid_fills: one row per CollectionBidAccepted, PRIMARY KEY
--     (chain_id, tx_hash, log_index), FK bid_id -> collection_bids ON DELETE
--     CASCADE. A bid's remaining quantity is placed_quantity - sum(fills): it
--     is derived from recorded events, never from the previous quantity.
--     RLS enabled with no policy; every privilege revoked from public, anon
--     and authenticated (the baseline default privileges would grant ALL).
--   * indexer_apply_token_bid_event(kind 'placed' | 'closed', ...)
--   * indexer_apply_collection_bid_event(kind 'placed' | 'cancelled' | 'filled', ...)
--     "Placed before position (B, L)" means (block_number, log_index) < (B, L),
--     or a legacy row. placed: deactivate the slot's active rows placed before
--     this event, then insert this placement (ON CONFLICT DO NOTHING; inactive
--     if a later placement already exists). closed/cancelled: deactivate the
--     slot's active rows placed before this event. filled: record the fill for
--     the latest row placed before this event, and only if that fill is new,
--     set quantity = placed_quantity - sum(fills), is_active = remaining > 0.
--     Every write is scoped by chain_id. SECURITY INVOKER, search_path pinned,
--     EXECUTE for service_role only.
--
-- Depends on: 20261028090700 (bid chain_id NOT NULL and the chain-scoped
--   active-bid uniques), 20261028090800.
-- Code coupling: the Phase 3B BidsRepository calls the two functions. Older
--   code keeps working against this schema (the new columns are nullable),
--   but it is not replay-safe.
-- Re-runnable: IF NOT EXISTS / catalog-guarded DDL, CREATE OR REPLACE,
--   idempotent REVOKE/GRANT; the backfill only touches legacy rows with a NULL
--   placed_quantity.

begin;

set local lock_timeout = '5s';

-- Preflight. No change made on failure.
do $$
begin
  if (select count(*) from pg_attribute
      where attrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass)
        and attname = 'chain_id' and attnotnull and not attisdropped) <> 2 then
    raise exception 'IDX-7 preflight failed: bid chain_id must be NOT NULL; apply 20261028090700 first. No change made.';
  end if;

  if to_regclass('public.idx_token_bids_unique_active_chain') is null
     or to_regclass('public.idx_collection_bids_unique_active_chain') is null then
    raise exception 'IDX-7 preflight failed: chain-scoped active-bid uniques missing; apply 20261028090700 first. No change made.';
  end if;

  -- A re-run must find the columns it created with the expected types.
  if exists (
    select 1 from pg_attribute
    where attrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass)
      and not attisdropped
      and ((attname = 'tx_hash' and atttypid <> 'text'::regtype)
        or (attname = 'log_index' and atttypid <> 'integer'::regtype)
        or (attname = 'block_number' and atttypid <> 'bigint'::regtype)
        or (attname = 'placed_quantity' and atttypid <> 'bigint'::regtype))
  ) then
    raise exception 'IDX-7 preflight failed: a bid column tx_hash/log_index/block_number/placed_quantity exists with an unexpected type. No change made.';
  end if;

  if to_regclass('public.collection_bid_fills') is not null
     and not exists (select 1 from pg_constraint
                     where conrelid = to_regclass('public.collection_bid_fills') and conname = 'collection_bid_fills_pkey') then
    raise exception 'IDX-7 preflight failed: collection_bid_fills exists without the expected primary key. No change made.';
  end if;
end
$$;

-- ─── Placement identity on both bid tables ──────────────────────────────────

alter table public.token_bids
  add column if not exists tx_hash text,
  add column if not exists log_index integer,
  add column if not exists block_number bigint;

alter table public.collection_bids
  add column if not exists tx_hash text,
  add column if not exists log_index integer,
  add column if not exists block_number bigint,
  add column if not exists placed_quantity bigint;

-- Legacy rows: their placement quantity is unknown; their current quantity is
-- the best (and only) value. New rows always get placed_quantity from the event.
update public.collection_bids
   set placed_quantity = quantity
 where placed_quantity is null
   and tx_hash is null;

do $$
declare
  t text;
begin
  foreach t in array array['token_bids', 'collection_bids'] loop
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', t)::regclass and conname = t || '_chain_event_key') then
      execute format('alter table public.%I add constraint %I unique (chain_id, tx_hash, log_index)', t, t || '_chain_event_key');
    end if;
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', t)::regclass and conname = t || '_event_identity_complete') then
      execute format(
        'alter table public.%I add constraint %I check (num_nulls(tx_hash, log_index, block_number) in (0, 3))',
        t, t || '_event_identity_complete');
    end if;
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', t)::regclass and conname = t || '_tx_hash_canonical') then
      execute format(
        'alter table public.%I add constraint %I check (tx_hash is null or (tx_hash ~ ''^0x[0-9a-f]{64}$'' and log_index >= 0 and block_number >= 0))',
        t, t || '_tx_hash_canonical');
    end if;
  end loop;
end
$$;

-- ─── Fill ledger ────────────────────────────────────────────────────────────

create table if not exists public.collection_bid_fills (
  chain_id integer not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  bid_id uuid not null references public.collection_bids (id) on delete cascade,
  token_count integer not null,
  created_at timestamptz not null,
  constraint collection_bid_fills_pkey primary key (chain_id, tx_hash, log_index),
  constraint collection_bid_fills_chain_id_positive check (chain_id > 0),
  constraint collection_bid_fills_tx_hash_canonical check (tx_hash ~ '^0x[0-9a-f]{64}$' and log_index >= 0 and block_number >= 0),
  constraint collection_bid_fills_token_count_positive check (token_count > 0)
);

create index if not exists idx_collection_bid_fills_bid on public.collection_bid_fills (bid_id);

alter table public.collection_bid_fills enable row level security;
revoke all on table public.collection_bid_fills from public, anon, authenticated;
grant select, insert, update, delete on table public.collection_bid_fills to service_role;

-- ─── Token bid events ───────────────────────────────────────────────────────

create or replace function public.indexer_apply_token_bid_event(
  p_kind text,
  p_chain_id integer,
  p_collection_address text,
  p_token_id text,
  p_bidder_wallet text,
  p_block_number bigint,
  p_log_index integer,
  p_tx_hash text,
  p_at timestamptz,
  p_price_wei text default null,
  p_expires_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_collection text := lower(p_collection_address);
  v_bidder text := lower(p_bidder_wallet);
  v_tx_hash text := lower(p_tx_hash);
  v_changed integer := 0;
  v_n integer;
begin
  if p_kind is null or p_kind not in ('placed', 'closed') then
    raise exception 'indexer_apply_token_bid_event: unknown kind %', p_kind using errcode = '22023';
  end if;
  if p_chain_id is null or p_chain_id <= 0
     or v_collection is null or v_collection !~ '^0x[0-9a-f]{40}$'
     or v_bidder is null or v_bidder !~ '^0x[0-9a-f]{40}$'
     or p_token_id is null or p_token_id !~ '^[0-9]{1,78}$'
     or v_tx_hash is null or v_tx_hash !~ '^0x[0-9a-f]{64}$'
     or p_block_number is null or p_block_number < 0
     or p_log_index is null or p_log_index < 0
     or p_at is null then
    raise exception 'indexer_apply_token_bid_event: invalid event identity or slot' using errcode = '22023';
  end if;
  if p_kind = 'placed' and (p_price_wei is null or p_price_wei !~ '^[0-9]{1,78}$') then
    raise exception 'indexer_apply_token_bid_event: price must be a decimal wei string, got %', p_price_wei using errcode = '22023';
  end if;

  -- Both kinds first close the slot's bids placed before this event: a new
  -- placement overwrites the slot, a cancel or an acceptance deletes it.
  update public.token_bids b
     set is_active = false,
         updated_at = p_at
   where b.chain_id = p_chain_id
     and b.collection_address = v_collection
     and b.token_id = p_token_id
     and b.bidder_wallet = v_bidder
     and b.is_active
     and (b.block_number is null or (b.block_number, b.log_index) < (p_block_number, p_log_index));
  get diagnostics v_changed = row_count;

  if p_kind = 'placed' then
    insert into public.token_bids
      (chain_id, collection_address, token_id, bidder_wallet, price, expires_at,
       is_active, created_at, tx_hash, log_index, block_number)
    values
      (p_chain_id, v_collection, p_token_id, v_bidder, p_price_wei::numeric, p_expires_at,
       -- Active unless the slot was already overwritten by a later placement
       -- (only possible while replaying an old range).
       not exists (
         select 1 from public.token_bids b
         where b.chain_id = p_chain_id and b.collection_address = v_collection
           and b.token_id = p_token_id and b.bidder_wallet = v_bidder
           and (b.block_number, b.log_index) > (p_block_number, p_log_index)
       ),
       p_at, v_tx_hash, p_log_index, p_block_number)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end if;

  return v_changed;
end
$$;

-- ─── Collection bid events ──────────────────────────────────────────────────

create or replace function public.indexer_apply_collection_bid_event(
  p_kind text,
  p_chain_id integer,
  p_collection_address text,
  p_bidder_wallet text,
  p_block_number bigint,
  p_log_index integer,
  p_tx_hash text,
  p_at timestamptz,
  p_price_wei text default null,
  p_quantity bigint default null,
  p_expires_at timestamptz default null,
  p_token_count integer default null
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_collection text := lower(p_collection_address);
  v_bidder text := lower(p_bidder_wallet);
  v_tx_hash text := lower(p_tx_hash);
  v_changed integer := 0;
  v_n integer;
  v_bid public.collection_bids%rowtype;
  v_remaining bigint;
begin
  if p_kind is null or p_kind not in ('placed', 'cancelled', 'filled') then
    raise exception 'indexer_apply_collection_bid_event: unknown kind %', p_kind using errcode = '22023';
  end if;
  if p_chain_id is null or p_chain_id <= 0
     or v_collection is null or v_collection !~ '^0x[0-9a-f]{40}$'
     or v_bidder is null or v_bidder !~ '^0x[0-9a-f]{40}$'
     or v_tx_hash is null or v_tx_hash !~ '^0x[0-9a-f]{64}$'
     or p_block_number is null or p_block_number < 0
     or p_log_index is null or p_log_index < 0
     or p_at is null then
    raise exception 'indexer_apply_collection_bid_event: invalid event identity or slot' using errcode = '22023';
  end if;
  if p_kind = 'placed' and (p_price_wei is null or p_price_wei !~ '^[0-9]{1,78}$' or p_quantity is null or p_quantity <= 0) then
    raise exception 'indexer_apply_collection_bid_event: placed needs a decimal wei price and a positive quantity' using errcode = '22023';
  end if;
  if p_kind = 'filled' and (p_token_count is null or p_token_count <= 0) then
    raise exception 'indexer_apply_collection_bid_event: filled needs a positive token count' using errcode = '22023';
  end if;

  if p_kind in ('placed', 'cancelled') then
    update public.collection_bids b
       set is_active = false,
           updated_at = p_at
     where b.chain_id = p_chain_id
       and b.collection_address = v_collection
       and b.bidder_wallet = v_bidder
       and b.is_active
       and (b.block_number is null or (b.block_number, b.log_index) < (p_block_number, p_log_index));
    get diagnostics v_changed = row_count;
  end if;

  if p_kind = 'placed' then
    insert into public.collection_bids
      (chain_id, collection_address, bidder_wallet, price, quantity, placed_quantity, expires_at,
       is_active, created_at, tx_hash, log_index, block_number)
    values
      (p_chain_id, v_collection, v_bidder, p_price_wei::numeric, p_quantity, p_quantity, p_expires_at,
       not exists (
         select 1 from public.collection_bids b
         where b.chain_id = p_chain_id and b.collection_address = v_collection
           and b.bidder_wallet = v_bidder
           and (b.block_number, b.log_index) > (p_block_number, p_log_index)
       ),
       p_at, v_tx_hash, p_log_index, p_block_number)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end if;

  if p_kind = 'filled' then
    -- The bid this acceptance filled: the slot's latest placement before it.
    select * into v_bid
    from public.collection_bids b
    where b.chain_id = p_chain_id
      and b.collection_address = v_collection
      and b.bidder_wallet = v_bidder
      and (b.block_number is null or (b.block_number, b.log_index) < (p_block_number, p_log_index))
    order by b.block_number desc nulls last, b.log_index desc nulls last, b.created_at desc, b.id desc
    limit 1
    for update;

    if not found then
      -- No placement indexed for this slot: nothing to fill.
      return 0;
    end if;

    insert into public.collection_bid_fills
      (chain_id, tx_hash, log_index, block_number, bid_id, token_count, created_at)
    values
      (p_chain_id, v_tx_hash, p_log_index, p_block_number, v_bid.id, p_token_count, p_at)
    on conflict do nothing;
    get diagnostics v_n = row_count;

    if v_n = 1 then
      select coalesce(v_bid.placed_quantity, 0) - coalesce(sum(f.token_count), 0)
        into v_remaining
      from public.collection_bid_fills f
      where f.bid_id = v_bid.id;

      update public.collection_bids
         set quantity = greatest(v_remaining, 0),
             is_active = is_active and v_remaining > 0,
             updated_at = p_at
       where id = v_bid.id;
      v_changed := 1;
    end if;
  end if;

  return v_changed;
end
$$;

revoke all on function public.indexer_apply_token_bid_event(text, integer, text, text, text, bigint, integer, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.indexer_apply_collection_bid_event(text, integer, text, text, bigint, integer, text, timestamptz, text, bigint, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.indexer_apply_token_bid_event(text, integer, text, text, text, bigint, integer, text, timestamptz, text, timestamptz)
  to service_role;
grant execute on function public.indexer_apply_collection_bid_event(text, integer, text, text, bigint, integer, text, timestamptz, text, bigint, timestamptz, integer)
  to service_role;

-- Postcondition.
do $$
declare
  v_fn regprocedure;
  v_sig text;
  t text;
begin
  foreach t in array array['token_bids', 'collection_bids'] loop
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', t)::regclass and conname = t || '_chain_event_key'
                     and contype = 'u'
                     and pg_get_constraintdef(oid) = 'UNIQUE (chain_id, tx_hash, log_index)') then
      raise exception 'IDX-7 postcondition failed: %_chain_event_key missing or wrong', t;
    end if;
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', t)::regclass and conname = t || '_event_identity_complete') then
      raise exception 'IDX-7 postcondition failed: %_event_identity_complete missing', t;
    end if;
  end loop;

  if exists (select 1 from public.collection_bids where placed_quantity is null and quantity is not null) then
    raise exception 'IDX-7 postcondition failed: a collection bid has no placed_quantity';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.collection_bid_fills'::regclass) then
    raise exception 'IDX-7 postcondition failed: RLS is not enabled on collection_bid_fills';
  end if;
  if has_table_privilege('anon', 'public.collection_bid_fills', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.collection_bid_fills', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'IDX-7 postcondition failed: anon or authenticated has a privilege on collection_bid_fills';
  end if;

  foreach v_sig in array array[
    'public.indexer_apply_token_bid_event(text, integer, text, text, text, bigint, integer, text, timestamptz, text, timestamptz)',
    'public.indexer_apply_collection_bid_event(text, integer, text, text, bigint, integer, text, timestamptz, text, bigint, timestamptz, integer)'
  ] loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception 'IDX-7 postcondition failed: % missing', v_sig;
    end if;
    if exists (select 1 from pg_proc where oid = v_fn and prosecdef) then
      raise exception 'IDX-7 postcondition failed: % is SECURITY DEFINER', v_sig;
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn and proconfig @> array['search_path=public, pg_temp']) then
      raise exception 'IDX-7 postcondition failed: % search_path is not pinned', v_sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception 'IDX-7 postcondition failed: % is executable by PUBLIC, anon or authenticated', v_sig;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'IDX-7 postcondition failed: service_role cannot execute %', v_sig;
    end if;
  end loop;
end
$$;

commit;
