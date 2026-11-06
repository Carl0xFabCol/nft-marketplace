-- SEC-01: make optimistic batch listing writes atomic.
--
-- The TypeScript preflight in saveBatchListingToDB is only a usability check;
-- two concurrent requests can pass it and then race on the upsert. This
-- migration moves the ownership and transaction-hash invariants into the
-- database:
--   * one canonical listing_id per collection/token;
--   * a transaction hash may only carry listings from one seller;
--   * another seller may not overwrite an active listing;
--   * all rows in a batch either succeed or the whole RPC fails.
--
-- The RPC is service-role only. The web action still authenticates the wallet
-- before calling it; the database checks the seller against existing rows.

begin;

-- Preflight: different sellers must not already share a transaction hash.
do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from (
    select lower(tx_hash) as tx_hash
    from public.listings
    where tx_hash is not null
      and seller_wallet is not null
    group by lower(tx_hash)
    having count(distinct lower(seller_wallet)) > 1
  ) conflicts;

  if bad_count > 0 then
    select string_agg(tx_hash, ', ') into sample
    from (
      select lower(tx_hash) as tx_hash
      from public.listings
      where tx_hash is not null
        and seller_wallet is not null
      group by lower(tx_hash)
      having count(distinct lower(seller_wallet)) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % transaction hash(es) contain multiple sellers. Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

-- Preflight: listing_id is the upsert key, so non-null values must be unique.
do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from (
    select listing_id
    from public.listings
    where listing_id is not null
    group by listing_id
    having count(*) > 1
  ) duplicates;

  if bad_count > 0 then
    select string_agg(listing_id, ', ') into sample
    from (
      select listing_id
      from public.listings
      where listing_id is not null
      group by listing_id
      having count(*) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % duplicate listings.listing_id value(s). Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

-- Ensure ON CONFLICT (listing_id) has a valid unique index to target. Null
-- listing_id values remain allowed for legacy/indexer rows; PostgreSQL unique
-- constraints do not conflict on multiple NULLs.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'listings'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indimmediate
      and i.indnkeyatts = 1
      and i.indpred is null
      and i.indexprs is null
      and a.attname = 'listing_id'
  ) then
    execute 'alter table public.listings add constraint sec01_listings_listing_id_key unique (listing_id)';
  end if;
end
$$;

-- Enforce transaction-hash/seller consistency for every writer, including the
-- indexer and any future service-role caller. The advisory lock serializes
-- concurrent inserts for the same hash; the post-commit visibility check then
-- sees the first seller and rejects the second.
create or replace function public.sec01_enforce_listing_tx_seller()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tx text := lower(new.tx_hash);
  v_seller text := lower(new.seller_wallet);
begin
  if v_tx is null or v_seller is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sec01:listings:tx:' || v_tx, 0));

  if exists (
    select 1
    from public.listings l
    where l.id is distinct from new.id
      and l.tx_hash is not null
      and lower(l.tx_hash) = v_tx
      and l.seller_wallet is not null
      and lower(l.seller_wallet) <> v_seller
  ) then
    raise exception 'Forbidden: Transaction belongs to another wallet'
      using errcode = '42501';
  end if;

  return new;
end
$$;

revoke all on function public.sec01_enforce_listing_tx_seller() from public, anon, authenticated;

drop trigger if exists sec01_listings_tx_seller on public.listings;
create trigger sec01_listings_tx_seller
  before insert or update of tx_hash, seller_wallet
  on public.listings
  for each row
  execute function public.sec01_enforce_listing_tx_seller();

-- Atomic batch write. Rows are [{collection_address, token_id, price,
-- expires_at}]. listing_id is derived server-side so a caller cannot point the
-- upsert at a different collection/token pair.
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

  -- Serialize the transaction-hash check with the trigger and other RPC calls.
  perform pg_advisory_xact_lock(hashtextextended('sec01:listings:tx:' || v_tx, 0));

  if exists (
    select 1
    from public.listings l
    where l.tx_hash is not null
      and lower(l.tx_hash) = v_tx
      and l.seller_wallet is not null
      and lower(l.seller_wallet) <> v_seller
  ) then
    raise exception 'Forbidden: Transaction belongs to another wallet'
      using errcode = '42501';
  end if;

  -- Acquire per-listing locks in sorted order to avoid deadlocks between
  -- overlapping batches, then perform the conditional upsert below.
  for v_lock in
    select distinct lower(e->>'collection_address') || '-' || (e->>'token_id')
    from jsonb_array_elements(p_rows) e
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('sec01:listings:id:' || v_lock, 0));
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

    if v_token is null or v_token !~ '^\d{1,78}$' then
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

    v_listing_id := v_collection || '-' || v_token;

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
    on conflict (listing_id) do update
      set tx_hash = excluded.tx_hash,
          collection_address = excluded.collection_address,
          token_id = excluded.token_id,
          seller_wallet = excluded.seller_wallet,
          price = excluded.price,
          chain_id = excluded.chain_id,
          is_active = excluded.is_active,
          status = excluded.status,
          source = excluded.source,
          expires_at = excluded.expires_at,
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

commit;
