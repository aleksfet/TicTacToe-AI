-- =============================================================================
-- Tic Tac Toe AI Arena - online multiplayer backend
--
-- One table (public.online_games) holds every online room. Browsers can only
-- READ the rooms they play in (Row Level Security). Every change goes through
-- one of five RPC functions, which check the caller and the game rules on the
-- server, inside a transaction, with the row locked:
--
--   create_game()             start a room; the caller is the host
--   join_game(code)           join as the guest, or rejoin your own room
--   make_move(game_id, cell)  play one mark (the server decides if it is legal)
--   request_rematch(game_id)  ask for / accept a rematch (marks swap)
--   leave_game(game_id)       close the room
--
-- Errors are raised with a short machine-readable message (ROOM_FULL,
-- NOT_YOUR_TURN, ...) so the browser can show a friendly text for each.
--
-- Board format: 9 characters, one per square, left to right, top to bottom.
-- "X", "O", or "." for empty. Square 0 is the first character.
--
-- Values that can be worked out from the board are NOT stored:
--   whose turn  X always starts, so it is X's turn when X and O counts match
--   winner      private.ttt_winner(board)
--   draw        a full board with no winner
--   status      waiting = no guest, finished = winner or full, closed = left_by
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A private schema for helper functions. It is not exposed through the
-- Supabase API (only "public" is), and browser roles get no access to it, so
-- the helpers can only be used by the RPC functions below.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- The table
-- -----------------------------------------------------------------------------
create table public.online_games (
  -- Internal id. Used by every RPC call and (later) the Realtime channel.
  -- Unguessable, and only visible to the two players.
  id uuid primary key default gen_random_uuid(),

  -- The 6-character invite code. 31-character alphabet with the confusing
  -- characters removed (no 0/O, 1/I/L): 31^6 = about 887 million codes.
  room_code text not null
    constraint online_games_room_code_key unique
    constraint online_games_room_code_format
      check (room_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),

  -- The two players (Supabase Auth user ids; anonymous users count).
  -- Deleting a user (e.g. a later cleanup of old anonymous users) deletes
  -- their rooms too.
  host_id uuid not null references auth.users (id) on delete cascade,
  guest_id uuid references auth.users (id) on delete cascade,

  board text not null default '.........'
    constraint online_games_board_format check (board ~ '^[XO.]{9}$'),

  -- Which mark the host plays this round (the guest has the other one).
  -- Swaps on every rematch, so the players take turns going first.
  host_mark text not null default 'X'
    constraint online_games_host_mark_check check (host_mark in ('X', 'O')),

  -- Who has asked for a rematch (NULL = nobody yet).
  rematch_requested_by uuid,

  -- Who left the room (NULL = still open). Once set, the room is closed.
  left_by uuid,

  -- Score for the whole life of the room, counted per person (not per mark,
  -- because the marks swap).
  host_wins smallint not null default 0 constraint online_games_host_wins_check check (host_wins >= 0),
  guest_wins smallint not null default 0 constraint online_games_guest_wins_check check (guest_wins >= 0),
  draws smallint not null default 0 constraint online_games_draws_check check (draws >= 0),

  -- Goes up by one on every change. Browsers use it to ignore old or
  -- duplicate updates.
  version integer not null default 1 constraint online_games_version_check check (version > 0),

  created_at timestamptz not null default now(),
  -- Last activity. A room expires 1 hour after this (see private.is_expired).
  updated_at timestamptz not null default now(),

  -- One person cannot be both players.
  constraint online_games_guest_not_host check (guest_id <> host_id),

  -- Only a player of this room can request a rematch or leave it.
  constraint online_games_rematch_by_player
    check (rematch_requested_by is null or rematch_requested_by = host_id or rematch_requested_by = guest_id),
  constraint online_games_left_by_player
    check (left_by is null or left_by = host_id or left_by = guest_id),

  -- A reachable board: X moves first, so X has the same number of marks as O
  -- or exactly one more. (A last line of defense; make_move already ensures it.)
  constraint online_games_board_turns check (
    (length(board) - length(replace(board, 'X', '')))
      - (length(board) - length(replace(board, 'O', ''))) in (0, 1)
  )
);

comment on table public.online_games is
  'Online Tic Tac Toe rooms. Read-only for the two players (RLS); all writes go through the RPC functions.';

-- At most ONE open waiting room (no guest yet) per host. create_game()
-- deletes the caller's old waiting rooms first, so this only matters when two
-- create_game() calls race; the database then refuses the second insert.
create unique index online_games_one_waiting_room_per_host
  on public.online_games (host_id)
  where guest_id is null and left_by is null;

-- For the opportunistic clean-up of old rooms in create_game().
create index online_games_updated_at_idx on public.online_games (updated_at);

