-- SEC-01 catalog/privilege tests.
--
-- Run this against a disposable database that has the SEC-01 migrations applied.
-- It can be run directly with psql when the Supabase CLI's Docker-based pg_prove
-- runner is unavailable:
--   psql "$SEC01_TEST_DB_URL" -v ON_ERROR_STOP=1 \
--     -f packages/database/tests/sec01_rls_privileges.test.sql
--
-- The tests run inside a transaction that is rolled back. They include
-- constraint/RPC behavior checks that attempt writes, so do not point this at
-- production.

begin;

select no_plan();

select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles'),
  'RLS enabled on public.profiles'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'listings'),
  'RLS enabled on public.listings'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'nfts'),
  'RLS enabled on public.nfts'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'collections'),
  'RLS enabled on public.collections'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'activity'),
  'RLS enabled on public.activity'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'collection_bids'),
  'RLS enabled on public.collection_bids'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'token_bids'),
  'RLS enabled on public.token_bids'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'user_wallets'),
  'RLS enabled on public.user_wallets'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'nonces'),
  'RLS enabled on public.nonces'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'indexer_state'),
  'RLS enabled on public.indexer_state'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'contract_indexer_state'),
  'RLS enabled on public.contract_indexer_state'
);

select ok(
  exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indimmediate
      and i.indnkeyatts = 1
      and i.indpred is null
      and i.indexprs is null
      and a.attname = 'wallet'
  ),
  'profiles.wallet has a single-column unique index/constraint'
);
select ok(
  exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'user_wallets'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indimmediate
      and i.indnkeyatts = 1
      and i.indpred is null
      and i.indexprs is null
      and a.attname = 'wallet_address'
  ),
  'user_wallets.wallet_address has a single-column unique index/constraint'
);

select is(
  (
    select count(*)::bigint
    from public.profiles
    where wallet is not null
      and wallet::text <> lower(wallet::text)
  ),
  0::bigint,
  'profiles.wallet contains no non-lowercase values'
);
select is(
  (
    select count(*)::bigint
    from public.user_wallets
    where wallet_address is not null
      and wallet_address::text <> lower(wallet_address::text)
  ),
  0::bigint,
  'user_wallets.wallet_address contains no non-lowercase values'
);
select is(
  (
    select count(*)::bigint
    from (
      select lower(wallet) as wallet
      from public.profiles
      where wallet is not null
      group by lower(wallet)
      having count(*) > 1
    ) duplicates
  ),
  0::bigint,
  'profiles.wallet contains no case-insensitive duplicates'
);
select is(
  (
    select count(*)::bigint
    from (
      select lower(wallet_address) as wallet_address
      from public.user_wallets
      where wallet_address is not null
      group by lower(wallet_address)
      having count(*) > 1
    ) duplicates
  ),
  0::bigint,
  'user_wallets.wallet_address contains no case-insensitive duplicates'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'sec01_profiles_wallet_lowercase'
      and contype = 'c'
  ),
  'profiles.wallet has a lower-case canonicalization check'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_wallets'::regclass
      and conname = 'sec01_user_wallets_address_lowercase'
      and contype = 'c'
  ),
  'user_wallets.wallet_address has a lower-case canonicalization check'
);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = any (array[
        'profiles','listings','nfts','collections','activity',
        'collection_bids','token_bids','user_wallets','nonces',
        'indexer_state','contract_indexer_state'
      ])
      and x.grantee = 0::oid
  ),
  0::bigint,
  'PUBLIC has no column-level ACLs on SEC-01 tables'
);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and x.grantee = 'anon'::regrole::oid
      and x.privilege_type = 'SELECT'
      and a.attname in ('id', 'wallet', 'username', 'bio', 'avatar_url', 'created_at')
  ),
  6::bigint,
  'anon has exactly six public profile SELECT column grants'
);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = any (array[
        'profiles','listings','nfts','collections','activity',
        'collection_bids','token_bids','user_wallets','nonces',
        'indexer_state','contract_indexer_state'
      ])
      and x.grantee = 'authenticated'::regrole::oid
  ),
  9::bigint,
  'authenticated has exactly nine column-level ACL entries'
);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and a.attname in ('username', 'bio', 'avatar_url')
      and x.grantee = 'authenticated'::regrole::oid
      and x.privilege_type = 'UPDATE'
  ),
  3::bigint,
  'authenticated column grants are exactly profile username/bio/avatar_url UPDATE'
);

