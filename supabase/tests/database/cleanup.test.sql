-- =============================================================================
-- Database tests for supabase/migrations/*_scheduled_cleanup.sql
--
-- pgTAP, run with the other database tests (see supabase/tests/TEST_PLAN.md).
-- Everything happens inside one transaction that is rolled back at the end.
-- Inside one transaction now() never changes, so room ages are set by
-- back-dating updated_at.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, aud, role) values
  ('55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated');

-- Start from a known set of rooms (only the ones created here).
delete from public.online_games;

-- -----------------------------------------------------------------------------
-- 1. Who may run the clean-up
-- -----------------------------------------------------------------------------
select ok(
  to_regprocedure('private.cleanup_stale_games()') is not null,
  'private.cleanup_stale_games() exists');
select ok(
  not has_function_privilege('anon', 'private.cleanup_stale_games()', 'EXECUTE'),
  'anon cannot run the clean-up');
select ok(
  not has_function_privilege('authenticated', 'private.cleanup_stale_games()', 'EXECUTE'),
  'authenticated (browser players) cannot run the clean-up');
select is(
  (select prosecdef from pg_proc where oid = 'private.cleanup_stale_games()'::regprocedure),
  false,
  'the clean-up is not SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'private.cleanup_stale_games()'::regprocedure),
  array['search_path=""'],
  'the clean-up has a fixed, empty search_path');

-- -----------------------------------------------------------------------------
-- 2. What it deletes
-- -----------------------------------------------------------------------------
--   ...01  idle 25 hours, finished game        -> deleted
--   ...02  idle 25 hours, closed (left)        -> deleted
--   ...03  idle 23 hours (expired, not stale)  -> kept
--   ...04  idle 24 hours minus 1 minute        -> kept
--   ...05  active 5 minutes ago                -> kept
--   ...06  waiting room, idle 3 days           -> deleted
insert into public.online_games (id, room_code, host_id, guest_id, board, left_by, updated_at) values
  ('c0000000-0000-4000-8000-000000000001', 'CQNAAA', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', 'XXXOO....', null, now() - interval '25 hours'),
  ('c0000000-0000-4000-8000-000000000002', 'CQNBBB', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '.........', '55555555-5555-4555-8555-555555555555', now() - interval '25 hours'),
  ('c0000000-0000-4000-8000-000000000003', 'CQNCCC', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', 'X........', null, now() - interval '23 hours'),
  ('c0000000-0000-4000-8000-000000000004', 'CQNDDD', '66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', '.........', null, now() - interval '24 hours' + interval '1 minute'),
  ('c0000000-0000-4000-8000-000000000005', 'CQNEEE', '66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', 'XO.......', null, now() - interval '5 minutes'),
  ('c0000000-0000-4000-8000-000000000006', 'CQNFFF', '55555555-5555-4555-8555-555555555555', null, '.........', null, now() - interval '3 days');

select is(private.cleanup_stale_games(), 3, 'the clean-up reports 3 rooms deleted');
select results_eq(
  'select id::text from public.online_games order by id',
  $$values ('c0000000-0000-4000-8000-000000000003'), ('c0000000-0000-4000-8000-000000000004'), ('c0000000-0000-4000-8000-000000000005')$$,
  'only rooms idle for more than 24 hours were deleted');
select is(
  (select board from public.online_games where id = 'c0000000-0000-4000-8000-000000000005'),
  'XO.......',
  'a kept room is unchanged');
select is(
  (select count(*) from auth.users where id in ('55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666')),
  2::bigint,
  'no auth users were deleted');

-- Running it again does nothing (idempotent).
select is(private.cleanup_stale_games(), 0, 'a second run deletes nothing');
select is((select count(*) from public.online_games), 3::bigint, 'still 3 rooms after the second run');

-- -----------------------------------------------------------------------------
-- 3. The hourly job (only where pg_cron is installed, e.g. on Supabase)
-- -----------------------------------------------------------------------------
-- The job table only exists with pg_cron, so it is read through a small
-- temporary helper (returns NULL where pg_cron is not installed).
create function pg_temp.cleanup_job_count() returns bigint
language plpgsql
as $fn$
declare
  n bigint;
begin
  if to_regclass('cron.job') is null then
    return null;
  end if;
  execute $q$
    select count(*) from cron.job
    where jobname = 'cleanup-stale-online-games'
      and schedule = '17 * * * *'
      and command = 'select private.cleanup_stale_games();'
      and active
  $q$ into n;
  return n;
end;
$fn$;

select ok(
  coalesce(pg_temp.cleanup_job_count() = 1, true),
  'exactly one active hourly clean-up job (skipped without pg_cron)');

select * from finish();
rollback;