-- For the RLS check on the guest column (host_id is covered by the index above
-- only for waiting rooms, so index it too).
create index online_games_host_id_idx on public.online_games (host_id);
create index online_games_guest_id_idx on public.online_games (guest_id);


-- -----------------------------------------------------------------------------
-- Row Level Security and privileges
--
-- Supabase normally grants every role (anon, authenticated) full access to new
-- tables in "public". We take all of that away and give back exactly one
-- thing: signed-in users (anonymous users included) may SELECT, and RLS limits
-- that to rows where they are a player. There is no INSERT / UPDATE / DELETE
-- policy and no such privilege, so direct writes from a browser fail.
--
-- The RPC functions are SECURITY DEFINER and owned by the migration role, which
-- owns the table, so they can still read and write it. (RLS is not FORCEd on
-- purpose, so the table owner is not filtered.)
-- -----------------------------------------------------------------------------
alter table public.online_games enable row level security;

revoke all on table public.online_games from public, anon, authenticated;
grant select on table public.online_games to authenticated;

-- (select auth.uid()) is evaluated once per query instead of once per row.
create policy "Players can read their own games"
  on public.online_games
  for select
  to authenticated
  using ((select auth.uid()) = host_id or (select auth.uid()) = guest_id);


-- -----------------------------------------------------------------------------
-- Helper functions (private schema)
--
-- All use "set search_path = ''" and only call built-in pg_catalog functions,
-- which are always found. Nothing here builds SQL from text, so there is no
-- injection surface.
-- -----------------------------------------------------------------------------

