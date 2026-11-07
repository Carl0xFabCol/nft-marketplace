-- Audit M-7 (SEC-01 P1.6): a relist clears the previous sale's buyer_wallet.
--
-- Before: when a token is sold, the indexer deactivates its listing and
-- stores buyer_wallet. When the new owner relists, the row is reused, both
-- through sec01_save_listing_batch's ON CONFLICT ... DO UPDATE and through
-- the indexer upsert, and buyer_wallet keeps the old buyer.
-- apps/web/lib/listingMerge.ts then treats the active listing as stale
-- (buyer_wallet differs from the owner) and hides it.
--
-- This migration replaces sec01_save_listing_batch with an exact copy of the
-- 20261028090500 version, plus one line in the ON CONFLICT update:
--   buyer_wallet = null
-- Everything else is unchanged:
--   * SECURITY DEFINER;
--   * search_path = public, pg_temp;
--   * EXECUTE revoked from public/anon/authenticated and granted only to
--     service_role.
-- The indexer side (ListingsRepository.upsert sends buyer_wallet: null) ships
-- in the same deploy.
--
-- Depends on: 20261028090500 (chain identity: conflict target
--   (chain_id, collection_address, token_id)) and 20261028090400 (definer
--   hardening policy). The signature is unchanged, so callers are unaffected.
-- Re-runnable: CREATE OR REPLACE and the REVOKE/GRANT are idempotent.

begin;

set local lock_timeout = '5s';

-- Preflight: the function being replaced must exist with this signature.
do $$
begin
  if to_regprocedure('public.sec01_save_listing_batch(text, text, integer, jsonb)') is null then
    raise exception 'M-7 preflight failed: sec01_save_listing_batch(text, text, integer, jsonb) missing; apply 20261028090500 first. No change made.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.listings'::regclass and conname = 'sec01_listings_chain_identity_key'
  ) then
    raise exception 'M-7 preflight failed: sec01_listings_chain_identity_key missing; apply 20261028090500 first. No change made.';
  end if;
end
$$;

create or replace function public.sec01_save_listing_batch(
  p_seller text,
  p_tx_hash text,
  p_chain_id integer,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller text := lower(p_seller);
  v_tx text := lower(p_tx_hash);
  v_row jsonb;
  v_collection text;
  v_token text;
  v_price_text text;
  v_price numeric;
  v_expires_text text;
  v_expires timestamptz;
  v_listing_id text;
  v_lock text;
  v_affected integer;
  v_total integer := 0;
begin
  if v_seller is null or v_seller !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid seller address' using errcode = '22023';
  end if;

  if v_tx is null or v_tx !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Invalid transaction hash' using errcode = '22023';
  end if;

  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'Invalid chain id' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid listing rows' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception 'Invalid batch size' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) e
    group by lower(e->>'collection_address'), e->>'token_id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate listing in batch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sec01:listings:tx:' || p_chain_id::text || ':' || v_tx, 0));

  if exists (
    select 1
    from public.listings l
    where l.chain_id = p_chain_id
      and l.tx_hash is not null
      and lower(l.tx_hash) = v_tx
      and l.seller_wallet is not null
      and lower(l.seller_wallet) <> v_seller
  ) then
    raise exception 'Forbidden: Transaction belongs to another wallet'
      using errcode = '42501';
  end if;

  for v_lock in
    select distinct lower(e->>'collection_address') || '-' || (e->>'token_id')
    from jsonb_array_elements(p_rows) e
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('sec01:listings:id:' || p_chain_id::text || ':' || v_lock, 0));
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Invalid listing row' using errcode = '22023';
    end if;

    v_collection := lower(v_row->>'collection_address');
    v_token := v_row->>'token_id';
    v_price_text := v_row->>'price';
    v_expires_text := nullif(v_row->>'expires_at', '');
    v_expires := null;

    if v_collection is null or v_collection !~ '^0x[0-9a-f]{40}$' then
      raise exception 'Invalid collection address' using errcode = '22023';
    end if;

    if v_token is null or v_token !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception 'Invalid token id' using errcode = '22023';
    end if;

    if v_price_text is null or v_price_text !~ '^\d{1,78}$' then
      raise exception 'Invalid price' using errcode = '22023';
    end if;

    v_price := v_price_text::numeric;
    if v_price <= 0 then
      raise exception 'Invalid price' using errcode = '22023';
    end if;

    if v_expires_text is not null then
      begin
        v_expires := v_expires_text::timestamptz;
      exception when others then
        raise exception 'Invalid expiration' using errcode = '22007';
      end;
    end if;

    v_listing_id := p_chain_id::text || ':' || v_collection || '-' || v_token;

    insert into public.listings (
      listing_id,
      tx_hash,
      collection_address,
      token_id,
      seller_wallet,
      price,
      chain_id,
      is_active,
      status,
      source,
      expires_at,
      created_at
    )
    values (
      v_listing_id,
      v_tx,
      v_collection,
      v_token,
      v_seller,
      v_price,
      p_chain_id,
      true,
      'pending',
      'optimistic',
      v_expires,
      now()
    )
    on conflict (chain_id, collection_address, token_id) do update
      set listing_id = excluded.listing_id,
          tx_hash = excluded.tx_hash,
          seller_wallet = excluded.seller_wallet,
          price = excluded.price,
          is_active = excluded.is_active,
          status = excluded.status,
          source = excluded.source,
          expires_at = excluded.expires_at,
          buyer_wallet = null,
          updated_at = now()
      where lower(public.listings.seller_wallet) = excluded.seller_wallet
         or public.listings.is_active is false;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Forbidden: Listing belongs to another wallet'
        using errcode = '42501';
    end if;

    v_total := v_total + 1;
  end loop;

  return v_total;
end
$$;

revoke all on function public.sec01_save_listing_batch(text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.sec01_save_listing_batch(text, text, integer, jsonb)
  to service_role;

-- Postcondition.
do $$
declare
  v_fn regprocedure := to_regprocedure('public.sec01_save_listing_batch(text, text, integer, jsonb)');
  v_def text;
begin
  if not exists (select 1 from pg_proc where oid = v_fn and prosecdef) then
    raise exception 'M-7 postcondition failed: sec01_save_listing_batch is not SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = v_fn and proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'M-7 postcondition failed: sec01_save_listing_batch search_path is not pinned to public, pg_temp';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or exists (
       select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception 'M-7 postcondition failed: sec01_save_listing_batch is executable by PUBLIC, anon or authenticated';
  end if;

  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'M-7 postcondition failed: service_role cannot execute sec01_save_listing_batch';
  end if;

  select prosrc into v_def from pg_proc where oid = v_fn;
  if v_def !~ 'buyer_wallet = null' then
    raise exception 'M-7 postcondition failed: ON CONFLICT update does not clear buyer_wallet';
  end if;
end
$$;

commit;