select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon has no table-level SELECT on profiles');
select ok(has_column_privilege('anon', 'public.profiles', 'wallet', 'SELECT'), 'anon can select the public profile wallet column');
select ok(has_table_privilege('anon', 'public.listings', 'SELECT'), 'anon can select listings');
select ok(has_table_privilege('anon', 'public.nfts', 'SELECT'), 'anon can select nfts');
select ok(has_table_privilege('anon', 'public.collections', 'SELECT'), 'anon can select collections');
select ok(has_table_privilege('anon', 'public.activity', 'SELECT'), 'anon can select activity');
select ok(has_table_privilege('anon', 'public.collection_bids', 'SELECT'), 'anon can select collection bids');
select ok(has_table_privilege('anon', 'public.token_bids', 'SELECT'), 'anon can select token bids');

select ok(not has_table_privilege('anon', 'public.profiles', 'UPDATE'), 'anon has no table-level UPDATE on profiles');
select ok(not has_table_privilege('anon', 'public.profiles', 'INSERT'), 'anon cannot insert profiles');
select ok(not has_table_privilege('anon', 'public.profiles', 'DELETE'), 'anon cannot delete profiles');
select ok(not has_table_privilege('anon', 'public.listings', 'INSERT'), 'anon cannot insert listings');
select ok(not has_table_privilege('anon', 'public.listings', 'UPDATE'), 'anon cannot update listings');
select ok(not has_table_privilege('anon', 'public.listings', 'DELETE'), 'anon cannot delete listings');

select ok(not has_table_privilege('anon', 'public.user_wallets', 'SELECT'), 'anon cannot select user_wallets');
select ok(not has_table_privilege('anon', 'public.user_wallets', 'INSERT'), 'anon cannot insert user_wallets');
select ok(not has_table_privilege('anon', 'public.user_wallets', 'UPDATE'), 'anon cannot update user_wallets');
select ok(not has_table_privilege('anon', 'public.user_wallets', 'DELETE'), 'anon cannot delete user_wallets');
select ok(not has_table_privilege('anon', 'public.nonces', 'SELECT'), 'anon cannot select nonces');
select ok(not has_table_privilege('anon', 'public.indexer_state', 'SELECT'), 'anon cannot select indexer_state');
select ok(not has_table_privilege('anon', 'public.contract_indexer_state', 'SELECT'), 'anon cannot select contract_indexer_state');

select ok(not has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated has no table-level SELECT on profiles');
select ok(has_column_privilege('authenticated', 'public.profiles', 'wallet', 'SELECT'), 'authenticated can select the public profile wallet column');

select ok(
  not exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in ('id', 'wallet', 'username', 'bio', 'avatar_url', 'created_at')
      and (
        has_column_privilege('anon', 'public.profiles', a.attname, 'SELECT')
        or has_column_privilege('authenticated', 'public.profiles', a.attname, 'SELECT')
      )
  ),
  'anon/authenticated cannot select non-public profiles columns'
);
select ok(has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE'), 'authenticated can update profiles.username');
select ok(has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE'), 'authenticated can update profiles.bio');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE'), 'authenticated can update profiles.avatar_url');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'wallet', 'UPDATE'), 'authenticated cannot update profiles.wallet');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), 'authenticated cannot update profiles.id');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE'), 'authenticated cannot update profiles.created_at');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated cannot insert profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated cannot delete profiles');

select ok(not has_table_privilege('authenticated', 'public.listings', 'INSERT'), 'authenticated cannot insert listings');
select ok(not has_table_privilege('authenticated', 'public.listings', 'UPDATE'), 'authenticated cannot update listings');
select ok(not has_table_privilege('authenticated', 'public.listings', 'DELETE'), 'authenticated cannot delete listings');
select ok(not has_table_privilege('authenticated', 'public.nfts', 'INSERT'), 'authenticated cannot insert nfts');
select ok(not has_table_privilege('authenticated', 'public.collections', 'UPDATE'), 'authenticated cannot update collections');
select ok(not has_table_privilege('authenticated', 'public.activity', 'INSERT'), 'authenticated cannot insert activity');
select ok(not has_table_privilege('authenticated', 'public.collection_bids', 'INSERT'), 'authenticated cannot insert collection bids');
select ok(not has_table_privilege('authenticated', 'public.token_bids', 'INSERT'), 'authenticated cannot insert token bids');
select ok(not has_table_privilege('authenticated', 'public.user_wallets', 'SELECT'), 'authenticated cannot select user_wallets');
select ok(not has_table_privilege('authenticated', 'public.nonces', 'SELECT'), 'authenticated cannot select nonces');

