-- Phase 2 migration tests: audit #18 (constraint assertions + negative tests
-- for M-1, M-2, M-4, M-6, M-7) and #19 (cross-chain uniqueness for listings,
-- nfts, token_bids, collection_bids).
--
-- Run against a disposable database with the baseline and migrations
-- 20261028090000 .. 20261028091100 applied, e.g.
--   psql "$SEC01_TEST_DB_URL" -v ON_ERROR_STOP=1 -f packages/database/tests/phase2_migrations.test.sql
-- or through `pnpm --filter @marketplace/database test:rls`.
--
-- Everything runs in one transaction that is rolled back. The tests write
-- rows, so never point this at production.

begin;

select no_plan();

-- Fixtures (rolled back). Addresses 0x...a1 / 0x...a2 are only used here.
--   collection A on 99801 and on 11155111 (same address on two chains)
--   nfts A/1 on both chains
insert into public.collections (contract_address, chain_id) values
  ('0x00000000000000000000000000000000000000a1', 99801),
  ('0x00000000000000000000000000000000000000a1', 11155111),
  ('0x00000000000000000000000000000000000000a2', 99801);
insert into public.nfts (collection_address, token_id, owner_wallet, chain_id) values
  ('0x00000000000000000000000000000000000000a1', '1', '0x00000000000000000000000000000000000000b1', 99801),
  ('0x00000000000000000000000000000000000000a1', '1', '0x00000000000000000000000000000000000000b1', 11155111),
  ('0x00000000000000000000000000000000000000a2', '7', '0x00000000000000000000000000000000000000b2', 99801);

-- ─── M-1: bid chain_id ──────────────────────────────────────────────────────

select col_type_is('public', 'token_bids', 'chain_id', 'integer', 'M-1 token_bids.chain_id is integer');
select col_not_null('public', 'token_bids', 'chain_id', 'M-1 token_bids.chain_id is NOT NULL');
select col_hasnt_default('public', 'token_bids', 'chain_id', 'M-1 token_bids.chain_id has no default');
select col_type_is('public', 'collection_bids', 'chain_id', 'integer', 'M-1 collection_bids.chain_id is integer');
select col_not_null('public', 'collection_bids', 'chain_id', 'M-1 collection_bids.chain_id is NOT NULL');
select col_hasnt_default('public', 'collection_bids', 'chain_id', 'M-1 collection_bids.chain_id has no default');

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.token_bids'::regclass and conname = 'token_bids_chain_id_positive'
            and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK ((chain_id > 0))'),
  'M-1 token_bids has CHECK (chain_id > 0)'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.collection_bids'::regclass and conname = 'collection_bids_chain_id_positive'
            and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK ((chain_id > 0))'),
  'M-1 collection_bids has CHECK (chain_id > 0)'
);

select is(
  (select pg_get_indexdef('public.idx_token_bids_unique_active_chain'::regclass)),
  'CREATE UNIQUE INDEX idx_token_bids_unique_active_chain ON public.token_bids USING btree (chain_id, collection_address, token_id, bidder_wallet) WHERE (is_active = true)',
  'M-1 token_bids active-bid unique is (chain_id, collection_address, token_id, bidder_wallet) WHERE is_active'
);
select is(
  (select pg_get_indexdef('public.idx_collection_bids_unique_active_chain'::regclass)),
  'CREATE UNIQUE INDEX idx_collection_bids_unique_active_chain ON public.collection_bids USING btree (chain_id, collection_address, bidder_wallet) WHERE (is_active = true)',
  'M-1 collection_bids active-bid unique is (chain_id, collection_address, bidder_wallet) WHERE is_active'
);

select is(
  (select count(*)::int
   from pg_index i
   where i.indrelid in ('public.token_bids'::regclass, 'public.collection_bids'::regclass)
     and i.indisunique and not i.indisprimary
     and not exists (select 1 from pg_attribute a
                     where a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]) and a.attname = 'chain_id')),
  0,
  'M-1 no unique index on the bid tables lacks chain_id'
);

