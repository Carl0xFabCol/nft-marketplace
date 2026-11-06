-- SEC-01: harden every SECURITY DEFINER function in the public schema.
--
-- The earlier migrations used a name-based list of six mutating functions.
-- That is not sufficient: a new or forgotten SECURITY DEFINER function would
-- keep the default PUBLIC EXECUTE grant. This migration defaults all
-- SECURITY DEFINER functions to service-role-only, then explicitly re-grants
-- only the known read-only RPCs used by the application.
--
-- We do not rewrite function bodies here. The migration logs owner, search
-- path, ACL, and a warning for SECURITY DEFINER functions that are not in the
-- known allowlist, so an operator can review them before exposing any new RPC.

begin;

do $$
declare
  fn record;
  owner_is_super boolean;
  read_allowlist text[] := array[
    'get_activity_by_source',
    'get_collection_nft_stats',
    'get_collection_stats',
    'get_collections_by_holders',
    'get_top_collections',
    'get_top_collections_volume_24h',
    'get_user_activity'
  ];
  mutating_allowlist text[] := array[
    'cleanup_expired_collection_bids',
    'cleanup_expired_listings',
    'cleanup_expired_token_bids',
    'expire_stale_records',
    'increment_collection_stats',
    'update_collection_floor_price',
    'sec01_save_listing_batch'
  ];
  known_pinned text[] := read_allowlist || mutating_allowlist;
begin
  for fn in
    select
      p.oid,
      p.oid::regprocedure as signature,
      p.proname,
      p.prosecdef,
      p.proconfig,
      p.proacl,
      p.proowner,
      pg_get_userbyid(p.proowner) as owner_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
    order by p.oid::regprocedure::text
  loop
    select r.rolsuper into owner_is_super
    from pg_roles r
    where r.oid = fn.proowner;

    raise notice
      'SEC-01 SECURITY DEFINER % owner=% superuser=% search_path=% acl=%',
      fn.signature,
      fn.owner_name,
      coalesce(owner_is_super, false),
      fn.proconfig,
      fn.proacl;

    if not coalesce(owner_is_super, false) then
      raise warning
        'SEC-01: SECURITY DEFINER % is owned by non-superuser %; review ownership',
        fn.signature,
        fn.owner_name;
    end if;

    -- Default deny for every SECURITY DEFINER function, including functions
    -- added after the original six-function migration.
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn.signature
    );
    execute format('grant execute on function %s to service_role', fn.signature);

    if fn.proname = any(known_pinned) then
      -- The known application functions all operate on public objects. Pinning
      -- this path removes caller-controlled schema resolution for DEFINER
      -- execution. Object references inside unknown bodies are not rewritten.
      execute format(
        'alter function %s set search_path = public, pg_temp',
        fn.signature
      );
    end if;

    if fn.proname = any(read_allowlist) then
      execute format(
        'grant execute on function %s to anon, authenticated',
        fn.signature
      );
    elsif not (fn.proname = any(mutating_allowlist)) then
      raise warning
        'SEC-01: SECURITY DEFINER % is not allowlisted; it remains service-role-only pending review',
        fn.signature;
    end if;
  end loop;
end
$$;

-- Postcondition: every SECURITY DEFINER function is service-role executable;
-- only allowlisted read RPCs are executable by untrusted roles; every known
-- application DEFINER function has a pinned search_path.
do $$
declare
  fn record;
  read_allowlist text[] := array[
    'get_activity_by_source',
    'get_collection_nft_stats',
    'get_collection_stats',
    'get_collections_by_holders',
    'get_top_collections',
    'get_top_collections_volume_24h',
    'get_user_activity'
  ];
  mutating_allowlist text[] := array[
    'cleanup_expired_collection_bids',
    'cleanup_expired_listings',
    'cleanup_expired_token_bids',
    'expire_stale_records',
    'increment_collection_stats',
    'update_collection_floor_price',
    'sec01_save_listing_batch'
  ];
  known_pinned text[] := read_allowlist || mutating_allowlist;
begin
  for fn in
    select p.oid, p.oid::regprocedure as signature, p.proname, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    if not has_function_privilege('service_role', fn.oid, 'EXECUTE') then
      raise exception 'SEC-01 postcondition failed: service_role cannot execute %', fn.signature;
    end if;

    if not (fn.proname = any(read_allowlist)) then
      if has_function_privilege('anon', fn.oid, 'EXECUTE')
         or has_function_privilege('authenticated', fn.oid, 'EXECUTE') then
        raise exception
          'SEC-01 postcondition failed: untrusted role can execute non-allowlisted SECURITY DEFINER %',
          fn.signature;
      end if;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(p.proacl) x
      where p.oid = fn.oid
        and x.grantee = 0::oid
    ) then
      raise exception
        'SEC-01 postcondition failed: PUBLIC EXECUTE remains on SECURITY DEFINER %',
        fn.signature;
    end if;

    if fn.proname = any(known_pinned)
       and not exists (
         select 1
         from unnest(coalesce(fn.proconfig, '{}'::text[])) cfg
         where cfg like 'search_path=%'
       ) then
      raise exception
        'SEC-01 postcondition failed: known SECURITY DEFINER % has no pinned search_path',
        fn.signature;
    end if;

    if not (fn.proname = any(read_allowlist))
       and fn.proname = any(mutating_allowlist) then
      if has_function_privilege('anon', fn.oid, 'EXECUTE')
         or has_function_privilege('authenticated', fn.oid, 'EXECUTE') then
        raise exception
          'SEC-01 postcondition failed: mutating SECURITY DEFINER % is executable by an untrusted role',
          fn.signature;
      end if;
    end if;
  end loop;
end
$$;

commit;