select ok(has_table_privilege('service_role', 'public.user_wallets', 'SELECT'), 'service_role can select user_wallets');
select ok(has_table_privilege('service_role', 'public.user_wallets', 'INSERT'), 'service_role can insert user_wallets');
select ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE'), 'service_role can update profiles');
select ok(has_table_privilege('service_role', 'public.listings', 'INSERT'), 'service_role can insert listings');
select ok(has_table_privilege('service_role', 'public.nonces', 'INSERT'), 'service_role can insert nonces');

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and policyname = 'sec01_profiles_public_read'),
  1::bigint,
  'profiles public read policy exists'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and policyname = 'sec01_profiles_owner_update'),
  1::bigint,
  'profiles owner update policy exists'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'listings' and policyname = 'sec01_public_read'),
  1::bigint,
  'listings public read policy exists'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'profiles'),
  2::bigint,
  'profiles has only the two SEC-01 policies'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'listings','nfts','collections','activity','collection_bids','token_bids'
      ])
      and permissive = 'RESTRICTIVE'
      and cmd in ('SELECT', 'ALL')
  ),
  'public-read tables have no restrictive policies that would block SEC-01 reads'
);
select ok(
  not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'nfts_market_view'
      and c.relkind = 'v'
  )
  or not exists (
    select 1
    from pg_rewrite rw
    join pg_depend d
      on d.objid = rw.oid
     and d.classid = 'pg_rewrite'::regclass
    join pg_class rc on rc.oid = d.refobjid
    join pg_namespace rn on rn.oid = rc.relnamespace
    where rw.ev_class = to_regclass('public.nfts_market_view')
      and d.refclassid = 'pg_class'::regclass
      and rc.oid <> to_regclass('public.nfts_market_view')
      and (
        rn.nspname <> 'public'
        or rc.relname <> all(array[
          'profiles','listings','nfts','collections','activity',
          'collection_bids','token_bids'
        ])
      )
  ),
  'nfts_market_view depends only on SEC-01 public-read relations'
);

select ok(
  not exists (
    select 1
    from pg_rewrite rw
    join pg_depend d
      on d.objid = rw.oid
     and d.classid = 'pg_rewrite'::regclass
    join pg_proc p on p.oid = d.refobjid
    join pg_namespace pn on pn.oid = p.pronamespace
    where rw.ev_class = to_regclass('public.nfts_market_view')
      and d.refclassid = 'pg_proc'::regclass
      and pn.nspname <> 'pg_catalog'
  ),
  'nfts_market_view invokes only pg_catalog functions'
);
select ok(
  not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'nfts_market_view'
      and c.relkind = 'v'
  )
  or exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(c.reloptions) opt
    where n.nspname = 'public'
      and c.relname = 'nfts_market_view'
      and c.relkind = 'v'
      and opt in ('security_invoker=true', 'security_invoker=on')
  ),
  'nfts_market_view uses security_invoker when present'
);
select ok(
  (
    select case
      when to_regclass('public.nfts_market_view') is null then true
      else has_table_privilege('anon', 'public.nfts_market_view', 'SELECT')
        and has_table_privilege('authenticated', 'public.nfts_market_view', 'SELECT')
        and not has_table_privilege('anon', 'public.nfts_market_view', 'INSERT')
        and not has_table_privilege('anon', 'public.nfts_market_view', 'UPDATE')
        and not has_table_privilege('anon', 'public.nfts_market_view', 'DELETE')
        and not has_table_privilege('authenticated', 'public.nfts_market_view', 'INSERT')
        and not has_table_privilege('authenticated', 'public.nfts_market_view', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.nfts_market_view', 'DELETE')
    end
  ),
  'nfts_market_view is read-only for anon and authenticated'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'cleanup_expired_collection_bids',
        'cleanup_expired_listings',
        'cleanup_expired_token_bids',
        'expire_stale_records',
        'increment_collection_stats',
        'update_collection_floor_price'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute mutating helper functions'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'cleanup_expired_collection_bids',
        'cleanup_expired_listings',
        'cleanup_expired_token_bids',
        'expire_stale_records',
        'increment_collection_stats',
        'update_collection_floor_price'
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated cannot execute mutating helper functions'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'cleanup_expired_collection_bids',
        'cleanup_expired_listings',
        'cleanup_expired_token_bids',
        'expire_stale_records',
        'increment_collection_stats',
        'update_collection_floor_price'
      )
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service_role can execute mutating helper functions'
);

