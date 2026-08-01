-- supabase/realtime.sql
-- Enable Supabase Realtime (postgres_changes) for the marketplace tables.
--
-- Run this in the Supabase dashboard SQL editor. It is the dashboard step that
-- makes the frontend realtime backbone (hooks/useRealtimeTable.ts) fire:
-- without these rows in the `supabase_realtime` publication, every
-- subscription silently no-ops.
--
--   * listings         — already required by the listing flow (apply-once).
--   * token_bids / collection_bids — added for live bid updates (see below).
--
-- Re-run only the new `add table` lines if you already applied the listings
-- portion. Statements are idempotent-ish: adding a table already present is a
-- no-op.

-- 1) Publish the tables.
alter publication supabase_realtime add table public.listings;
alter publication supabase_realtime add table public.token_bids;
alter publication supabase_realtime add table public.collection_bids;

-- 2) The browser key is the `anon` role, so RLS must allow anon SELECT on the
--    subscribed tables. Listings already has this policy. The bid tables need
--    the same treatment or the subscription is denied. Enable per project:
--
--    create policy "anon can read token bids"
--      on public.token_bids for select to anon using (true);
--    create policy "anon can read collection bids"
--      on public.collection_bids for select to anon using (true);
--
-- 3) Optional column filtering (privacy / payload size): instead of
--    broadcasting every column, limit the publication columns to the subset
--    the frontend renders:
--
--    alter publication supabase_realtime set table
--      public.listings (id, listing_id, collection_address, token_id,
--                       seller_wallet, buyer_wallet, price, is_active,
--                       chain_id, listed_at, expires_at, tx_hash,
--                       created_at, updated_at, status, source),
--      public.token_bids (id, bidder_wallet, collection_address, token_id,
--                         price, is_active, seller_wallet, created_at,
--                         expires_at, updated_at),
--      public.collection_bids (id, bidder_wallet, collection_address, price,
--                              quantity, is_active, seller_wallet, created_at,
--                              expires_at, updated_at);
--
--    The frontend normalizers (lib/listingMerge.ts, lib/bidMerge.ts) already
--    tolerate a subset of columns, so filtering is safe.
