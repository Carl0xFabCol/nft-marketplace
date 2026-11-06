-- SEC-01: wallet normalization, uniqueness preflight and constraints.
--
-- The login/update/indexer paths normalize EVM addresses to lower-case before
-- writing. This migration makes that canonical form a database invariant:
--   * profiles.wallet and user_wallets.wallet_address must equal lower(...);
--   * each profile wallet and each wallet mapping is globally unique.
--
-- A case-insensitive preflight plus a case-sensitive UNIQUE constraint is not
-- sufficient on its own: future writers could otherwise insert the same address
-- with different casing. The lower-case CHECK plus the unique constraint, with
-- the application's onConflict: "wallet" target, provides both guarantees.
--
-- Safety: no data is deleted or rewritten. If duplicates or non-canonical
-- addresses exist, the transaction aborts with sample values so an operator can
-- reconcile them manually. The migration is repeatable-safe and only accepts a
-- non-partial, non-expression single-column unique index as equivalent.

begin;

do $$
declare
  bad_count bigint;
  sample text;
begin
  -- Existing values must already be in canonical lower-case form.
  select count(*) into bad_count
  from public.profiles
  where wallet is not null
    and wallet::text <> lower(wallet::text);

  if bad_count > 0 then
    select string_agg(wallet, ', ') into sample
    from (
      select wallet
      from public.profiles
      where wallet is not null
        and wallet::text <> lower(wallet::text)
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % non-lowercase profiles.wallet value(s). Examples: %. No data was changed; canonicalize them to lower-case before applying this migration.',
      bad_count,
      sample;
  end if;

  select count(*) into bad_count
  from public.user_wallets
  where wallet_address is not null
    and wallet_address::text <> lower(wallet_address::text);

  if bad_count > 0 then
    select string_agg(wallet_address, ', ') into sample
    from (
      select wallet_address
      from public.user_wallets
      where wallet_address is not null
        and wallet_address::text <> lower(wallet_address::text)
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % non-lowercase user_wallets.wallet_address value(s). Examples: %. No data was changed; canonicalize them to lower-case before applying this migration.',
      bad_count,
      sample;
  end if;

  -- Case-insensitive duplicates must not exist before adding uniqueness.
  select count(*) into bad_count
  from (
    select 1
    from public.profiles
    where wallet is not null
    group by lower(wallet)
    having count(*) > 1
  ) duplicates;

  if bad_count > 0 then
    select string_agg(wallet, ', ') into sample
    from (
      select min(wallet) as wallet
      from public.profiles
      where wallet is not null
      group by lower(wallet)
      having count(*) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % case-insensitive duplicate profiles.wallet group(s). Examples: %. No data was changed; resolve duplicates before applying this migration.',
      bad_count,
      sample;
  end if;

  select count(*) into bad_count
  from (
    select 1
    from public.user_wallets
    where wallet_address is not null
    group by lower(wallet_address)
    having count(*) > 1
  ) duplicates;

  if bad_count > 0 then
    select string_agg(wallet_address, ', ') into sample
    from (
      select min(wallet_address) as wallet_address
      from public.user_wallets
      where wallet_address is not null
      group by lower(wallet_address)
      having count(*) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % case-insensitive duplicate user_wallets.wallet_address group(s). Examples: %. No data was changed; resolve duplicates before applying this migration.',
      bad_count,
      sample;
  end if;
end
$$;

-- Canonical lower-case checks must be added before or alongside uniqueness.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'sec01_profiles_wallet_lowercase'
  ) then
    execute 'alter table public.profiles add constraint sec01_profiles_wallet_lowercase check (wallet is null or wallet::text = lower(wallet::text))';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_wallets'::regclass
      and conname = 'sec01_user_wallets_address_lowercase'
  ) then
    execute 'alter table public.user_wallets add constraint sec01_user_wallets_address_lowercase check (wallet_address is null or wallet_address::text = lower(wallet_address::text))';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indimmediate
      and i.indnkeyatts = 1
      and i.indpred is null
      and i.indexprs is null
      and a.attname = 'wallet'
  ) then
    execute 'alter table public.profiles add constraint sec01_profiles_wallet_key unique (wallet)';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'user_wallets'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indimmediate
      and i.indnkeyatts = 1
      and i.indpred is null
      and i.indexprs is null
      and a.attname = 'wallet_address'
  ) then
    execute 'alter table public.user_wallets add constraint sec01_user_wallets_wallet_address_key unique (wallet_address)';
  end if;
end
$$;

commit;
