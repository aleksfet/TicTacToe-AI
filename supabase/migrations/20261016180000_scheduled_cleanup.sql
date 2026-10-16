-- =============================================================================
-- Tic Tac Toe AI Arena - scheduled clean-up of old online rooms
--
-- Rooms stop being playable 1 hour after their last activity (every RPC
-- checks private.is_expired). create_game() already deletes rooms idle for
-- more than 24 hours, but only when somebody creates a game. This adds an
-- hourly pg_cron job that does the same, so old rooms are removed even when
-- nobody plays.
--
-- Only public.online_games rows are deleted. Auth users are NOT touched.
--
-- Safe to run more than once: the function is replaced, and the job is
-- unscheduled by name before being scheduled again (never duplicated).
-- Where pg_cron is not available (e.g. plain Postgres in tests) the job is
-- skipped with a notice; the function is still created and can be tested.
-- =============================================================================


-- Delete rooms with no activity for more than 24 hours. Returns how many were
-- deleted. Same threshold as the clean-up in create_game(): rooms between 1
-- and 24 hours old stay, so a late visitor sees "expired" rather than
-- "not found".
--
-- SECURITY INVOKER (the default): it runs with the rights of the caller,
-- which is the job's owner (the migration role, which owns the table).
-- Browser roles cannot call it (no usage on the private schema, and EXECUTE
-- is revoked below).
create or replace function private.cleanup_stale_games()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.online_games
  where updated_at < now() - interval '24 hours';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function private.cleanup_stale_games() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- The hourly job (at 17 minutes past each hour, away from the busy :00).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    -- Supabase's documented way to enable pg_cron.
    create extension if not exists pg_cron with schema pg_catalog;
  end if;

  if pg_catalog.to_regnamespace('cron') is null then
    raise notice 'pg_cron is not available: the hourly clean-up job was not scheduled.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'cleanup-stale-online-games') then
    perform cron.unschedule('cleanup-stale-online-games');
  end if;

  perform cron.schedule(
    'cleanup-stale-online-games',
    '17 * * * *',
    'select private.cleanup_stale_games();'
  );
end;
$$;
