-- Audit M-4 (DB-4): activity.chain_id text -> integer, and drop the
-- '11155111' default.
--
-- Before: activity.chain_id is text DEFAULT '11155111'::text. Live values are
-- the string "99801", while listings/nfts/collections hold integer 99801, and
-- the default points at the wrong network (Sepolia). Any row written without
-- an explicit chain would be silently attributed to Sepolia.
--
-- This migration:
--   1. preflight: every value must be a canonical positive int4 decimal
--      (^[1-9][0-9]{0,9}$, <= 2147483647) so the cast is lossless, and no
--      value may be NULL;
--   2. drops the default rather than setting a new one. The indexer always
--      writes env.chainId (ActivityRepository), and a missing chain must fail
--      loudly (23502), not be guessed;
--   3. ALTER TYPE integer USING chain_id::integer; SET NOT NULL;
--      CHECK (chain_id > 0).
--
-- Depends on: the baseline. Independent of the other migrations. No view,
--   index or constraint references activity.chain_id in the baseline. An
--   unexpected dependent object makes ALTER TYPE fail loudly and roll back.
-- Code coupling: none. PostgREST coerces the JS number / numeric string the
--   current indexer and web send. Filters .eq("chain_id", n) keep working.
-- Re-runnable: the type change is skipped when the column is already integer,
--   and the remaining steps are idempotent or guarded.

begin;

set local lock_timeout = '5s';

-- Preflight.
do $$
declare
  v_type text;
  v_nulls bigint;
  v_bad bigint;
begin
  select format_type(atttypid, atttypmod) into v_type
  from pg_attribute
  where attrelid = 'public.activity'::regclass and attname = 'chain_id' and not attisdropped;

  if v_type is null then
    raise exception 'M-4 preflight failed: public.activity.chain_id does not exist. No data changed.';
  end if;

  if v_type not in ('text', 'integer') then
    raise exception 'M-4 preflight failed: unexpected type % for activity.chain_id. No data changed.', v_type;
  end if;

  execute 'select count(*) from public.activity where chain_id is null' into v_nulls;
  if v_nulls > 0 then
    raise exception 'M-4 preflight failed: % activity row(s) have NULL chain_id; decide their chain before migrating. No data changed.', v_nulls;
  end if;

  if v_type = 'text' then
    -- Lossless cast: canonical decimal with no sign, spaces or leading zeros,
    -- within int4. CASE guards the numeric cast from non-numeric input.
    execute $q$
      select count(*) from public.activity
      where case
              when chain_id ~ '^[1-9][0-9]{0,9}$' then chain_id::bigint > 2147483647
              else true
            end
    $q$ into v_bad;

    if v_bad > 0 then
      raise exception 'M-4 preflight failed: % activity row(s) have a chain_id that does not cast losslessly to a positive integer. No data changed.', v_bad;
    end if;
  end if;
end
$$;

alter table public.activity alter column chain_id drop default;

do $$
declare
  v_type text;
begin
  select format_type(atttypid, atttypmod) into v_type
  from pg_attribute
  where attrelid = 'public.activity'::regclass and attname = 'chain_id' and not attisdropped;

  if v_type = 'text' then
    raise notice 'M-4 converting activity.chain_id text -> integer';
    alter table public.activity alter column chain_id type integer using chain_id::integer;
  else
    raise notice 'M-4 activity.chain_id is already %; type change skipped', v_type;
  end if;
end
$$;

alter table public.activity alter column chain_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activity'::regclass and conname = 'activity_chain_id_positive'
  ) then
    alter table public.activity
      add constraint activity_chain_id_positive check (chain_id > 0);
  end if;
end
$$;

-- Postcondition.
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.activity'::regclass and attname = 'chain_id' and not attisdropped
      and atttypid = 'integer'::regtype and attnotnull and not atthasdef
  ) then
    raise exception 'M-4 postcondition failed: activity.chain_id is not integer NOT NULL without default';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activity'::regclass and conname = 'activity_chain_id_positive'
      and contype = 'c' and convalidated
  ) then
    raise exception 'M-4 postcondition failed: activity_chain_id_positive missing or not validated';
  end if;
end
$$;

commit;
