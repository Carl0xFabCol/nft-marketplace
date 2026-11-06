-- SEC-01: enforce the database side of the wallet trust boundary.
--
-- Policy summary:
--   * public marketplace state is readable by anon/authenticated;
--   * all marketplace writes go through the service role (indexer + server actions);
--   * profile owners may update only username, bio and avatar_url;
--   * profiles.wallet is not writable by anon/authenticated;
--   * user_wallets, nonces and indexer state are service-role only.
--
-- The authoritative boundary is privilege-based. Existing policies on the
-- public-read tables are left in place, but they cannot grant access that the
-- table/column privileges below do not allow. Profiles policies are fully
-- replaced because authenticated clients get a narrow column-level UPDATE
-- grant there, and a pre-existing permissive UPDATE policy could otherwise
-- let them update another user's row.
--
-- This migration is repeatable-safe. It intentionally does not add unique
-- indexes; see 20261028090100_sec01_wallet_uniqueness.sql for the data
-- preflight and normalization checks.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'SEC-01 requires the Supabase roles anon, authenticated and service_role';
  end if;
end
$$;

-- Enable RLS and verify every required table exists.
do $$
declare
  tbl text;
  affected_tables text[] := array[
    'profiles',
    'listings',
    'nfts',
    'collections',
    'activity',
    'collection_bids',
    'token_bids',
    'user_wallets',
    'nonces',
    'indexer_state',
    'contract_indexer_state'
  ];
begin
  foreach tbl in array affected_tables loop
    if to_regclass(format('public.%I', tbl)) is null then
      raise exception 'SEC-01: required table public.% does not exist', tbl;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end
$$;

-- Reset table privileges to a known baseline.
revoke all on table
  public.profiles,
  public.listings,
  public.nfts,
  public.collections,
  public.activity,
  public.collection_bids,
  public.token_bids,
  public.user_wallets,
  public.nonces,
  public.indexer_state,
  public.contract_indexer_state
from public, anon, authenticated;

-- PostgreSQL stores column-level grants separately from table-level grants.
-- REVOKE ALL ON TABLE does not remove entries in pg_attribute.attacl, so
-- explicitly revoke every column privilege as well. This is important for
-- legacy grants such as UPDATE(profiles.wallet) or SELECT(user_wallets.*).
do $$
declare
  tbl text;
  col text;
  affected_tables text[] := array[
    'profiles',
    'listings',
    'nfts',
    'collections',
    'activity',
    'collection_bids',
    'token_bids',
    'user_wallets',
    'nonces',
    'indexer_state',
    'contract_indexer_state'
  ];
begin
  foreach tbl in array affected_tables loop
    for col in
      select a.attname
      from pg_attribute a
      where a.attrelid = to_regclass(format('public.%I', tbl))
        and a.attnum > 0
        and not a.attisdropped
    loop
      execute format(
        'revoke all (%I) on table public.%I from public, anon, authenticated',
        col,
        tbl
      );
    end loop;
  end loop;
end
$$;

-- Service role remains the only server-side writer. It bypasses RLS, but an
-- explicit grant keeps the login/indexer paths working after the revoke above.
grant select, insert, update, delete on table
  public.profiles,
  public.listings,
  public.nfts,
  public.collections,
  public.activity,
  public.collection_bids,
  public.token_bids,
  public.user_wallets,
  public.nonces,
  public.indexer_state,
  public.contract_indexer_state
to service_role;

-- Public marketplace reads. Profiles use an explicit column allowlist rather
-- than table-level SELECT so a future sensitive column (email, auth metadata,
-- moderation notes, etc.) is not published automatically.
grant select (id, wallet, username, bio, avatar_url, created_at)
  on table public.profiles
  to anon, authenticated;

grant select on table
  public.listings,
  public.nfts,
  public.collections,
  public.activity,
  public.collection_bids,
  public.token_bids
to anon, authenticated;

-- Profile owners may update only these columns. There is deliberately no
-- table-level UPDATE grant, so profiles.wallet/id/created_at are not writable
-- by anon or authenticated clients even if a future UPDATE policy is too broad.
grant update (username, bio, avatar_url) on table public.profiles to authenticated;

-- Replace all profiles policies. Logging the old definitions gives the
-- operator a migration-time audit trail; live policy definitions could not be
-- read through PostgREST before this migration was written.
do $$
declare
  pol record;
begin
  for pol in
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    raise notice
      'SEC-01 replacing profiles policy % (cmd %, roles %, using %, check %)',
      pol.policyname,
      pol.cmd,
      pol.roles,
      pol.qual,
      pol.with_check;
    execute format('drop policy %I on public.profiles', pol.policyname);
  end loop;
end
$$;

create policy sec01_profiles_public_read
  on public.profiles
  for select
  to anon, authenticated
  using (true);