select ok(
  exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'user_wallets'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indimmediate and i.indnkeyatts = 1
      and i.indpred is null and i.indexprs is null
      and a.attname = 'supabase_user_id'
  ),
  'user_wallets.supabase_user_id has a single-column unique index/constraint'
);
select ok(
  exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a0 on a0.attrelid = c.oid and a0.attnum = i.indkey[0]
    join pg_attribute a1 on a1.attrelid = c.oid and a1.attnum = i.indkey[1]
    join pg_attribute a2 on a2.attrelid = c.oid and a2.attnum = i.indkey[2]
    where n.nspname = 'public'
      and c.relname = 'listings'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indimmediate and i.indnkeyatts = 3
      and i.indpred is null and i.indexprs is null
      and a0.attname = 'chain_id'
      and a1.attname = 'collection_address'
      and a2.attname = 'token_id'
  ),
  'listings has a chain-scoped unique identity'
);
select ok(
  not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'listings'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indimmediate and i.indnkeyatts = 1
      and i.indpred is null and i.indexprs is null
      and a.attname = 'listing_id'
  ),
  'listings.listing_id is not a single-column uniqueness boundary'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.listings'::regclass
      and tgname = 'sec01_listings_tx_seller'
      and not tgisinternal
      and tgenabled = 'O'
  ),
  'listing tx/seller enforcement trigger exists and is enabled'
);

select throws_ok(
  $$
    insert into public.user_wallets (
      wallet_address, supabase_user_id, email, supabase_password
    ) values (
      '0x0000000000000000000000000000000000000004',
      '11111111-1111-4111-8111-111111111111',
      'duplicate-user@example.invalid', 'test-password'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "sec01_user_wallets_supabase_user_id_key"',
  'user_wallets rejects a duplicate supabase_user_id'
);

select is(
  public.sec01_save_listing_batch(
    '0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294',
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    99801,
    '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"50","price":"10","expires_at":null}]'::jsonb
  ),
  1,
  'listing RPC saves a seller-owned batch'
);
select is(
  public.sec01_save_listing_batch(
    '0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294',
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    99801,
    '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"51","price":"10","expires_at":null}]'::jsonb
  ),
  1,
  'listing RPC allows a repeated call with the same seller and tx hash'
);
select is(
  public.sec01_save_listing_batch(
    '0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294',
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    11155111,
    '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"50","price":"10","expires_at":null}]'::jsonb
  ),
  1,
  'listing RPC allows the same collection/token on a different chain'
);
select is(
  (
    select count(*)::bigint
    from public.listings
    where collection_address = '0x0000000000000000000000000000000000000010'
      and token_id = '50'
  ),
  2::bigint,
  'the same collection/token coexists across chains'
);
select is(
  public.sec01_save_listing_batch(
    '0x0000000000000000000000000000000000000002',
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    1,
    '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"50","price":"10","expires_at":null}]'::jsonb
  ),
  1,
  'the same tx hash may belong to another seller on a different chain'
);
select throws_ok(
  $$
    select public.sec01_save_listing_batch(
      '0x0000000000000000000000000000000000000002',
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      99801,
      '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"52","price":"10","expires_at":null}]'::jsonb
    )
  $$,
  '42501',
  'Forbidden: Transaction belongs to another wallet',
  'listing RPC rejects a tx hash owned by another seller on the same chain'
);
select throws_ok(
  $$
    select public.sec01_save_listing_batch(
      '0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294',
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      99801,
      '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"01","price":"10","expires_at":null}]'::jsonb
    )
  $$,
  '22023',
  'Invalid token id',
  'listing RPC rejects non-canonical token ids'
);
select throws_ok(
  $$
    insert into public.listings (
      listing_id, chain_id, collection_address, token_id, seller_wallet, price, tx_hash
    ) values (
      'duplicate-chain-identity', 99801,
      '0x0000000000000000000000000000000000000010', '50',
      '0x14730853915f8c5cf9c647dbc3ee7ebb9fe67294', 10,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "sec01_listings_chain_identity_key"',
  'listings reject duplicate chain-scoped identities'
);
select throws_ok(
  $$
    select public.sec01_save_listing_batch(
      '0x0000000000000000000000000000000000000002',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      99801,
      '[{"collection_address":"0x0000000000000000000000000000000000000010","token_id":"1","price":"10","expires_at":null}]'::jsonb
    )
  $$,
  '42501',
  'Forbidden: Listing belongs to another wallet',
  'listing RPC rejects overwriting another seller active listing'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.sec01_save_listing_batch(text,text,integer,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute the listing RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.sec01_save_listing_batch(text,text,integer,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute the listing RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.sec01_save_listing_batch(text,text,integer,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute the listing RPC'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) x
    where n.nspname = 'public'
      and p.prosecdef
      and x.grantee = 0::oid
  ),
  'no SECURITY DEFINER function retains a PUBLIC EXECUTE ACL'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service_role can execute every SECURITY DEFINER function'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'cleanup_expired_collection_bids',
        'cleanup_expired_listings',
        'expire_stale_records',
        'get_collection_stats',
        'increment_collection_stats',
        'update_collection_floor_price',
        'sec01_save_listing_batch'
      )
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  'known SECURITY DEFINER functions have a pinned search_path'
);

select * from finish();

rollback;
