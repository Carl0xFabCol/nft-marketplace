-- Audit DB-6 / DB-7 follow-ups and IDX-3 (hash part): indexer cursor tables.
--
-- Before:
--   * contract_indexer_state.chain_id is nullable, and its PRIMARY KEY is
--     (contract_address) alone, so one collection address cannot be tracked on
--     two chains (UNIQUE (contract_address, chain_id) also exists).
--   * indexer_state.chain_id is numeric, while every other table uses integer
--     (M-6 added UNIQUE (chain_id) but kept the type).
--   * the global cursor stores no block hash, so a reorg below the
--     confirmation lag cannot be detected.
--
-- This migration:
--   * contract_indexer_state: chain_id NOT NULL + CHECK (chain_id > 0); the
--     primary key becomes (chain_id, contract_address); the now redundant
--     contract_indexer_state_contract_chain_unique is dropped. The indexer's
--     upsert target (contract_address, chain_id) still matches the PK (ON
--     CONFLICT inference is by column set).
--   * indexer_state: chain_id numeric -> integer (lossless; the unique index is
--     rebuilt by the type change) + CHECK (chain_id > 0).
--   * indexer_state.last_block_hash text, NULL or a canonical 0x-prefixed
--     32-byte lower-case hex. The Phase 3B indexer writes the hash of
--     last_block at each checkpoint and halts if the chain's hash differs
--     (reorg detection; rollback is not automated).
--
-- Depends on: 20261028091000 (indexer_state_chain_id_key).
-- Code coupling: none for the old indexer (it never reads last_block_hash;
--   reads and writes by chain_id work for both types). The Phase 3B indexer
--   needs last_block_hash.
-- Locks: ACCESS EXCLUSIVE on indexer_state and contract_indexer_state (the
--   indexer must be stopped).
-- Re-runnable: every step is guarded by the catalog.

begin;

set local lock_timeout = '5s';

-- Preflight. No change made on failure.
do $$
declare
  v_n bigint;
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.indexer_state'::regclass and conname = 'indexer_state_chain_id_key') then
    raise exception 'State preflight failed: indexer_state_chain_id_key missing; apply 20261028091000 first. No data changed.';
  end if;

  select count(*) into v_n from public.contract_indexer_state where chain_id is null or chain_id <= 0;
  if v_n > 0 then
    raise exception 'State preflight failed: % contract_indexer_state row(s) have a NULL or non-positive chain_id; fix them by hand first. No data changed.', v_n;
  end if;

  -- Works for numeric (before) and integer (re-run).
  select count(*) into v_n from public.indexer_state
  where chain_id::numeric <> trunc(chain_id::numeric) or chain_id::numeric <= 0 or chain_id::numeric > 2147483647;
  if v_n > 0 then
    raise exception 'State preflight failed: % indexer_state row(s) have a chain_id that is not a positive int4; fix them by hand first. No data changed.', v_n;
  end if;

  if exists (
    select 1 from public.contract_indexer_state group by chain_id, contract_address having count(*) > 1
  ) then
    raise exception 'State preflight failed: duplicate (chain_id, contract_address) in contract_indexer_state. No data changed.';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.indexer_state'::regclass and attname = 'last_block_hash'
      and not attisdropped and atttypid <> 'text'::regtype
  ) then
    raise exception 'State preflight failed: indexer_state.last_block_hash exists with a non-text type. No data changed.';
  end if;
end
$$;

-- ─── contract_indexer_state ─────────────────────────────────────────────────

alter table public.contract_indexer_state alter column chain_id set not null;

do $$
declare
  v_pk_cols text[];
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.contract_indexer_state'::regclass
                   and conname = 'contract_indexer_state_chain_id_positive') then
    alter table public.contract_indexer_state
      add constraint contract_indexer_state_chain_id_positive check (chain_id > 0);
  end if;

  select array_agg(a.attname::text order by k.ord) into v_pk_cols
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.contract_indexer_state'::regclass and c.contype = 'p';

  if v_pk_cols is distinct from array['chain_id', 'contract_address'] then
    raise notice 'State: contract_indexer_state primary key % -> (chain_id, contract_address)', v_pk_cols;
    alter table public.contract_indexer_state drop constraint contract_indexer_state_pkey;
    alter table public.contract_indexer_state
      add constraint contract_indexer_state_pkey primary key (chain_id, contract_address);
  end if;

  if exists (select 1 from pg_constraint
             where conrelid = 'public.contract_indexer_state'::regclass
               and conname = 'contract_indexer_state_contract_chain_unique') then
    raise notice 'State: dropping redundant contract_indexer_state_contract_chain_unique';
    alter table public.contract_indexer_state drop constraint contract_indexer_state_contract_chain_unique;
  end if;
end
$$;

-- ─── indexer_state ──────────────────────────────────────────────────────────

do $$
begin
  if (select atttypid from pg_attribute
      where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id' and not attisdropped) <> 'integer'::regtype then
    raise notice 'State: converting indexer_state.chain_id numeric -> integer';
    alter table public.indexer_state alter column chain_id type integer using chain_id::integer;
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.indexer_state'::regclass and conname = 'indexer_state_chain_id_positive') then
    alter table public.indexer_state add constraint indexer_state_chain_id_positive check (chain_id > 0);
  end if;
end
$$;

alter table public.indexer_state add column if not exists last_block_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.indexer_state'::regclass and conname = 'indexer_state_last_block_hash_canonical') then
    alter table public.indexer_state
      add constraint indexer_state_last_block_hash_canonical
      check (last_block_hash is null or last_block_hash ~ '^0x[0-9a-f]{64}$');
  end if;
end
$$;

-- Postcondition.
do $$
begin
  if not exists (select 1 from pg_attribute
                 where attrelid = 'public.contract_indexer_state'::regclass and attname = 'chain_id' and attnotnull) then
    raise exception 'State postcondition failed: contract_indexer_state.chain_id is nullable';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.contract_indexer_state'::regclass and contype = 'p')
     is distinct from 'PRIMARY KEY (chain_id, contract_address)' then
    raise exception 'State postcondition failed: contract_indexer_state primary key is not (chain_id, contract_address)';
  end if;
  if (select atttypid from pg_attribute
      where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id') <> 'integer'::regtype then
    raise exception 'State postcondition failed: indexer_state.chain_id is not integer';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.indexer_state'::regclass and conname = 'indexer_state_chain_id_key')
     is distinct from 'UNIQUE (chain_id)' then
    raise exception 'State postcondition failed: indexer_state_chain_id_key lost';
  end if;
  if not exists (select 1 from pg_attribute
                 where attrelid = 'public.indexer_state'::regclass and attname = 'last_block_hash' and atttypid = 'text'::regtype) then
    raise exception 'State postcondition failed: indexer_state.last_block_hash missing';
  end if;
  if has_table_privilege('anon', 'public.indexer_state', 'SELECT')
     or has_table_privilege('authenticated', 'public.indexer_state', 'SELECT')
     or has_table_privilege('anon', 'public.contract_indexer_state', 'SELECT')
     or has_table_privilege('authenticated', 'public.contract_indexer_state', 'SELECT') then
    raise exception 'State postcondition failed: indexer state became readable by anon/authenticated';
  end if;
end
$$;

commit;