-- The winner of a board: 'X', 'O', or NULL.
-- The eight lines are checked in the same order as WINNING_LINES in
-- src/game.js (rows, columns, diagonals), so even impossible boards with two
-- winning lines give the same answer as getWinner() there. Positions are
-- 1-based because substr() counts from 1. A malformed board returns NULL.
create or replace function private.ttt_winner(board text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select mark
  from (
    values
      (1, 1, 2, 3), (2, 4, 5, 6), (3, 7, 8, 9),   -- rows
      (4, 1, 4, 7), (5, 2, 5, 8), (6, 3, 6, 9),   -- columns
      (7, 1, 5, 9), (8, 3, 5, 7)                  -- diagonals
  ) as line (n, a, b, c)
  cross join lateral (select substr(board, line.a, 1) as mark) as first_cell
  where board ~ '^[XO.]{9}$'
    and mark <> '.'
    and mark = substr(board, line.b, 1)
    and mark = substr(board, line.c, 1)
  order by line.n
  limit 1;
$$;

-- How many times a mark ('X' or 'O') appears on the board.
create or replace function private.count_mark(board text, mark text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select length(board) - length(replace(board, mark, ''));
$$;

-- True when no square is empty.
create or replace function private.is_board_full(board text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select position('.' in board) = 0;
$$;

-- True when the round is over (someone won, or the board is full).
create or replace function private.is_finished(board text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select private.ttt_winner(board) is not null or private.is_board_full(board);
$$;

-- Whose turn it is: X starts, so X moves whenever the counts are equal.
create or replace function private.current_turn(board text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when private.count_mark(board, 'X') = private.count_mark(board, 'O') then 'X'
    else 'O'
  end;
$$;

-- A room expires after 1 hour without activity. Every RPC checks this, so it
-- holds even if no clean-up ever runs. (now() is the transaction start time.)
create or replace function private.is_expired(updated_at timestamptz)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  select updated_at < now() - interval '1 hour';
$$;

-- A random 6-character room code from the approved alphabet.
-- The randomness comes from gen_random_uuid() (built in, cryptographically
-- strong): its first 6 bytes are fully random in a version-4 UUID. Each byte
-- is mapped with "% 31", which is very slightly uneven (8 characters are
-- 9/256 likely instead of 8/256) - harmless for room codes.
-- Uniqueness is NOT guaranteed here; the unique constraint is the authority
-- and create_game() retries on a collision.
create or replace function private.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  code text := '';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

-- Helpers are for the RPC functions only. (Without USAGE on the schema the
-- browser roles could not call them anyway; this is a second lock.)
revoke all on function private.ttt_winner(text) from public, anon, authenticated;
revoke all on function private.count_mark(text, text) from public, anon, authenticated;
revoke all on function private.is_board_full(text) from public, anon, authenticated;
revoke all on function private.is_finished(text) from public, anon, authenticated;
revoke all on function private.current_turn(text) from public, anon, authenticated;
revoke all on function private.is_expired(timestamptz) from public, anon, authenticated;
revoke all on function private.generate_room_code() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- RPC functions (public schema, called from the browser with supabase.rpc)
--
-- Security notes for every function below:
--   - SECURITY DEFINER: runs with the table owner's rights, because browsers
--     have no write access of their own. That makes these functions the only
--     door, so each one checks auth.uid() itself.
--   - set search_path = '': nothing can be hijacked by objects in another
--     schema; every table/function is written schema-qualified.
--   - Arguments are typed (uuid / integer / text) and only ever used as
--     values, never to build SQL, so there is no injection surface.
--   - EXECUTE is revoked from PUBLIC and anon and granted to authenticated
--     (Supabase anonymous users have the authenticated role).
-- -----------------------------------------------------------------------------

-- Start a new room. The caller is the host and plays X first.
create or replace function public.create_game()
returns public.online_games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game public.online_games;
  attempts integer := 0;
begin
  if caller is null then
    raise exception 'NOT_AUTHENTICATED' using detail = 'Sign in (anonymously) before creating a game.';
  end if;

  -- Housekeeping, so abandoned rooms do not pile up even without a scheduled
  -- job: remove rooms with no activity for 24 hours. (Rooms are already
  -- unusable after 1 hour; the extra time lets a late visitor see
  -- "expired" instead of "not found".)
  delete from public.online_games
  where updated_at < now() - interval '24 hours';

  -- Spam protection: a person has at most one waiting room. Starting a new
  -- one removes their old rooms that never got an opponent.
  delete from public.online_games
  where host_id = caller
    and guest_id is null;

  -- Insert with a fresh code; on the (rare) chance the code is taken,
  -- ON CONFLICT skips the insert and we try another code.
  loop
    attempts := attempts + 1;

    begin
      insert into public.online_games (room_code, host_id)
      values (private.generate_room_code(), caller)
      on conflict (room_code) do nothing
      returning * into game;
    exception
      -- The only other unique rule that can fail here is "one waiting room
      -- per host": a second create_game() from the same person ran at the
      -- same moment and won. Return that room instead of failing.
      when unique_violation then
        select * into game
        from public.online_games as g
        where g.host_id = caller
          and g.guest_id is null
          and g.left_by is null;
        if found then
          return game;
        end if;
        raise;
    end;

    if found then
      return game;
    end if;

    if attempts >= 10 then
      raise exception 'ROOM_CODE_UNAVAILABLE' using detail = 'Could not find a free room code. Try again.';
    end if;
  end loop;
end;
$$;

-- Join a room by its invite code, or rejoin a room you are already in.
-- The code is case-insensitive and may contain spaces or dashes.
create or replace function public.join_game(code text)
returns public.online_games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g'));
  game public.online_games;
begin
  if caller is null then
    raise exception 'NOT_AUTHENTICATED' using detail = 'Sign in (anonymously) before joining a game.';
  end if;

  if normalized !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'INVALID_ROOM_CODE' using detail = 'Room codes are 6 letters and numbers.';
  end if;

  -- Lock the room so two people cannot take the guest seat at once: the
  -- second one waits here, then sees the seat is taken.
  select * into game
  from public.online_games as g
  where g.room_code = normalized
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if private.is_expired(game.updated_at) then
    raise exception 'ROOM_EXPIRED';
  end if;
  if game.left_by is not null then
    raise exception 'ROOM_CLOSED';
  end if;

  -- Already in this room (e.g. after a refresh): just return it.
  if caller = game.host_id or caller = game.guest_id then
    return game;
  end if;

  if game.guest_id is not null then
    raise exception 'ROOM_FULL';
  end if;

  update public.online_games as g
  set guest_id = caller,
      version = g.version + 1,
      updated_at = now()
  where g.id = game.id
  returning * into game;

  return game;
end;
$$;

-- Play one mark. The server decides whether the move is legal.
create or replace function public.make_move(game_id uuid, cell integer)
returns public.online_games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game public.online_games;
  caller_mark text;
  new_board text;
  winner text;
begin
  if caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the row for the rest of this transaction. If both players send a
  -- move at nearly the same moment, the second request waits here and then
  -- runs every check below against the board AFTER the first move.
  select * into game
  from public.online_games as g
  where g.id = make_move.game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  -- Checked early so a stranger learns nothing else about the room.
  if caller <> game.host_id and caller is distinct from game.guest_id then
    raise exception 'NOT_A_PLAYER';
  end if;
  if private.is_expired(game.updated_at) then
    raise exception 'ROOM_EXPIRED';
  end if;
  if game.left_by is not null then
    raise exception 'ROOM_CLOSED';
  end if;
  if game.guest_id is null then
    raise exception 'WAITING_FOR_OPPONENT';
  end if;
  if private.is_finished(game.board) then
    raise exception 'GAME_OVER';
  end if;
  if cell is null or cell < 0 or cell > 8 then
    raise exception 'INVALID_CELL' using detail = 'Squares are numbered 0 to 8.';
  end if;
  if substr(game.board, cell + 1, 1) <> '.' then
    raise exception 'CELL_TAKEN';
  end if;

  -- The caller's mark this round: the host has host_mark, the guest the other.
  if caller = game.host_id then
    caller_mark := game.host_mark;
  else
    caller_mark := case game.host_mark when 'X' then 'O' else 'X' end;
  end if;
  if caller_mark <> private.current_turn(game.board) then
    raise exception 'NOT_YOUR_TURN';
  end if;

  -- Apply exactly one mark, then score the result (at most once: a finished
  -- board is rejected above, so a round can only end on one move).
  new_board := overlay(game.board placing caller_mark from cell + 1 for 1);
  winner := private.ttt_winner(new_board);

  update public.online_games as g
  set board = new_board,
      host_wins = g.host_wins + case when winner is not null and winner = g.host_mark then 1 else 0 end,
      guest_wins = g.guest_wins + case when winner is not null and winner <> g.host_mark then 1 else 0 end,
      draws = g.draws + case when winner is null and private.is_board_full(new_board) then 1 else 0 end,
      version = g.version + 1,
      updated_at = now()
  where g.id = game.id
  returning * into game;

  return game;
end;
$$;

-- Ask for a rematch, or accept the opponent's request.
-- The first request is only recorded; when the OTHER player also asks, the
-- board resets, the marks swap and the scores are kept. Asking twice yourself
-- does nothing.
create or replace function public.request_rematch(game_id uuid)
returns public.online_games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game public.online_games;
begin
  if caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into game
  from public.online_games as g
  where g.id = request_rematch.game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if caller <> game.host_id and caller is distinct from game.guest_id then
    raise exception 'NOT_A_PLAYER';
  end if;
  if private.is_expired(game.updated_at) then
    raise exception 'ROOM_EXPIRED';
  end if;
  if game.left_by is not null then
    raise exception 'ROOM_CLOSED';
  end if;
  if game.guest_id is null then
    raise exception 'WAITING_FOR_OPPONENT';
  end if;
  if not private.is_finished(game.board) then
    raise exception 'GAME_NOT_FINISHED';
  end if;

  -- Already asked: nothing changes (the caller cannot accept their own request).
  if game.rematch_requested_by = caller then
    return game;
  end if;

  if game.rematch_requested_by is null then
    -- First request.
    update public.online_games as g
    set rematch_requested_by = caller,
        version = g.version + 1,
        updated_at = now()
    where g.id = game.id
    returning * into game;
  else
    -- The other player asked first: start the rematch.
    update public.online_games as g
    set board = '.........',
        host_mark = case g.host_mark when 'X' then 'O' else 'X' end,
        rematch_requested_by = null,
        version = g.version + 1,
        updated_at = now()
    where g.id = game.id
    returning * into game;
  end if;

  return game;
end;
$$;

-- Leave the room. It is closed for good: no more moves, joins or rematches.
-- Calling it again keeps the first person who left.
create or replace function public.leave_game(game_id uuid)
returns public.online_games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game public.online_games;
begin
  if caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into game
  from public.online_games as g
  where g.id = leave_game.game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if caller <> game.host_id and caller is distinct from game.guest_id then
    raise exception 'NOT_A_PLAYER';
  end if;

  if game.left_by is not null then
    return game;
  end if;

  update public.online_games as g
  set left_by = caller,
      rematch_requested_by = null,
      version = g.version + 1,
      updated_at = now()
  where g.id = game.id
  returning * into game;

  return game;
end;
$$;

-- Only signed-in users (anonymous ones included) may call the RPCs.
-- Supabase also grants EXECUTE on new public functions to anon by default,
-- so revoke that explicitly.
revoke all on function public.create_game() from public, anon;
revoke all on function public.join_game(text) from public, anon;
revoke all on function public.make_move(uuid, integer) from public, anon;
revoke all on function public.request_rematch(uuid) from public, anon;
revoke all on function public.leave_game(uuid) from public, anon;

grant execute on function public.create_game() to authenticated;
grant execute on function public.join_game(text) to authenticated;
grant execute on function public.make_move(uuid, integer) to authenticated;
grant execute on function public.request_rematch(uuid) to authenticated;
grant execute on function public.leave_game(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Realtime: let the two players receive row updates (Postgres Changes).
-- Realtime applies the SELECT policy above to every subscriber, so only the
-- players of a room receive its updates. Written to be safe to run twice and
-- to do nothing where the publication does not exist (e.g. plain Postgres).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'online_games'
     ) then
    alter publication supabase_realtime add table public.online_games;
  end if;
end;
$$;
