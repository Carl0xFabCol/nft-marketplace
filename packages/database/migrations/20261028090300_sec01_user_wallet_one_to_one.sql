-- SEC-01: one Supabase Auth user maps to one wallet.
--
-- The login flow creates a separate Supabase Auth user for each wallet and
-- stores that wallet's random internal credentials in user_wallets. There is
-- no multi-wallet-per-user flow or UI in this application, so a duplicate
-- supabase_user_id would make authentication ambiguous. requireWalletMatch()
-- currently fails closed on that ambiguity; this constraint prevents it.
--
-- This migration does not delete or rewrite mappings. If duplicates already
-- exist, it aborts with sample auth-user IDs for manual reconciliation.

begin;

do $$
declare
  bad_count bigint;
  sample text;
begin
  select count(*) into bad_count
  from (
    select supabase_user_id
    from public.user_wallets
    where supabase_user_id is not null
    group by supabase_user_id
    having count(*) > 1
  ) duplicates;

  if bad_count > 0 then
    select string_agg(supabase_user_id::text, ', ') into sample
    from (
      select supabase_user_id
      from public.user_wallets
      where supabase_user_id is not null
      group by supabase_user_id
      having count(*) > 1
      limit 10
    ) examples;

    raise exception
      'SEC-01 preflight failed: % duplicate user_wallets.supabase_user_id value(s). Examples: %. No data was changed; reconcile them before applying this migration.',
      bad_count,
      sample;
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
      and a.attname = 'supabase_user_id'
  ) then
    execute 'alter table public.user_wallets add constraint sec01_user_wallets_supabase_user_id_key unique (supabase_user_id)';
  end if;
end
$$;

commit;
