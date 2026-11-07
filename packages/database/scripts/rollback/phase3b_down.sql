-- Phase 3B ROLLBACK (schema only): undo 20261028091600 .. 20261028091200 in
-- reverse order and return the public schema to the exact post-Phase-2 state
-- (catalog_fingerprint.after.txt). GENERATED from the baseline dump by the
-- Phase 3B rehearsal; do not edit the function bodies by hand.
--
-- Use it only as described in docs/PHASE3B_RUNBOOK.md "Rollback": indexer
-- stopped, Phase 3A code (or older Phase 2 code) ready to deploy, backup taken.
--
-- What it LOSES (by design, nothing else is touched):
--   * indexer_state.last_block_hash values;
--   * the bid event identity (token_bids/collection_bids tx_hash, log_index,
--     block_number, collection_bids.placed_quantity) and every
--     collection_bid_fills row. Bid rows themselves, their current quantity
--     and is_active are kept;
--   * indexer_record_sale and the chain-scoped M-5 functions (the chain-less
--     versions come back with their original bodies and ACLs).
-- Activity rows and collection stats written by Phase 3B code stay; they are
-- valid Phase 2 data.
--
-- Guards (one transaction; any failure changes nothing):
--   * the database must look post-3B (indexer_record_sale exists); pass
--     -v force=1 to skip this check, e.g. after a partially applied 3B;
--   * contract_indexer_state must not hold the same address on two chains
--     (the old primary key is (contract_address) alone).
--
--   psql "<db url>" -X -v ON_ERROR_STOP=1 -f phase3b_down.sql

\set ON_ERROR_STOP on
\if :{?force}
\else
  \set force 0
\endif

begin;

set local lock_timeout = '5s';

select set_config('phase3b.force', :'force', true) as force_flag;

do $$
begin
  if to_regprocedure('public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)') is null
     and current_setting('phase3b.force', true) is distinct from '1' then
    raise exception 'phase3b down: indexer_record_sale not found; this does not look like a Phase 3B database. Re-run with -v force=1 only if you are sure. Nothing changed.';
  end if;
  if exists (select 1 from public.contract_indexer_state group by contract_address having count(*) > 1) then
    raise exception 'phase3b down: contract_indexer_state has an address on two chains; the pre-3B primary key (contract_address) cannot hold it. Resolve by hand. Nothing changed.';
  end if;
end
$$;

-- ─── 091600: nfts_market_view without chain joins (baseline definition) ─────

create or replace view public.nfts_market_view with (security_invoker = true) as

 SELECT n.id,
    n.collection_address,
    n.token_id,
    n.owner_wallet,
    n.name,
    n.image_url,
    n.metadata,
    n.chain_id,
    l.price AS listing_price,
    l.seller_wallet AS listing_seller,
    l.expires_at AS listing_expires_at,
    l.listing_id,
    tb.price AS best_token_bid,
    tb.bidder_wallet AS best_token_bidder,
    cb.price AS best_collection_bid
   FROM (((public.nfts n
     LEFT JOIN public.listings l ON (((l.collection_address = n.collection_address) AND (l.token_id = n.token_id) AND (l.is_active = true))))
     LEFT JOIN LATERAL ( SELECT token_bids.price,
            token_bids.bidder_wallet
           FROM public.token_bids
          WHERE ((token_bids.collection_address = n.collection_address) AND (token_bids.token_id = n.token_id) AND (token_bids.is_active = true))
          ORDER BY token_bids.price DESC
         LIMIT 1) tb ON (true))
     LEFT JOIN LATERAL ( SELECT collection_bids.price
           FROM public.collection_bids
          WHERE ((collection_bids.collection_address = n.collection_address) AND (collection_bids.is_active = true))
          ORDER BY collection_bids.price DESC
         LIMIT 1) cb ON (true));

-- ─── 091500: cursor tables ──────────────────────────────────────────────────

