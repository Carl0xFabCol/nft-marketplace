-- Audit M-6 (DB-6): one indexer_state row per chain.
--
-- Before: indexer_state has PK id and chain_id numeric NOT NULL, but nothing
-- stops two rows for the same chain. IndexerStateRepository.getState uses
-- .eq("chain_id", n).single(), which throws on a duplicate, and updateLastBlock
-- would move every matching row.
--
-- This migration adds indexer_state_chain_id_key UNIQUE (chain_id). The
-- preflight aborts if duplicates exist. It does not pick a winner: which
-- cursor is right is an operator decision.
--
-- Changing chain_id numeric -> integer is out of scope here; it is noted as a
-- follow-up in docs/PRODUCTION_PLAN.md. numeric equality treats 99801 and
-- 99801.0 as equal, so the unique is correct as is.
--
-- Depends on: the baseline. Independent of the other migrations.
-- Code coupling: none. Reads and updates by chain_id are unchanged.
-- Re-runnable: skipped when a unique constraint or index on exactly (chain_id)
--   already exists, whatever its name.

begin;

set local lock_timeout = '5s';

-- Preflight.
do $$
declare
  v_dups bigint;
begin
  select count(*) into v_dups
  from (
    select chain_id from public.indexer_state group by chain_id having count(*) > 1
  ) d;

  if v_dups > 0 then
    raise exception 'M-6 preflight failed: % chain_id value(s) have more than one indexer_state row; resolve by hand first. No data changed.', v_dups;
  end if;
end
$$;

do $$
declare
  v_chain int2 := (select attnum from pg_attribute
                   where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id');
  v_existing text;
begin
  select i.indexrelid::regclass::text into v_existing
  from pg_index i
  where i.indrelid = 'public.indexer_state'::regclass
    and i.indisunique
    and i.indpred is null
    and i.indnkeyatts = 1
    and i.indkey[0] = v_chain
  limit 1;

  if v_existing is not null then
    raise notice 'M-6 a unique index on indexer_state(chain_id) already exists (%); nothing to add', v_existing;
  else
    alter table public.indexer_state
      add constraint indexer_state_chain_id_key unique (chain_id);
  end if;
end
$$;

-- Postcondition.
do $$
declare
  v_chain int2 := (select attnum from pg_attribute
                   where attrelid = 'public.indexer_state'::regclass and attname = 'chain_id');
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.indexer_state'::regclass
      and i.indisunique
      and i.indpred is null
      and i.indnkeyatts = 1
      and i.indkey[0] = v_chain
  ) then
    raise exception 'M-6 postcondition failed: no unique index on indexer_state(chain_id)';
  end if;
end
$$;

commit;
