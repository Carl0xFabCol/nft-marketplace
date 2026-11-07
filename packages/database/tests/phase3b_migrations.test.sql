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

-- ─── 091300: M-5 chain-scoped RPCs ──────────────────────────────────────────

insert into p3b_fn values
  ('public.increment_collection_stats(integer, text, numeric, integer)'),
  ('public.get_collection_stats(integer, text)'),
  ('public.update_collection_floor_price(integer, text)'),
  ('public.get_top_collections(integer, integer, text)'),
  ('public.cleanup_expired_listings(integer)'),
  ('public.cleanup_expired_token_bids(integer)'),
  ('public.cleanup_expired_collection_bids(integer)'),
  ('public.trigger_update_floor_price()'),
  ('public.update_floor_price()');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('increment_collection_stats', 'get_collection_stats', 'update_collection_floor_price',
                       'get_top_collections', 'cleanup_expired_listings', 'cleanup_expired_token_bids',
                       'cleanup_expired_collection_bids')),
  7, '091300 one overload per M-5 function'
);
select hasnt_function('public', 'increment_collection_stats', array['text', 'numeric', 'integer'],
  '091300 negative: chain-less increment_collection_stats is gone');
select hasnt_function('public', 'get_collection_stats', array['text'], '091300 negative: chain-less get_collection_stats is gone');
select hasnt_function('public', 'update_collection_floor_price', array['text'], '091300 negative: chain-less update_collection_floor_price is gone');
select hasnt_function('public', 'get_top_collections', array['integer', 'text'], '091300 negative: chain-less get_top_collections is gone');
select hasnt_function('public', 'cleanup_expired_listings', array[]::text[], '091300 negative: zero-arg cleanup_expired_listings is gone');
select hasnt_function('public', 'cleanup_expired_token_bids', array[]::text[], '091300 negative: zero-arg cleanup_expired_token_bids is gone');
select hasnt_function('public', 'cleanup_expired_collection_bids', array[]::text[], '091300 negative: zero-arg cleanup_expired_collection_bids is gone');
select ok(
  not exists (select 1 from p3b_fn f join pg_proc p on p.oid = f.sig::regprocedure
              where p.proname <> 'indexer_record_sale' and p.prosecdef),
  '091300 the M-5 and trigger functions stay SECURITY INVOKER'
);