alter table public.indexer_state drop constraint if exists indexer_state_last_block_hash_canonical;
alter table public.indexer_state drop column if exists last_block_hash;
alter table public.indexer_state drop constraint if exists indexer_state_chain_id_positive;
do $$
begin
  if (select atttypid from pg_attribute where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id') <> 'numeric'::regtype then
    alter table public.indexer_state alter column chain_id type numeric using chain_id::numeric;
  end if;
end
$$;

alter table public.contract_indexer_state drop constraint if exists contract_indexer_state_chain_id_positive;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.contract_indexer_state'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (contract_address)' then
    alter table public.contract_indexer_state drop constraint contract_indexer_state_pkey;
    alter table public.contract_indexer_state add constraint contract_indexer_state_pkey primary key (contract_address);
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.contract_indexer_state'::regclass and conname = 'contract_indexer_state_contract_chain_unique') then
    alter table public.contract_indexer_state
      add constraint contract_indexer_state_contract_chain_unique unique (contract_address, chain_id);
  end if;
end
$$;
alter table public.contract_indexer_state alter column chain_id drop not null;

-- ─── 091400: bid event identity ─────────────────────────────────────────────

drop function if exists public.indexer_apply_token_bid_event(text, integer, text, text, text, bigint, integer, text, timestamptz, text, timestamptz);
drop function if exists public.indexer_apply_collection_bid_event(text, integer, text, text, bigint, integer, text, timestamptz, text, bigint, timestamptz, integer);
drop table if exists public.collection_bid_fills;
alter table public.token_bids
  drop constraint if exists token_bids_chain_event_key,
  drop constraint if exists token_bids_event_identity_complete,
  drop constraint if exists token_bids_tx_hash_canonical,
  drop column if exists tx_hash,
  drop column if exists log_index,
  drop column if exists block_number;
alter table public.collection_bids
  drop constraint if exists collection_bids_chain_event_key,
  drop constraint if exists collection_bids_event_identity_complete,
  drop constraint if exists collection_bids_tx_hash_canonical,
  drop column if exists tx_hash,
  drop column if exists log_index,
  drop column if exists block_number,
  drop column if exists placed_quantity;

-- ─── 091300: chain-less M-5 functions, original bodies and ACLs ─────────────

drop function if exists public.increment_collection_stats(integer, text, numeric, integer);
drop function if exists public.get_collection_stats(integer, text);
drop function if exists public.update_collection_floor_price(integer, text);
drop function if exists public.get_top_collections(integer, integer, text);
drop function if exists public.cleanup_expired_listings(integer);
drop function if exists public.cleanup_expired_token_bids(integer);
drop function if exists public.cleanup_expired_collection_bids(integer);

do $old$
begin
  execute 'create function public.increment_collection_stats(p_collection_address text, p_volume numeric, p_sales integer) returns void language plpgsql as '
    || quote_literal(replace($body$
BEGIN
  UPDATE public.collections
    SET total_volume = COALESCE(total_volume, 0) + p_volume,
        total_sales  = COALESCE(total_sales, 0) + p_sales,
        updated_at   = now()
    WHERE contract_address = p_collection_address;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.get_collection_stats(p_collection_address text) returns table(total_volume numeric, total_sales integer, floor_price text, listed_count bigint, owners_count bigint, items_count bigint) language plpgsql as '
    || quote_literal(replace($body$
BEGIN
  RETURN QUERY
  SELECT 
    c.total_volume,
    c.total_sales,
    c.floor_price,
    (SELECT COUNT(*) FROM listings 
     WHERE collection_address = p_collection_address AND is_active = TRUE) as listed_count,
    (SELECT COUNT(DISTINCT owner_wallet) FROM nfts 
     WHERE collection_address = p_collection_address) as owners_count,
    (SELECT COUNT(*) FROM nfts 
     WHERE collection_address = p_collection_address) as items_count
  FROM collections c
  WHERE c.contract_address = p_collection_address;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.update_collection_floor_price(p_collection_address text) returns void language plpgsql as '
    || quote_literal(replace($body$
DECLARE
  v_floor_price numeric;
BEGIN
  SELECT MIN(price) INTO v_floor_price
    FROM public.listings
    WHERE collection_address = p_collection_address
      AND is_active = true;

  UPDATE collections
    SET
      floor_price = v_floor_price,
      updated_at = NOW()
    WHERE contract_address = p_collection_address;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.get_top_collections(p_limit integer default 10, p_order_by text default ''volume''::text) returns table(contract_address text, name text, symbol text, total_volume numeric, total_sales integer, floor_price text, is_verified boolean) language plpgsql as '
    || quote_literal(replace($body$
BEGIN
  IF p_order_by = 'sales' THEN
    RETURN QUERY
    SELECT 
      c.contract_address,
      c.name,
      c.symbol,
      c.total_volume,
      c.total_sales,
      c.floor_price,
      c.is_verified
    FROM collections c
    ORDER BY c.total_sales DESC NULLS LAST
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT 
      c.contract_address,
      c.name,
      c.symbol,
      c.total_volume,
      c.total_sales,
      c.floor_price,
      c.is_verified
    FROM collections c
    ORDER BY c.total_volume DESC NULLS LAST
    LIMIT p_limit;
  END IF;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.cleanup_expired_listings() returns integer language plpgsql as '
    || quote_literal(replace($body$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE listings
  SET is_active = FALSE
  WHERE 
    is_active = TRUE 
    AND expires_at IS NOT NULL 
    AND expires_at < NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.cleanup_expired_token_bids() returns integer language plpgsql as '
    || quote_literal(replace($body$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE token_bids
  SET is_active = FALSE
  WHERE 
    is_active = TRUE 
    AND expires_at IS NOT NULL 
    AND expires_at < NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create function public.cleanup_expired_collection_bids() returns integer language plpgsql as '
    || quote_literal(replace($body$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE collection_bids
  SET is_active = FALSE
  WHERE 
    is_active = TRUE 
    AND expires_at IS NOT NULL 
    AND expires_at < NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create or replace function public.trigger_update_floor_price() returns trigger language plpgsql as '
    || quote_literal(replace($body$
BEGIN
  -- Update floor price when listing is created, updated, or cancelled
  PERFORM update_collection_floor_price(NEW.collection_address);
  RETURN NEW;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

do $old$
begin
  execute 'create or replace function public.update_floor_price() returns trigger language plpgsql as '
    || quote_literal(replace($body$
DECLARE
  v_floor numeric;
BEGIN
  SELECT MIN(price) INTO v_floor
    FROM public.listings
    WHERE collection_address = NEW.collection_address
      AND is_active = true;
 
  UPDATE public.collections
    SET floor_price = v_floor,
        updated_at  = now()
    WHERE contract_address = NEW.collection_address;
 
  RETURN NEW;
END;
$body$, E'\n', E'\r\n'));
end
$old$;

-- The trigger functions were replaced in place: drop the 3B search_path and
-- give back the baseline EXECUTE grants (harmless: trigger firing does not
-- check EXECUTE).
alter function public.trigger_update_floor_price() reset all;
revoke all on function public.trigger_update_floor_price() from public, postgres, anon, authenticated, service_role;
grant execute on function public.trigger_update_floor_price() to public;
grant execute on function public.trigger_update_floor_price() to postgres;
grant execute on function public.trigger_update_floor_price() to anon;
grant execute on function public.trigger_update_floor_price() to authenticated;
grant execute on function public.trigger_update_floor_price() to service_role;
alter function public.update_floor_price() reset all;
revoke all on function public.update_floor_price() from public, postgres, anon, authenticated, service_role;
grant execute on function public.update_floor_price() to public;
grant execute on function public.update_floor_price() to postgres;
grant execute on function public.update_floor_price() to anon;
grant execute on function public.update_floor_price() to authenticated;
grant execute on function public.update_floor_price() to service_role;

-- Recreated functions get the default ACL (PUBLIC + the default privileges).
-- 20261028090000 had revoked the mutating helpers from public/anon/authenticated.
revoke all on function public.increment_collection_stats(text, numeric, integer) from public, anon, authenticated;
grant execute on function public.increment_collection_stats(text, numeric, integer) to service_role;
grant execute on function public.get_collection_stats(text) to anon, authenticated, service_role;
revoke all on function public.update_collection_floor_price(text) from public, anon, authenticated;
grant execute on function public.update_collection_floor_price(text) to service_role;
grant execute on function public.get_top_collections(integer, text) to anon, authenticated, service_role;
revoke all on function public.cleanup_expired_listings() from public, anon, authenticated;
grant execute on function public.cleanup_expired_listings() to service_role;
revoke all on function public.cleanup_expired_token_bids() from public, anon, authenticated;
grant execute on function public.cleanup_expired_token_bids() to service_role;
revoke all on function public.cleanup_expired_collection_bids() from public, anon, authenticated;
grant execute on function public.cleanup_expired_collection_bids() to service_role;

-- ─── 091200: atomic sale RPC ────────────────────────────────────────────────

drop function if exists public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text);

-- Postcondition: nothing Phase 3B is left.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('indexer_record_sale', 'indexer_apply_token_bid_event', 'indexer_apply_collection_bid_event'))
     or to_regclass('public.collection_bid_fills') is not null
     or exists (select 1 from pg_attribute where attrelid = 'public.indexer_state'::regclass and attname = 'last_block_hash' and not attisdropped)
     or to_regprocedure('public.increment_collection_stats(text, numeric, integer)') is null
     or to_regprocedure('public.cleanup_expired_listings()') is null then
    raise exception 'phase3b down postcondition failed';
  end if;
end
$$;

commit;
