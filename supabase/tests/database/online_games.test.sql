-- =============================================================================
-- Database tests for supabase/migrations/*_online_multiplayer.sql
--
-- NOT YET RUN. Written for pgTAP and the Supabase CLI:
--     supabase test db
-- (see supabase/tests/TEST_PLAN.md). Everything happens inside one
-- transaction that is rolled back at the end, so nothing is kept.
--
-- How the tests pretend to be different people:
--   - "act as" a user = set the JWT claims that auth.uid() reads, while
--     running as the "authenticated" role (what Supabase anonymous users get);
--   - setup steps that a browser could never do (pinning ids, back-dating
--     timestamps) run after "reset role", i.e. as the database owner.
-- Inside one transaction now() never changes, so every timestamp written by
-- the RPCs equals now(); expiry is tested by back-dating updated_at.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- -----------------------------------------------------------------------------
-- Test users (fixed ids so the assertions are readable)
-- -----------------------------------------------------------------------------
--   host   11111111-...   creates the main room
--   guest  22222222-...   joins it
--   third  33333333-...   a stranger
--   host2  44444444-...   owns a second room
insert into auth.users (id, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated');

-- =============================================================================
-- 1. Helper: ttt_winner (spot checks; the full 19,683-board comparison with
--    src/game.js lives in supabase/tests/winner_parity/)
-- =============================================================================
select is(private.ttt_winner('XXX......'), 'X', 'ttt_winner: top row');
select is(private.ttt_winner('...OOO...'), 'O', 'ttt_winner: middle row');
select is(private.ttt_winner('......XXX'), 'X', 'ttt_winner: bottom row');
select is(private.ttt_winner('O..O..O..'), 'O', 'ttt_winner: left column');
select is(private.ttt_winner('.X..X..X.'), 'X', 'ttt_winner: middle column');
select is(private.ttt_winner('..O..O..O'), 'O', 'ttt_winner: right column');
select is(private.ttt_winner('X...X...X'), 'X', 'ttt_winner: diagonal');
select is(private.ttt_winner('..O.O.O..'), 'O', 'ttt_winner: anti-diagonal');
select is(private.ttt_winner('.........'), null::text, 'ttt_winner: empty board');
select is(private.ttt_winner('XOXXOOOXX'), null::text, 'ttt_winner: full board, no winner (draw)');
select is(private.ttt_winner('OXXXOXOOX'), 'X', 'ttt_winner: win on the final square');
select is(private.ttt_winner('XXX'), null::text, 'ttt_winner: malformed board gives NULL');
select is(private.is_board_full('XOXXOOOXX'), true, 'is_board_full: full');
select is(private.is_board_full('XOXXOOOX.'), false, 'is_board_full: one empty');
select is(private.current_turn('.........'), 'X', 'current_turn: X starts');
select is(private.current_turn('X........'), 'O', 'current_turn: O after X');
select is(private.current_turn('XO.......'), 'X', 'current_turn: X after O');

select is(
  (select count(*) from generate_series(1, 1000)
   where private.generate_room_code() !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  0::bigint,
  'generate_room_code: 1000 codes all use the approved alphabet and length'
);

-- =============================================================================
-- 2. Table constraints (as the owner, bypassing the RPCs)
-- =============================================================================
select throws_ok(
  $$ insert into public.online_games (room_code, host_id, guest_id)
     values ('AAAAA2', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'constraint: guest cannot be the host');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id) values ('AAAA0O', '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'constraint: room code alphabet (no 0 / O)');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id) values ('aaaaa2', '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'constraint: room code must be upper case');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id, board) values ('AAAAA3', '11111111-1111-4111-8111-111111111111', 'XO?......') $$,
  '23514', null, 'constraint: board characters');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id, board) values ('AAAAA4', '11111111-1111-4111-8111-111111111111', 'XX.......') $$,
  '23514', null, 'constraint: board must be reachable (X at most one ahead)');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id, host_wins) values ('AAAAA5', '11111111-1111-4111-8111-111111111111', -1) $$,
  '23514', null, 'constraint: scores never negative');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id, host_mark) values ('AAAAA6', '11111111-1111-4111-8111-111111111111', 'Z') $$,
  '23514', null, 'constraint: host_mark is X or O');

-- =============================================================================
-- 3. Who may call what
-- =============================================================================
-- Not signed in at all (anon role): no access to the RPCs or the table.
set local role anon;
select throws_ok($$ select public.create_game() $$, '42501', null, 'anon cannot call create_game');
select throws_ok($$ select count(*) from public.online_games $$, '42501', null, 'anon cannot read online_games');
reset role;

-- Authenticated role but no user id in the token.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$ select public.create_game() $$, 'P0001', 'NOT_AUTHENTICATED', 'create_game requires a user id');
select throws_ok($$ select public.join_game('AAAAA2') $$, 'P0001', 'NOT_AUTHENTICATED', 'join_game requires a user id');
reset role;

-- Private helpers are not callable by browser roles.
set local role authenticated;
select throws_ok($$ select private.ttt_winner('.........') $$, '42501', null, 'authenticated cannot call private helpers');
reset role;

-- =============================================================================
-- 4. create_game
-- =============================================================================
-- Act as host.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

select lives_ok($$ select public.create_game() $$, 'host can create a game');
select results_eq(
  $$ select host_id, guest_id, board, host_mark, host_wins, guest_wins, draws, version, rematch_requested_by, left_by
     from public.online_games $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, null::uuid, '.........'::text, 'X'::text,
             0::smallint, 0::smallint, 0::smallint, 1, null::uuid, null::uuid) $$,
  'new game: caller is host, X, empty board, no guest, zero scores, version 1'
);
select ok((select room_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' from public.online_games), 'new game has a valid room code');

-- Creating again replaces the host's waiting room instead of adding one.
select lives_ok($$ select public.create_game() $$, 'host can create again');
select is((select count(*) from public.online_games where host_id = '11111111-1111-4111-8111-111111111111'), 1::bigint,
  'still exactly one waiting room for the host');
reset role;

-- Pin the room's id and code so later tests can refer to them.
update public.online_games
set id = 'a0000000-0000-4000-8000-000000000001', room_code = 'TESTAA'
where host_id = '11111111-1111-4111-8111-111111111111';

-- A second room for host2 (stays waiting, used for "no guest yet" checks).
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select lives_ok($$ select public.create_game() $$, 'host2 can create a game');
reset role;
update public.online_games
set id = 'a0000000-0000-4000-8000-000000000002', room_code = 'TESTBB'
where host_id = '44444444-4444-4444-8444-444444444444';

-- The unique constraint is the final authority on room codes.
select throws_ok(
  $$ insert into public.online_games (room_code, host_id) values ('TESTAA', '33333333-3333-4333-8333-333333333333') $$,
  '23505', null, 'room codes are unique');

-- =============================================================================
-- 5. join_game
-- =============================================================================
-- Host "joins" their own room (e.g. after a refresh): a rejoin, nothing changes.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select is((public.join_game('TESTAA')).guest_id, null::uuid, 'host rejoining does not take the guest seat');
select is((public.join_game('TESTAA')).version, 1, 'host rejoin does not change the room');

-- Moving before anyone has joined.
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'WAITING_FOR_OPPONENT', 'no moves before the guest joins');

-- Guest joins.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok($$ select public.join_game('ABC') $$, 'P0001', 'INVALID_ROOM_CODE', 'too-short code rejected');
select throws_ok($$ select public.join_game('TESTA0') $$, 'P0001', 'INVALID_ROOM_CODE', 'code with a confusing character rejected');
select throws_ok($$ select public.join_game(null) $$, 'P0001', 'INVALID_ROOM_CODE', 'NULL code rejected');
select throws_ok($$ select public.join_game('ZZZZZZ') $$, 'P0001', 'ROOM_NOT_FOUND', 'unknown code rejected');
select is((public.join_game(' tes-taa ')).guest_id, '22222222-2222-4222-8222-222222222222'::uuid,
  'guest joins; the code is normalized (case, spaces, dashes)');
select is((select version from public.online_games where id = 'a0000000-0000-4000-8000-000000000001'), 2,
  'joining bumps the version');
select is((public.join_game('TESTAA')).version, 2, 'guest rejoin returns the room unchanged');

-- A third person cannot get in.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok($$ select public.join_game('TESTAA') $$, 'P0001', 'ROOM_FULL', 'third person gets ROOM_FULL');

-- =============================================================================
-- 6. Row Level Security and direct writes
-- =============================================================================
-- (still acting as the stranger)
select is((select count(*) from public.online_games), 0::bigint, 'RLS: a stranger sees no rooms');
select throws_ok(
  $$ insert into public.online_games (room_code, host_id) values ('AAAAA7', '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'direct INSERT is not allowed');
select throws_ok(
  $$ update public.online_games set board = 'XXX......' $$,
  '42501', null, 'direct UPDATE is not allowed');
select throws_ok(
  $$ delete from public.online_games $$,
  '42501', null, 'direct DELETE is not allowed');
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'NOT_A_PLAYER', 'a stranger cannot move');
select throws_ok($$ select public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'NOT_A_PLAYER', 'a stranger cannot request a rematch');
select throws_ok($$ select public.leave_game('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'NOT_A_PLAYER', 'a stranger cannot close the room');

-- The guest sees exactly the room they play in (not host2's room).
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select results_eq($$ select id from public.online_games $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid) $$, 'RLS: guest sees only their room');
-- Players cannot write directly either.
select throws_ok($$ update public.online_games set host_wins = 99 $$, '42501', null, 'players cannot UPDATE directly');

-- =============================================================================
-- 7. make_move: turn order and legality (host is X, guest is O)
-- =============================================================================
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 4) $$,
  'P0001', 'NOT_YOUR_TURN', 'O cannot move first');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 9) $$, 'P0001', 'INVALID_CELL', 'cell 9 rejected');
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', -1) $$, 'P0001', 'INVALID_CELL', 'cell -1 rejected');
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', null) $$, 'P0001', 'INVALID_CELL', 'NULL cell rejected');
select throws_ok($$ select public.make_move('b0000000-0000-4000-8000-000000000009', 0) $$, 'P0001', 'ROOM_NOT_FOUND', 'unknown game id rejected');

select is((public.make_move('a0000000-0000-4000-8000-000000000001', 0)).board, 'X........', 'X plays square 0');
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 1) $$,
  'P0001', 'NOT_YOUR_TURN', 'X cannot move twice in a row');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'CELL_TAKEN', 'occupied square rejected');
select throws_ok($$ select public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'GAME_NOT_FINISHED', 'no rematch while the game is running');
select is((public.make_move('a0000000-0000-4000-8000-000000000001', 3)).board, 'X..O.....', 'O plays square 3');

-- X: 0, 1, 2 (top row) / O: 3, 4
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 1) $$, 'X plays 1');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select lives_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 4) $$, 'O plays 4');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- =============================================================================
-- 8. Win, scoring once, no moves after the end
-- =============================================================================
select results_eq(
  $$ select board, host_wins, guest_wins, draws from public.make_move('a0000000-0000-4000-8000-000000000001', 2) $$,
  $$ values ('XXXOO....'::text, 1::smallint, 0::smallint, 0::smallint) $$,
  'X completes the top row: host (X) scores one win'
);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 8) $$,
  'P0001', 'GAME_OVER', 'no moves after a win');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 8) $$,
  'P0001', 'GAME_OVER', 'the loser cannot move after a win either');
select results_eq(
  $$ select host_wins, guest_wins, draws from public.online_games where id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values (1::smallint, 0::smallint, 0::smallint) $$,
  'the win was counted exactly once'
);

-- =============================================================================
-- 9. Rematch: needs both players, swaps marks, keeps scores
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((public.request_rematch('a0000000-0000-4000-8000-000000000001')).rematch_requested_by,
  '11111111-1111-4111-8111-111111111111'::uuid, 'host asks for a rematch');
select results_eq(
  $$ select board, version from public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  $$ select board, version from public.online_games where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'asking twice changes nothing'
);
select is((select board from public.online_games where id = 'a0000000-0000-4000-8000-000000000001'), 'XXXOO....',
  'the requester alone cannot start the rematch');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select results_eq(
  $$ select board, host_mark, rematch_requested_by, host_wins, guest_wins, draws
     from public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  $$ values ('.........'::text, 'O'::text, null::uuid, 1::smallint, 0::smallint, 0::smallint) $$,
  'guest accepts: board reset, marks swapped (guest is now X), scores kept'
);

-- Now the guest is X and moves first.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'NOT_YOUR_TURN', 'after the swap the host (now O) waits');

-- =============================================================================
-- 10. Draw (guest X, host O): X0 O1 X2 O4 X3 O5 X7 O6 X8 -> XOXXOOOXX
-- =============================================================================
do $$
declare
  moves integer[] := array[0, 1, 2, 4, 3, 5, 7, 6, 8];
  guest_claims text := '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
  host_claims text := '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
begin
  for i in 1..array_length(moves, 1) loop
    -- odd turns are X (the guest), even turns O (the host)
    perform set_config('request.jwt.claims', case when i % 2 = 1 then guest_claims else host_claims end, true);
    perform set_config('request.jwt.claim.sub', (case when i % 2 = 1 then guest_claims else host_claims end)::jsonb ->> 'sub', true);
    perform public.make_move('a0000000-0000-4000-8000-000000000001', moves[i]);
  end loop;
end;
$$;
select results_eq(
  $$ select board, host_wins, guest_wins, draws from public.online_games where id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values ('XOXXOOOXX'::text, 1::smallint, 0::smallint, 1::smallint) $$,
  'full board with no line is a draw, counted once'
);
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'GAME_OVER', 'no moves after a draw');

-- =============================================================================
-- 11. Waiting room checks (host2's room has no guest)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select throws_ok($$ select public.request_rematch('a0000000-0000-4000-8000-000000000002') $$,
  'P0001', 'WAITING_FOR_OPPONENT', 'no rematch without a second player');

-- =============================================================================
-- 12. Expiry (1 hour without activity)
-- =============================================================================
reset role;
update public.online_games set updated_at = now() - interval '61 minutes'
where id = 'a0000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select throws_ok($$ select public.join_game('TESTAA') $$, 'P0001', 'ROOM_EXPIRED', 'expired room cannot be rejoined');
select throws_ok($$ select public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'ROOM_EXPIRED', 'expired room: no rematch');
-- (make_move on an expired room is checked in section 14.)
reset role;
update public.online_games set updated_at = now() - interval '59 minutes'
where id = 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$ select public.join_game('TESTAA') $$, '59 minutes without activity is still fine');
reset role;

-- =============================================================================
-- 13. Leaving closes the room
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select is((public.leave_game('a0000000-0000-4000-8000-000000000001')).left_by,
  '22222222-2222-4222-8222-222222222222'::uuid, 'guest leaves');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((public.leave_game('a0000000-0000-4000-8000-000000000001')).left_by,
  '22222222-2222-4222-8222-222222222222'::uuid, 'leaving again keeps the first person who left');
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'ROOM_CLOSED', 'no moves in a closed room');
select throws_ok($$ select public.request_rematch('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'ROOM_CLOSED', 'no rematch in a closed room');
select throws_ok($$ select public.join_game('TESTAA') $$, 'P0001', 'ROOM_CLOSED', 'a closed room cannot be joined');
select results_eq($$ select id from public.online_games $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid) $$,
  'players can still read a closed room (to show "opponent left")');
reset role;

-- =============================================================================
-- 14. Expired make_move, and opportunistic clean-up in create_game
-- =============================================================================
-- Give host2's room a guest so the expiry check is the one that fires.
update public.online_games
set guest_id = '33333333-3333-4333-8333-333333333333', updated_at = now() - interval '2 hours'
where id = 'a0000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select throws_ok($$ select public.make_move('a0000000-0000-4000-8000-000000000002', 0) $$,
  'P0001', 'ROOM_EXPIRED', 'no moves in an expired room');
reset role;

-- Rooms idle for over 24 hours are removed the next time anyone creates a game.
update public.online_games set updated_at = now() - interval '25 hours'
where id = 'a0000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
set local role authenticated;
select lives_ok($$ select public.create_game() $$, 'a new game can be created');
reset role;
select is((select count(*) from public.online_games where id = 'a0000000-0000-4000-8000-000000000002'), 0::bigint,
  'a room idle for over 24 hours was cleaned up');
select is((select count(*) from public.online_games where id = 'a0000000-0000-4000-8000-000000000001'), 1::bigint,
  'a recent room was kept');

-- =============================================================================
-- 15. Realtime publication
-- =============================================================================
select ok(
  not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
  or exists (select 1 from pg_catalog.pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'online_games'),
  'online_games is in the supabase_realtime publication (when it exists)'
);

select * from finish();
rollback;