select throws_ok(
  $$insert into public.token_bids (created_at, collection_address, token_id, price, bidder_wallet, is_active)
    values (now(), '0x00000000000000000000000000000000000000a1', '1', 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23502', null,
  'M-1 token bid without chain_id is rejected (23502)'
);
select throws_ok(
  $$insert into public.collection_bids (created_at, collection_address, price, quantity, bidder_wallet, is_active)
    values (now(), '0x00000000000000000000000000000000000000a1', 1, 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23502', null,
  'M-1 collection bid without chain_id is rejected (23502)'
);
select throws_ok(
  $$insert into public.token_bids (created_at, chain_id, token_id, price, bidder_wallet, is_active)
    values (now(), 0, '1', 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23514', null,
  'M-1 token bid with chain_id 0 is rejected (23514)'
);
select throws_ok(
  $$insert into public.collection_bids (created_at, chain_id, price, quantity, bidder_wallet, is_active)
    values (now(), -1, 1, 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23514', null,
  'M-1 collection bid with chain_id -1 is rejected (23514)'
);

insert into public.token_bids (created_at, chain_id, collection_address, token_id, price, bidder_wallet, is_active)
values (now(), 99801, '0x00000000000000000000000000000000000000a1', '1', 5, '0x00000000000000000000000000000000000000c1', true);
insert into public.collection_bids (created_at, chain_id, collection_address, price, quantity, bidder_wallet, is_active)
values (now(), 99801, '0x00000000000000000000000000000000000000a1', 5, 2, '0x00000000000000000000000000000000000000c1', true);

select throws_ok(
  $$insert into public.token_bids (created_at, chain_id, collection_address, token_id, price, bidder_wallet, is_active)
    values (now(), 99801, '0x00000000000000000000000000000000000000a1', '1', 6, '0x00000000000000000000000000000000000000c1', true)$$,
  '23505', null,
  'M-1 a second active token bid by the same bidder on the same chain is rejected (23505)'
);
select throws_ok(
  $$insert into public.collection_bids (created_at, chain_id, collection_address, price, quantity, bidder_wallet, is_active)
    values (now(), 99801, '0x00000000000000000000000000000000000000a1', 6, 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23505', null,
  'M-1 a second active collection bid by the same bidder on the same chain is rejected (23505)'
);
select lives_ok(
  $$insert into public.token_bids (created_at, chain_id, collection_address, token_id, price, bidder_wallet, is_active)
    values (now(), 99801, '0x00000000000000000000000000000000000000a1', '1', 4, '0x00000000000000000000000000000000000000c1', false)$$,
  'M-1 inactive bid history for the same bidder is still allowed'
);

-- ─── M-2: collections (chain_id, contract_address) ─────────────────────────

select col_is_unique('public', 'collections', array['chain_id', 'contract_address'],
  'M-2 collections is unique on (chain_id, contract_address)');
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.collections'::regclass and conname = 'collections_chain_contract_key'
            and pg_get_constraintdef(oid) = 'UNIQUE (chain_id, contract_address)'),
  'M-2 collections_chain_contract_key is UNIQUE (chain_id, contract_address)'
);
select is(
  (select count(*)::int
   from pg_index i
   where i.indrelid = 'public.collections'::regclass
     and i.indisunique and not i.indisprimary
     and not exists (select 1 from pg_attribute a
                     where a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]) and a.attname = 'chain_id')),
  0,
  'M-2 no unique index on collections lacks chain_id (contract_address alone is no longer unique)'
);

select fk_ok('public', 'nfts', array['chain_id', 'collection_address'],
             'public', 'collections', array['chain_id', 'contract_address'],
             'M-2 nfts -> collections FK is (chain_id, collection_address)');
select fk_ok('public', 'token_bids', array['chain_id', 'collection_address'],
             'public', 'collections', array['chain_id', 'contract_address'],
             'M-2 token_bids -> collections FK is (chain_id, collection_address)');
select fk_ok('public', 'collection_bids', array['chain_id', 'collection_address'],
             'public', 'collections', array['chain_id', 'contract_address'],
             'M-2 collection_bids -> collections FK is (chain_id, collection_address)');

select is(
  (select count(*)::int from pg_constraint
   where contype = 'f' and confrelid = 'public.collections'::regclass),
  3,
  'M-2 exactly three FKs reference collections'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where contype = 'f' and conrelid = 'public.nfts'::regclass and confrelid = 'public.collections'::regclass),
  'FOREIGN KEY (chain_id, collection_address) REFERENCES collections(chain_id, contract_address) ON UPDATE CASCADE ON DELETE SET DEFAULT (collection_address)',
  'M-2 nfts FK keeps ON UPDATE CASCADE / ON DELETE SET DEFAULT, scoped to collection_address'
);