-- Fixtures: an nft and an active listing on 99801 only (same address exists on 11155111).
insert into public.nfts (collection_address, token_id, owner_wallet, chain_id) values
  ('0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 99801),
  ('0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 11155111);
insert into public.listings (collection_address, token_id, chain_id, price, tx_hash, seller_wallet, listing_id, is_active) values
  ('0x00000000000000000000000000000000000000c1', '1', 99801, 1234567890123456789, '0x01',
   '0x00000000000000000000000000000000000000d1', '99801:0x00000000000000000000000000000000000000c1-1', true);

select is(
  (select floor_price::text from public.collections where chain_id = 99801 and contract_address = '0x00000000000000000000000000000000000000c1'),
  '1234567890123456789', '091300 the floor trigger sets the floor on the listing''s chain'
);
select is(
  (select floor_price from public.collections where chain_id = 11155111 and contract_address = '0x00000000000000000000000000000000000000c1'),
  null, '091300 negative: the floor trigger leaves the same address on another chain alone'
);
select is(
  (select floor_price || '/' || listed_count || '/' || items_count
   from public.get_collection_stats(99801, '0x00000000000000000000000000000000000000C1')),
  '1234567890123456789/1/1', '091300 get_collection_stats runs (no 42804) and is chain-scoped'
);
select is(
  (select count(*)::int from public.get_top_collections(11155111)
   where contract_address = '0x00000000000000000000000000000000000000c1' and floor_price is null),
  1, '091300 get_top_collections is chain-scoped'
);
select lives_ok(
  $$select public.increment_collection_stats(11155111, '0x00000000000000000000000000000000000000c1', 2, 3)$$,
  '091300 increment_collection_stats(chain, ...) runs'
);
select is(
  (select string_agg(chain_id || ':' || total_volume::text || '/' || total_sales::text, ',' order by chain_id)
   from public.collections where contract_address = '0x00000000000000000000000000000000000000c1'),
  '99801:1.449567890123456789/7,11155111:2/3',
  '091300 increment_collection_stats touches only its chain'
);

update public.listings set expires_at = now() - interval '1 day'
 where collection_address = '0x00000000000000000000000000000000000000c1';
select is(public.cleanup_expired_listings(11155111), 0, '091300 negative: cleanup on another chain expires nothing');
select is(public.cleanup_expired_listings(99801), 1, '091300 cleanup_expired_listings(99801) expires the 99801 listing');
select is(
  (select floor_price from public.collections where chain_id = 99801 and contract_address = '0x00000000000000000000000000000000000000c1'),
  null, '091300 the floor is cleared once no active listing remains'
);

-- ─── 091400: IDX-6 / IDX-7 bid event identity ──────────────────────────────

insert into p3b_fn values
  ('public.indexer_apply_token_bid_event(text, integer, text, text, text, bigint, integer, text, timestamptz, text, timestamptz)'),
  ('public.indexer_apply_collection_bid_event(text, integer, text, text, bigint, integer, text, timestamptz, text, bigint, timestamptz, integer)');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.token_bids'::regclass and conname = 'token_bids_chain_event_key'),
  'UNIQUE (chain_id, tx_hash, log_index)', '091400 token_bids UNIQUE (chain_id, tx_hash, log_index)'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.collection_bids'::regclass and conname = 'collection_bids_chain_event_key'),
  'UNIQUE (chain_id, tx_hash, log_index)', '091400 collection_bids UNIQUE (chain_id, tx_hash, log_index)'
);
select has_column('public', 'collection_bids', 'placed_quantity', '091400 collection_bids.placed_quantity exists');
select col_is_pk('public', 'collection_bid_fills', array['chain_id', 'tx_hash', 'log_index'], '091400 collection_bid_fills PK (chain_id, tx_hash, log_index)');
select fk_ok('public', 'collection_bid_fills', 'bid_id', 'public', 'collection_bids', 'id', '091400 collection_bid_fills.bid_id -> collection_bids.id');
select ok((select relrowsecurity from pg_class where oid = 'public.collection_bid_fills'::regclass), '091400 RLS is enabled on collection_bid_fills');
select ok(
  not has_table_privilege('anon', 'public.collection_bid_fills', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('authenticated', 'public.collection_bid_fills', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  '091400 anon/authenticated have no privilege on collection_bid_fills'
);
select ok(
  not exists (select 1 from p3b_fn f join pg_proc p on p.oid = f.sig::regprocedure
              where p.proname like 'indexer_apply_%' and p.prosecdef),
  '091400 the bid RPCs are SECURITY INVOKER'
);

select throws_ok(
  $$insert into public.token_bids (chain_id, collection_address, token_id, bidder_wallet, price, is_active, created_at, tx_hash, log_index, block_number)
    values (99801, '0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 1, false, now(), '0x' || repeat('e1', 32), 0, 1),
           (99801, '0x00000000000000000000000000000000000000c1', '2', '0x00000000000000000000000000000000000000d1', 1, false, now(), '0x' || repeat('e1', 32), 0, 1)$$,
  '23505', null, '091400 negative: a duplicate placement event on one chain is rejected'
);
select lives_ok(
  $$insert into public.token_bids (chain_id, collection_address, token_id, bidder_wallet, price, is_active, created_at, tx_hash, log_index, block_number)
    values (99801, '0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 1, false, now(), '0x' || repeat('e1', 32), 0, 1),
           (11155111, '0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 1, false, now(), '0x' || repeat('e1', 32), 0, 1)$$,
  '091400 the same event identity may exist on two chains'
);
select throws_ok(
  $$insert into public.token_bids (chain_id, collection_address, token_id, bidder_wallet, price, is_active, created_at, tx_hash)
    values (99801, '0x00000000000000000000000000000000000000c1', '1', '0x00000000000000000000000000000000000000d1', 1, false, now(), '0x' || repeat('e2', 32))$$,
  '23514', null, '091400 negative: a partial event identity is rejected'
);
select throws_ok(
  $$insert into public.collection_bids (chain_id, collection_address, bidder_wallet, price, quantity, is_active, created_at, tx_hash, log_index, block_number)
    values (99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d1', 1, 1, false, now(), '0xABC', 0, 1)$$,
  '23514', null, '091400 negative: a non-canonical tx_hash is rejected'
);

-- Event sequence on 99801, plus a bid by the same bidder on 11155111.
select is(public.indexer_apply_collection_bid_event('placed', 11155111, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  5, 0, '0x' || repeat('f0', 32), now(), '7', 9), 1, '091400 placed on 11155111');
select is(public.indexer_apply_collection_bid_event('placed', 99801, '0x00000000000000000000000000000000000000C1', '0x00000000000000000000000000000000000000D2',
  10, 1, '0x' || repeat('f1', 32), now(), '100', 5), 1, '091400 placed on 99801 (mixed-case input)');
select is(public.indexer_apply_collection_bid_event('placed', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  10, 1, '0x' || repeat('f1', 32), now(), '100', 5), 0, '091400 negative: a replayed placement inserts nothing');
select is(public.indexer_apply_collection_bid_event('filled', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  11, 0, '0x' || repeat('f2', 32), now(), p_token_count => 2), 1, '091400 a fill is recorded');
select is(public.indexer_apply_collection_bid_event('filled', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  11, 0, '0x' || repeat('f2', 32), now(), p_token_count => 2), 0, '091400 negative: a replayed fill changes nothing');
select is(
  (select quantity || '/' || placed_quantity || '/' || is_active from public.collection_bids
   where chain_id = 99801 and bidder_wallet = '0x00000000000000000000000000000000000000d2'),
  '3/5/true', '091400 remaining = placed - sum(fills), counted once (#14)'
);
select is(public.indexer_apply_collection_bid_event('cancelled', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  12, 0, '0x' || repeat('f3', 32), now()), 1, '091400 cancel closes the bid');
select is(public.indexer_apply_collection_bid_event('placed', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  13, 0, '0x' || repeat('f4', 32), now(), '200', 4), 1, '091400 a new placement after the cancel');
select is(public.indexer_apply_collection_bid_event('cancelled', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
  12, 0, '0x' || repeat('f3', 32), now()), 0, '091400 negative: a replayed cancel does not close the later placement');
select is(
  (select string_agg(chain_id || ':' || coalesce(block_number::text, '-') || ':' || is_active, ',' order by chain_id, block_number)
   from public.collection_bids where bidder_wallet = '0x00000000000000000000000000000000000000d2'),
  '99801:10:false,99801:13:true,11155111:5:true',
  '091400 final state; the 11155111 bid is untouched (#15)'
);
select throws_ok(
  $$select public.indexer_apply_collection_bid_event('bogus', 99801, '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000d2',
      1, 0, '0x' || repeat('f5', 32), now())$$,
  '22023', null, '091400 negative: an unknown kind is rejected'
);
select is(public.indexer_apply_token_bid_event('placed', 99801, '0x00000000000000000000000000000000000000c1', '5', '0x00000000000000000000000000000000000000d2',
  20, 0, '0x' || repeat('f6', 32), now(), '5'), 1, '091400 token bid placed');
select is(public.indexer_apply_token_bid_event('closed', 99801, '0x00000000000000000000000000000000000000c1', '5', '0x00000000000000000000000000000000000000d2',
  19, 0, '0x' || repeat('f7', 32), now()), 0, '091400 negative: a close older than the placement leaves it active');
select is(public.indexer_apply_token_bid_event('closed', 99801, '0x00000000000000000000000000000000000000c1', '5', '0x00000000000000000000000000000000000000d2',
  21, 0, '0x' || repeat('f8', 32), now()), 1, '091400 a later close deactivates it');

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
