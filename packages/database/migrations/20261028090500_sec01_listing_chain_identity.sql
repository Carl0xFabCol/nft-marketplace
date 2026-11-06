-- SEC-01: make listing identity chain-aware.
--
-- A listing is uniquely identified by (chain_id, collection_address, token_id).
-- listing_id remains a human-readable derived value, but it is no longer the
-- uniqueness boundary because the same collection/token can exist on multiple
-- chains.

begin;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from public.listings
  where chain_id is null or chain_id <= 0;

  if bad_count > 0 then
    select string_agg(id::text, ', ') into sample
    from (
      select id
      from public.listings
      where chain_id is null or chain_id <= 0
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % listing row(s) have a null or invalid chain_id. Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from public.listings
  where collection_address is null
     or collection_address !~ '^0x[0-9a-f]{40}$';

  if bad_count > 0 then
    select string_agg(id::text, ', ') into sample
    from (
      select id
      from public.listings
      where collection_address is null
         or collection_address !~ '^0x[0-9a-f]{40}$'
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % listing row(s) have a non-canonical collection_address. Examples: %. No data was changed; normalize them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from public.listings
  where token_id is null
     or token_id !~ '^(0|[1-9][0-9]{0,77})$';

  if bad_count > 0 then
    select string_agg(id::text, ', ') into sample
    from (
      select id
      from public.listings
      where token_id is null
         or token_id !~ '^(0|[1-9][0-9]{0,77})$'
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % listing row(s) have a non-canonical token_id. Examples: %. No data was changed; normalize them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from (
    select chain_id, collection_address, token_id
    from public.listings
    group by chain_id, collection_address, token_id
    having count(*) > 1
  ) duplicates;

  if bad_count > 0 then
    select string_agg(identity, ', ') into sample
    from (
      select chain_id::text || ':' || collection_address || '-' || token_id as identity
      from public.listings
      group by chain_id, collection_address, token_id
      having count(*) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % duplicate chain-scoped listing identity value(s). Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from (
    select chain_id, lower(tx_hash) as tx_hash
    from public.listings
    where tx_hash is not null
      and seller_wallet is not null
    group by chain_id, lower(tx_hash)
    having count(distinct lower(seller_wallet)) > 1
  ) conflicts;

  if bad_count > 0 then
    select string_agg(chain_id::text || ':' || tx_hash, ', ') into sample
    from (
      select chain_id, lower(tx_hash) as tx_hash
      from public.listings
      where tx_hash is not null
        and seller_wallet is not null
      group by chain_id, lower(tx_hash)
      having count(distinct lower(seller_wallet)) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % chain-scoped transaction hash(es) contain multiple sellers. Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attname = 'listing_id'
    where n.nspname = 'public'
      and t.relname = 'listings'
      and c.contype = 'u'
      and c.conkey[1] = a.attnum
      and coalesce(array_length(c.conkey, 1), 0) = 1
  loop
    execute format('alter table public.listings drop constraint %I', r.conname);
  end loop;
end
$$;

do $$
declare
  r record;
begin
  for r in
    select i.indexrelid::regclass as index_name
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and t.relname = 'listings'
      and i.indisunique
      and i.indnkeyatts = 1
      and a.attname = 'listing_id'
      and not exists (
        select 1
        from pg_constraint c
        where c.conindid = i.indexrelid
      )
  loop
    execute format('drop index if exists %s', r.index_name);
  end loop;
end
$$;

alter table public.listings
  add constraint sec01_listings_chain_identity_key
  unique (chain_id, collection_address, token_id);

alter table public.listings
  add constraint sec01_listings_chain_id_positive
  check (chain_id > 0);

alter table public.listings
  add constraint sec01_listings_collection_canonical
  check (collection_address = lower(collection_address) and collection_address ~ '^0x[0-9a-f]{40}$');

alter table public.listings
  add constraint sec01_listings_token_canonical
  check (token_id ~ '^(0|[1-9][0-9]{0,77})$');

alter table public.listings
  alter column chain_id set not null;

update public.listings
set listing_id = chain_id::text || ':' || collection_address || '-' || token_id
where listing_id is distinct from chain_id::text || ':' || collection_address || '-' || token_id;

create or replace function public.sec01_enforce_listing_tx_seller()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tx text := lower(new.tx_hash);
  v_seller text := lower(new.seller_wallet);
  v_chain integer := new.chain_id;
begin
  if v_tx is null or v_seller is null then
    return new;
  end if;

  if v_chain is null or v_chain <= 0 then
    raise exception 'Invalid chain id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sec01:listings:tx:' || v_chain::text || ':' || v_tx, 0));

  if exists (
    select 1
    from public.listings l
    where l.id is distinct from new.id
      and l.chain_id = v_chain
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
  before insert or update of tx_hash, seller_wallet, chain_id
  on public.listings
  for each row
  execute function public.sec01_enforce_listing_tx_seller();

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
