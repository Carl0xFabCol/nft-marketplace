-- DB-1 (view part): nfts_market_view joins listings and bids by chain.
--
-- Before: nfts_market_view joined listings, token_bids and collection_bids
-- to nfts on (collection_address[, token_id]) only. Since M-1/M-2/M-3 the
-- same collection address can exist on several chains, so an NFT on 99801
-- could show a listing price or best bid from another chain.
--
-- This migration replaces the view definition with the same columns, in the
-- same order and with the same types, and adds chain_id = n.chain_id to all
-- three joins. CREATE OR REPLACE VIEW keeps the grants (SELECT for anon and
-- authenticated from 20261028090000); security_invoker = true is restated.
--
-- Depends on: 20261028090000 (security_invoker, grants), 20261028090500,
--   20261028090700 (chain_id NOT NULL on listings and bids).
-- Code coupling: none. The columns are unchanged; rows can only lose
--   cross-chain matches.
-- Re-runnable: CREATE OR REPLACE.

begin;

set local lock_timeout = '5s';

-- Preflight: the current view has exactly the expected columns. No change made otherwise.
do $$
declare
  v_cols text;
begin
  select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
    into v_cols
  from pg_attribute
  where attrelid = to_regclass('public.nfts_market_view') and attnum > 0 and not attisdropped;

  if v_cols is distinct from
     'id uuid, collection_address text, token_id text, owner_wallet text, name text, image_url text, metadata jsonb, chain_id integer, '
     'listing_price numeric(78,0), listing_seller text, listing_expires_at timestamp with time zone, listing_id text, '
     'best_token_bid numeric(78,0), best_token_bidder text, best_collection_bid numeric(78,0)' then
    raise exception 'Market view preflight failed: unexpected nfts_market_view columns: %. No change made.', coalesce(v_cols, '<no view>');
  end if;
end
$$;

create or replace view public.nfts_market_view
with (security_invoker = true)
as
select n.id,
       n.collection_address,
       n.token_id,
       n.owner_wallet,
       n.name,
       n.image_url,
       n.metadata,
       n.chain_id,
       l.price as listing_price,
       l.seller_wallet as listing_seller,
       l.expires_at as listing_expires_at,
       l.listing_id,
       tb.price as best_token_bid,
       tb.bidder_wallet as best_token_bidder,
       cb.price as best_collection_bid
  from public.nfts n
  left join public.listings l
    on l.chain_id = n.chain_id
   and l.collection_address = n.collection_address
   and l.token_id = n.token_id
   and l.is_active = true
  left join lateral (
    select token_bids.price, token_bids.bidder_wallet
      from public.token_bids
     where token_bids.chain_id = n.chain_id
       and token_bids.collection_address = n.collection_address
       and token_bids.token_id = n.token_id
       and token_bids.is_active = true
     order by token_bids.price desc
     limit 1
  ) tb on true
  left join lateral (
    select collection_bids.price
      from public.collection_bids
     where collection_bids.chain_id = n.chain_id
       and collection_bids.collection_address = n.collection_address
       and collection_bids.is_active = true
     order by collection_bids.price desc
     limit 1
  ) cb on true;

-- Postcondition.
do $$
declare
  v_def text := pg_get_viewdef('public.nfts_market_view'::regclass);
begin
  if not coalesce((select 'security_invoker=true' = any (reloptions) or 'security_invoker=on' = any (reloptions)
                   from pg_class where oid = 'public.nfts_market_view'::regclass), false) then
    raise exception 'Market view postcondition failed: security_invoker is not set';
  end if;
  if v_def !~ 'l\.chain_id = n\.chain_id' or v_def !~ 'token_bids\.chain_id = n\.chain_id' or v_def !~ 'collection_bids\.chain_id = n\.chain_id' then
    raise exception 'Market view postcondition failed: a join is not chain-scoped';
  end if;
  if not has_table_privilege('anon', 'public.nfts_market_view', 'SELECT')
     or not has_table_privilege('authenticated', 'public.nfts_market_view', 'SELECT') then
    raise exception 'Market view postcondition failed: anon/authenticated lost SELECT';
  end if;
  if has_table_privilege('anon', 'public.nfts_market_view', 'INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.nfts_market_view', 'INSERT, UPDATE, DELETE') then
    raise exception 'Market view postcondition failed: anon/authenticated can write the view';
  end if;
end
$$;

commit;
