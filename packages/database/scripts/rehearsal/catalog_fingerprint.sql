-- Read-only catalog fingerprint of the public schema (Phase 2 runbook).
--
-- Safe on production: SELECT only, and it prints definitions, never row data.
-- Run with exactly these psql flags so the output is comparable:
--   psql "<db url>" -X -At -F ' | ' -f catalog_fingerprint.sql > fingerprint.txt
-- Then compare:
--   before the migrations: diff with catalog_fingerprint.before.txt
--   after 090000..091100:  diff with catalog_fingerprint.after.txt
--   after 090000..091600:  diff with catalog_fingerprint.after_phase3b.txt (Phase 3B)
-- Both expected files were produced on the local rehearsal stack. "before"
-- is byte-identical for the committed baseline and for the restored
-- production backup.
select 'col', c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)||' nn='||a.attnotnull||' def='||coalesce(pg_get_expr(d.adbin,d.adrelid),'') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname='public' and a.attnum>0 and not a.attisdropped and c.relkind in ('r','v')
union all select 'con', conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
union all select 'idx', indexrelid::regclass||' '||pg_get_indexdef(indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace
union all select 'fn', p.oid::regprocedure||' secdef='||prosecdef||' cfg='||coalesce(proconfig::text,'')||' md5='||md5(prosrc) from pg_proc p where pronamespace='public'::regnamespace
union all select 'pol', tablename||' '||policyname||' '||cmd||' '||roles::text||' '||coalesce(qual,'')||' '||coalesce(with_check,'') from pg_policies where schemaname='public'
union all select 'trg', tgrelid::regclass||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)
union all select 'rls', relname||' '||relrowsecurity||' '||relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'acl', relname||' '||coalesce(relacl::text,'') from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','S')
union all select 'facl', p.oid::regprocedure||' '||coalesce(proacl::text,'') from pg_proc p where pronamespace='public'::regnamespace
union all select 'view', 'nfts_market_view md5='||md5(pg_get_viewdef('public.nfts_market_view'::regclass))
union all select 'owner', relname||' '||pg_get_userbyid(relowner) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','S')
order by 1,2;
