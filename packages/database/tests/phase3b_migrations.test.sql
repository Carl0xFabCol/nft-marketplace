-- Phase 3B migration tests (20261028091200 ..): for each migration, the
-- object exists with its intended shape, a negative test, and privilege checks
-- (anon and authenticated cannot EXECUTE any new or changed function).
--
-- Run against a disposable database with the baseline and every migration
-- applied, e.g.
--   psql "$SEC01_TEST_DB_URL" -v ON_ERROR_STOP=1 -f packages/database/tests/phase3b_migrations.test.sql
-- or through `pnpm --filter @marketplace/database test:rls`.
--
-- Everything runs in one transaction that is rolled back. The tests write
-- rows, so never point this at production.

begin;

select no_plan();

-- Fixtures (rolled back). Addresses 0x...c1 / 0x...c2 are only used here.
--   collection C1 on 99801 and on 11155111 (same address on two chains)
insert into public.collections (contract_address, chain_id, total_volume, total_sales) values
  ('0x00000000000000000000000000000000000000c1', 99801, 0.215, 6),
  ('0x00000000000000000000000000000000000000c1', 11155111, 0, 0);

-- Helper for the privilege checks: true when the role can EXECUTE the function.
create temporary table p3b_fn (sig text primary key) on commit drop;

-- ─── 091200: indexer_record_sale ────────────────────────────────────────────

insert into p3b_fn values ('public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)');

select has_function(
  'public', 'indexer_record_sale',
  array['integer', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'timestamp with time zone', 'text'],
  '091200 indexer_record_sale exists with the expected signature'
);
select is_definer('public', 'indexer_record_sale',
  array['integer', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'timestamp with time zone', 'text'],
  '091200 indexer_record_sale is SECURITY DEFINER');
select ok(
  (select proconfig @> array['search_path=public, pg_temp'] from pg_proc
   where oid = 'public.indexer_record_sale(integer, text, text, text, text, text, text, integer, timestamptz, text)'::regprocedure),
  '091200 indexer_record_sale pins search_path = public, pg_temp'
);

select is(
  public.indexer_record_sale(99801, '0x00000000000000000000000000000000000000C1', '1', '0xA', '0xB',
    '1234567890123456789', '0x' || repeat('c1', 32), 5, '2026-11-07T00:00:00Z', 'core'),
  true, '091200 a fresh Sale returns true');
select is(
  public.indexer_record_sale(99801, '0x00000000000000000000000000000000000000c1', '1', '0xa', '0xb',
    '1234567890123456789', '0x' || repeat('C1', 32), 5, '2026-11-07T00:00:00Z', 'core'),
  false, '091200 a replayed Sale (same tx_hash, log_index; any case) returns false');
select is(
  (select total_volume::text || '/' || total_sales::text from public.collections
   where chain_id = 99801 and contract_address = '0x00000000000000000000000000000000000000c1'),
  '1.449567890123456789/7',
  '091200 the Sale is counted once, with exact wei -> ether'
);
select is(
  (select total_volume::text || '/' || total_sales::text from public.collections
   where chain_id = 11155111 and contract_address = '0x00000000000000000000000000000000000000c1'),
  '0/0',
  '091200 the same address on another chain is untouched'
);
select is(
  (select count(*)::int from public.activity where tx_hash = '0x' || repeat('c1', 32)),
  1, '091200 exactly one SALE activity row'
);
select throws_ok(
  $$select public.indexer_record_sale(99801, '0x00000000000000000000000000000000000000c1', '1', '0xa', '0xb',
      '1.5', '0x' || repeat('c2', 32), 0, now(), 'core')$$,
  '22023', null,
  '091200 negative: a non-integer wei price is rejected'
);
select throws_ok(
  $$select public.indexer_record_sale(0, '0x00000000000000000000000000000000000000c1', '1', '0xa', '0xb',
      '1', '0x' || repeat('c2', 32), 0, now(), 'core')$$,
  '22023', null,
  '091200 negative: chain_id 0 is rejected'
);

-- ─── Privileges: every new or changed function ──────────────────────────────

select ok(
  not exists (select 1 from p3b_fn where has_function_privilege('anon', sig::regprocedure, 'EXECUTE')),
  'anon cannot EXECUTE any Phase 3B function'
);
select ok(
  not exists (select 1 from p3b_fn where has_function_privilege('authenticated', sig::regprocedure, 'EXECUTE')),
  'authenticated cannot EXECUTE any Phase 3B function'
);
select ok(
  not exists (
    select 1 from p3b_fn f, pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = f.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE on any Phase 3B function'
);
select ok(
  not exists (select 1 from p3b_fn where not has_function_privilege('service_role', sig::regprocedure, 'EXECUTE')),
  'service_role can EXECUTE every Phase 3B function'
);
select is(
  (select count(*)::int from p3b_fn f join pg_proc p on p.oid = f.sig::regprocedure
   where not coalesce(p.proconfig @> array['search_path=public, pg_temp'], false)),
  0, 'every Phase 3B function pins search_path = public, pg_temp'
);

set local role anon;
select throws_ok(
  $$select public.indexer_record_sale(99801, '0x00000000000000000000000000000000000000c1', '1', '0xa', '0xb',
      '1', '0x' || repeat('c3', 32), 0, now(), 'core')$$,
  '42501', null,
  'negative: anon calling indexer_record_sale gets 42501'
);
reset role;

select * from finish();

rollback;