select throws_ok(
  $$insert into public.collections (contract_address, chain_id) values ('0x00000000000000000000000000000000000000a1', 99801)$$,
  '23505', null,
  'M-2 duplicate (chain_id, contract_address) is rejected (23505)'
);
select throws_ok(
  $$insert into public.nfts (collection_address, token_id, owner_wallet, chain_id)
    values ('0x00000000000000000000000000000000000000a2', '7', '0x00000000000000000000000000000000000000b2', 11155111)$$,
  '23503', null,
  'M-2 an nft whose collection exists only on another chain is rejected (23503)'
);
select throws_ok(
  $$insert into public.token_bids (created_at, chain_id, collection_address, token_id, price, bidder_wallet, is_active)
    values (now(), 11155111, '0x00000000000000000000000000000000000000a2', '7', 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23503', null,
  'M-2 a token bid whose collection exists only on another chain is rejected (23503)'
);
select throws_ok(
  $$insert into public.collection_bids (created_at, chain_id, collection_address, price, quantity, bidder_wallet, is_active)
    values (now(), 11155111, '0x00000000000000000000000000000000000000a2', 1, 1, '0x00000000000000000000000000000000000000c1', true)$$,
  '23503', null,
  'M-2 a collection bid whose collection exists only on another chain is rejected (23503)'
);

-- ─── M-4: activity.chain_id integer ────────────────────────────────────────

select col_type_is('public', 'activity', 'chain_id', 'integer', 'M-4 activity.chain_id is integer');
select col_not_null('public', 'activity', 'chain_id', 'M-4 activity.chain_id is NOT NULL');
select col_hasnt_default('public', 'activity', 'chain_id', 'M-4 activity.chain_id has no default (no 11155111 fallback)');
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.activity'::regclass and conname = 'activity_chain_id_positive'
            and pg_get_constraintdef(oid) = 'CHECK ((chain_id > 0))'),
  'M-4 activity has CHECK (chain_id > 0)'
);
select throws_ok(
  $$insert into public.activity (event, tx_hash, log_index) values ('TEST', '0xphase2-null-chain', 0)$$,
  '23502', null,
  'M-4 activity without chain_id is rejected (23502) instead of defaulting to 11155111'
);
select throws_ok(
  $$insert into public.activity (event, tx_hash, log_index, chain_id) values ('TEST', '0xphase2-zero-chain', 0, 0)$$,
  '23514', null,
  'M-4 activity with chain_id 0 is rejected (23514)'
);
select lives_ok(
  $$insert into public.activity (event, tx_hash, log_index, chain_id) values ('TEST', '0xphase2-text-chain', 0, '99801')$$,
  'M-4 a numeric string chain_id (what PostgREST sends) is still accepted'
);
select is(
  (select chain_id from public.activity where tx_hash = '0xphase2-text-chain'),
  99801,
  'M-4 the stored chain_id is the integer 99801'
);

-- ─── M-6: indexer_state UNIQUE (chain_id) ──────────────────────────────────

select col_is_unique('public', 'indexer_state', 'chain_id', 'M-6 indexer_state is unique on chain_id');
insert into public.indexer_state (chain_id, last_block) values (424242, 1);
select throws_ok(
  $$insert into public.indexer_state (chain_id, last_block) values (424242, 2)$$,
  '23505', null,
  'M-6 a second indexer_state row for the same chain is rejected (23505)'
);
select throws_ok(
  $$insert into public.indexer_state (chain_id, last_block) values (424242.0, 2)$$,
  '23505', null,
  'M-6 numeric 424242.0 counts as the same chain (23505)'
);

-- ─── M-7: relist clears buyer_wallet ───────────────────────────────────────

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.sec01_save_listing_batch(text, text, integer, jsonb)'::regprocedure),
  'M-7 sec01_save_listing_batch is still SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=public, pg_temp'] from pg_proc
   where oid = 'public.sec01_save_listing_batch(text, text, integer, jsonb)'::regprocedure),
  'M-7 sec01_save_listing_batch search_path is still public, pg_temp'
);
select ok(
  not has_function_privilege('anon', 'public.sec01_save_listing_batch(text, text, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.sec01_save_listing_batch(text, text, integer, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.sec01_save_listing_batch(text, text, integer, jsonb)', 'EXECUTE'),
  'M-7 sec01_save_listing_batch is executable by service_role only'
);

-- A sold listing: seller b1 sold A2/7 to b2, so the row is inactive and keeps buyer_wallet.
insert into public.listings (listing_id, chain_id, collection_address, token_id, seller_wallet, buyer_wallet,
                             price, tx_hash, is_active)
values ('99801:0x00000000000000000000000000000000000000a2-7', 99801,
        '0x00000000000000000000000000000000000000a2', '7',
        '0x00000000000000000000000000000000000000b1', '0x00000000000000000000000000000000000000b2',
        10, '0x7a00000000000000000000000000000000000000000000000000000000000001', false);