create policy sec01_profiles_owner_update
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Add a permissive public-read policy to the marketplace tables. Existing
-- policies are preserved; because permissive policies are OR-ed, they cannot
-- restrict these public reads. Client writes remain impossible because no
-- INSERT/UPDATE/DELETE table or column privileges are granted.
do $$
declare
  tbl text;
  read_tables text[] := array[
    'listings',
    'nfts',
    'collections',
    'activity',
    'collection_bids',
    'token_bids'
  ];
begin
  foreach tbl in array read_tables loop
    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and permissive = 'RESTRICTIVE'
        and cmd in ('SELECT', 'ALL')
    ) then
      raise exception
        'SEC-01: public.% has restrictive policies; refusing to add public reads without operator review',
        tbl;
    end if;

    execute format('drop policy if exists sec01_public_read on public.%I', tbl);
    execute format(
      'create policy sec01_public_read on public.%I for select to anon, authenticated using (true)',
      tbl
    );
  end loop;
end
$$;

-- user_wallets, nonces, indexer_state and contract_indexer_state intentionally
-- receive no anon/authenticated table or column privileges. Existing policies
-- are left untouched: without privileges they are unreachable from PostgREST,
-- while the service role bypasses RLS.

-- Mutating helper functions must not be callable by untrusted clients.
-- Read-only get_* functions remain available to anon/auth. Log the actual
-- SECURITY DEFINER state at deploy time and warn if the definition is not
-- hardened; this migration does not rewrite function bodies.
do $$
declare
  fn record;
  mutating_functions text[] := array[
    'cleanup_expired_collection_bids',
    'cleanup_expired_listings',
    'cleanup_expired_token_bids',
    'expire_stale_records',
    'increment_collection_stats',
    'update_collection_floor_price'
  ];
begin
  for fn in
    select p.oid::regprocedure as signature, p.prosecdef, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(mutating_functions)
  loop
    raise notice
      'SEC-01 execute grants for % (security_definer=%, config=%)',
      fn.signature,
      fn.prosecdef,
      fn.proconfig;

    if fn.prosecdef
       and (fn.proconfig is null
            or not exists (
              select 1 from unnest(fn.proconfig) cfg where cfg like 'search_path=%'
            )) then
      raise warning
        'SEC-01: % is SECURITY DEFINER without a pinned search_path; review separately',
        fn.signature;
    end if;

    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;

-- Make the aggregate view obey the underlying table RLS policies, but only
-- after proving it depends solely on relations in the public-read set.
-- Otherwise fail rather than silently changing an unverified view.
do $$
declare
  view_oid regclass := to_regclass('public.nfts_market_view');
  view_kind text;
  view_column text;
  bad_relations text;
  bad_functions text;
  allowed_relations text[] := array[
    'profiles',
    'listings',
    'nfts',
    'collections',
    'activity',
    'collection_bids',
    'token_bids'
  ];
begin
  if view_oid is null then
    return;
  end if;

  select c.relkind::text into view_kind
  from pg_class c
  where c.oid = view_oid;

  if view_kind <> 'v' then
    raise exception
      'SEC-01: public.nfts_market_view exists but is not an ordinary view (relkind=%)',
      view_kind;
  end if;

  select string_agg(distinct format('%I.%I', rn.nspname, rc.relname), ', ')
  into bad_relations
  from pg_rewrite rw
  join pg_depend d
    on d.objid = rw.oid
   and d.classid = 'pg_rewrite'::regclass
  join pg_class rc on rc.oid = d.refobjid
  join pg_namespace rn on rn.oid = rc.relnamespace
  where rw.ev_class = view_oid
    and d.refclassid = 'pg_class'::regclass
    and rc.oid <> view_oid
    and (
      rn.nspname <> 'public'
      or rc.relname <> all(allowed_relations)
    );

  if bad_relations is not null then
    raise exception
      'SEC-01: refusing security_invoker on public.nfts_market_view because it depends on relation(s) outside the SEC-01 public-read set: %',
      bad_relations;
  end if;

  select string_agg(
           distinct format(
             '%I.%I(%s)',
             pn.nspname,
             p.proname,
             pg_get_function_identity_arguments(p.oid)
           ),
           ', '
         )
  into bad_functions
  from pg_rewrite rw
  join pg_depend d
    on d.objid = rw.oid
   and d.classid = 'pg_rewrite'::regclass
  join pg_proc p on p.oid = d.refobjid
  join pg_namespace pn on pn.oid = p.pronamespace
  where rw.ev_class = view_oid
    and d.refclassid = 'pg_proc'::regclass
    and pn.nspname <> 'pg_catalog';

  if bad_functions is not null then
    raise exception
      'SEC-01: refusing security_invoker on public.nfts_market_view because it invokes non-pg_catalog function(s): %',
      bad_functions;
  end if;

  execute 'alter view public.nfts_market_view set (security_invoker = on)';

  -- Normalize the view's own ACL too. The view is readable only; writes must
  -- continue to use the service role and the base tables.
  for view_column in
    select a.attname
    from pg_attribute a
    where a.attrelid = view_oid
      and a.attnum > 0
      and not a.attisdropped
  loop
    execute format(
      'revoke all (%I) on table public.nfts_market_view from public, anon, authenticated',
      view_column
    );
  end loop;
  execute 'revoke all on table public.nfts_market_view from public, anon, authenticated';
  execute 'grant select on table public.nfts_market_view to anon, authenticated';