-- The new owner b2 relists through the RPC (ON CONFLICT path).
select is(
  public.sec01_save_listing_batch(
    '0x00000000000000000000000000000000000000b2',
    '0x7a00000000000000000000000000000000000000000000000000000000000002',
    99801,
    '[{"collection_address":"0x00000000000000000000000000000000000000a2","token_id":"7","price":"20"}]'::jsonb
  ),
  1,
  'M-7 relist through sec01_save_listing_batch updates the existing row'
);
select is(
  (select row(seller_wallet, buyer_wallet, is_active, price)::text from public.listings
   where chain_id = 99801 and collection_address = '0x00000000000000000000000000000000000000a2' and token_id = '7'),
  row('0x00000000000000000000000000000000000000b2', null::text, true, 20::numeric)::text,
  'M-7 relist via RPC clears buyer_wallet (new seller, active, new price)'
);
select is(
  (select count(*)::int from public.listings
   where collection_address = '0x00000000000000000000000000000000000000a2' and token_id = '7'),
  1,
  'M-7 relist reuses the single chain-scoped row'
);

-- ─── Audit #19: cross-chain coexistence ────────────────────────────────────
-- Same (collection_address, token_id), and same bidder, on 99801 and 11155111.

select lives_ok(
  $$insert into public.listings (listing_id, chain_id, collection_address, token_id, seller_wallet, price, tx_hash, is_active)
    values ('99801:0x00000000000000000000000000000000000000a1-1', 99801,
            '0x00000000000000000000000000000000000000a1', '1', '0x00000000000000000000000000000000000000b1', 3,
            '0x1900000000000000000000000000000000000000000000000000000000000001', true),
           ('11155111:0x00000000000000000000000000000000000000a1-1', 11155111,
            '0x00000000000000000000000000000000000000a1', '1', '0x00000000000000000000000000000000000000b1', 3,
            '0x1900000000000000000000000000000000000000000000000000000000000001', true)$$,
  '#19 listings: the same collection/token (and tx hash) coexists on two chains'
);
select lives_ok(
  $$insert into public.token_bids (created_at, chain_id, collection_address, token_id, price, bidder_wallet, is_active)
    values (now(), 11155111, '0x00000000000000000000000000000000000000a1', '1', 5, '0x00000000000000000000000000000000000000c1', true)$$,
  '#19 token_bids: the same bidder has an active bid on the same token on a second chain'
);
select lives_ok(
  $$insert into public.collection_bids (created_at, chain_id, collection_address, price, quantity, bidder_wallet, is_active)
    values (now(), 11155111, '0x00000000000000000000000000000000000000a1', 5, 2, '0x00000000000000000000000000000000000000c1', true)$$,
  '#19 collection_bids: the same bidder has an active collection bid on a second chain'
);

select is(
  (select array_agg(chain_id order by chain_id) from public.collections
   where contract_address = '0x00000000000000000000000000000000000000a1'),
  array[99801, 11155111],
  '#19 collections: the same address exists on both chains'
);
select is(
  (select array_agg(chain_id order by chain_id) from public.nfts
   where collection_address = '0x00000000000000000000000000000000000000a1' and token_id = '1'),
  array[99801, 11155111],
  '#19 nfts: the same collection/token exists on both chains'
);
select is(
  (select array_agg(chain_id order by chain_id) from public.listings
   where collection_address = '0x00000000000000000000000000000000000000a1' and token_id = '1'),
  array[99801, 11155111],
  '#19 listings: one row per chain'
);
select is(
  (select array_agg(chain_id order by chain_id) from public.token_bids
   where collection_address = '0x00000000000000000000000000000000000000a1' and token_id = '1' and is_active),
  array[99801, 11155111],
  '#19 token_bids: one active bid per chain for the same bidder'
);
select is(
  (select array_agg(chain_id order by chain_id) from public.collection_bids
   where collection_address = '0x00000000000000000000000000000000000000a1' and is_active),
  array[99801, 11155111],
  '#19 collection_bids: one active bid per chain for the same bidder'
);

-- Chain-scoped updates touch only their own chain.
update public.token_bids set is_active = false
where chain_id = 11155111 and collection_address = '0x00000000000000000000000000000000000000a1'
  and bidder_wallet = '0x00000000000000000000000000000000000000c1';
select is(
  (select count(*)::int from public.token_bids
   where chain_id = 99801 and collection_address = '0x00000000000000000000000000000000000000a1' and is_active),
  1,
  '#19 cancelling a bid on 11155111 leaves the 99801 bid active'
);

select * from finish();

rollback;