end
$$;

-- Postcondition: fail the transaction if inherited/custom grants left an
-- untrusted client with an unintended effective privilege.
do $$
declare
  tbl text;
  role_name text;
  priv text;
  read_tables text[] := array[
    'profiles',
    'listings',
    'nfts',
    'collections',
    'activity',
    'collection_bids',
    'token_bids'
  ];
  protected_tables text[] := array[
    'user_wallets',
    'nonces',
    'indexer_state',
    'contract_indexer_state'
  ];
begin
  foreach tbl in array read_tables loop
    foreach role_name in array array['anon', 'authenticated'] loop
      foreach priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name::name, format('public.%I', tbl), priv) then
          raise exception
            'SEC-01 postcondition failed: % still has % on public.%',
            role_name,
            priv,
            tbl;
        end if;
      end loop;
    end loop;
  end loop;

  foreach tbl in array protected_tables loop
    foreach role_name in array array['anon', 'authenticated'] loop
      foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name::name, format('public.%I', tbl), priv) then
          raise exception
            'SEC-01 postcondition failed: % still has % on protected table public.%',
            role_name,
            priv,
            tbl;
        end if;
      end loop;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.profiles', 'SELECT')
     or has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'SEC-01 postcondition failed: profiles still has table-level SELECT';
  end if;
  if not has_column_privilege('anon', 'public.profiles', 'wallet', 'SELECT')
     or not has_column_privilege('authenticated', 'public.profiles', 'wallet', 'SELECT') then
    raise exception 'SEC-01 postcondition failed: profiles public columns are not readable';
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE') then
    raise exception 'SEC-01 postcondition failed: authenticated cannot update profiles.username';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE') then
    raise exception 'SEC-01 postcondition failed: authenticated cannot update profiles.bio';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE') then
    raise exception 'SEC-01 postcondition failed: authenticated cannot update profiles.avatar_url';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'wallet', 'UPDATE') then
    raise exception 'SEC-01 postcondition failed: authenticated can update profiles.wallet';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles','listings','nfts','collections','activity',
        'collection_bids','token_bids','user_wallets','nonces',
        'indexer_state','contract_indexer_state'
      ])
      and x.grantee = 0::oid
  ) then
    raise exception 'SEC-01 postcondition failed: PUBLIC column-level ACLs remain';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles','listings','nfts','collections','activity',
        'collection_bids','token_bids','user_wallets','nonces',
        'indexer_state','contract_indexer_state'
      ])
      and x.grantee = 'anon'::regrole::oid
      and not (
        c.relname = 'profiles'
        and a.attname in ('id', 'wallet', 'username', 'bio', 'avatar_url', 'created_at')
        and x.privilege_type = 'SELECT'
        and not x.is_grantable
      )
  ) then
    raise exception 'SEC-01 postcondition failed: unexpected anon column-level ACL remains';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum > 0
     and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles','listings','nfts','collections','activity',
        'collection_bids','token_bids','user_wallets','nonces',
        'indexer_state','contract_indexer_state'
      ])
      and x.grantee = 'authenticated'::regrole::oid
      and not (
        c.relname = 'profiles'
        and (
          (
            a.attname in ('id', 'wallet', 'username', 'bio', 'avatar_url', 'created_at')
            and x.privilege_type = 'SELECT'
          )
          or (
            a.attname in ('username', 'bio', 'avatar_url')
            and x.privilege_type = 'UPDATE'
          )
        )
        and not x.is_grantable
      )
  ) then
    raise exception 'SEC-01 postcondition failed: unexpected authenticated column-level ACL remains';
  end if;

  if not has_table_privilege('service_role', 'public.user_wallets', 'SELECT') then
    raise exception 'SEC-01 postcondition failed: service_role cannot read user_wallets';
  end if;

  if to_regclass('public.nfts_market_view') is not null then
    if not has_table_privilege('anon', 'public.nfts_market_view', 'SELECT')
       or not has_table_privilege('authenticated', 'public.nfts_market_view', 'SELECT') then
      raise exception 'SEC-01 postcondition failed: nfts_market_view is not readable by anon/authenticated';
    end if;
    if has_table_privilege('anon', 'public.nfts_market_view', 'INSERT')
       or has_table_privilege('anon', 'public.nfts_market_view', 'UPDATE')
       or has_table_privilege('anon', 'public.nfts_market_view', 'DELETE')
       or has_table_privilege('authenticated', 'public.nfts_market_view', 'INSERT')
       or has_table_privilege('authenticated', 'public.nfts_market_view', 'UPDATE')
       or has_table_privilege('authenticated', 'public.nfts_market_view', 'DELETE') then
      raise exception 'SEC-01 postcondition failed: nfts_market_view has write privileges for anon/authenticated';
    end if;
  end if;
end
$$;

commit;
