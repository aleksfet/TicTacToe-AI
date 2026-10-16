# Online multiplayer backend: test plan

Tests for `supabase/migrations/20261016120000_online_multiplayer.sql` and
`supabase/migrations/20261016180000_scheduled_cleanup.sql`.

> **Status:** both `.test.sql` files pass in PGlite (Postgres compiled to
> WebAssembly) with a small stand-in for the pgTAP functions they use. They
> have not yet been run under real pgTAP (`supabase test db`).

## What is here

| File | What it checks | How it runs |
|---|---|---|
| `database/online_games.test.sql` | Everything that can be tested in one database session: constraints, privileges, RLS, all five RPCs, win/draw/scoring, rematch, expiry, leaving, clean-up | pgTAP (`supabase test db`) |
| `database/cleanup.test.sql` | The hourly clean-up: only rooms idle for more than 24 hours are deleted, auth users are untouched, browser roles cannot run it, a second run deletes nothing, exactly one cron job (where pg_cron exists) | pgTAP (`supabase test db`) |
| `winner_parity/generate.js` | Generates a pgTAP test proving SQL `private.ttt_winner` agrees with `getWinner` in `src/game.js` on all 3^9 = 19,683 boards | Generate, then pgTAP |
| This file, "Concurrency" section | The two race conditions, which need two database sessions at once | Two `psql` sessions now; an automated two-client test in a later phase |

## How to run (once a test database exists)

The safest place is a **local** Supabase stack (Docker + Supabase CLI) or a
**separate throwaway** Supabase project, never the real one first.

```bash
# local stack (needs Docker Desktop and the Supabase CLI)
supabase init            # creates supabase/config.toml (only needed once)
supabase start
supabase db reset        # applies supabase/migrations/*
node supabase/tests/winner_parity/generate.js > supabase/tests/database/winner_parity.test.sql
supabase test db         # runs every *.test.sql in supabase/tests/database
```

The test files run inside a transaction that is rolled back, so they leave
nothing behind. They insert four fixed test users into `auth.users`.

## Coverage map

| Requirement | Where |
|---|---|
| create room, host identity, starting state | `online_games.test.sql` section 4 |
| one waiting room per host (spam protection) | section 4 |
| unique room code, code format, generator alphabet | sections 1, 2, 4 |
| guest join, code normalization (case, spaces, dashes) | section 5 |
| host cannot take the guest seat, rejoin as host / guest | section 5 |
| third player rejected (ROOM_FULL) | section 5 |
| invalid / unknown code | section 5 |
| move before the guest joins | section 5 |
| RLS: strangers see nothing, players see only their room | section 6 |
| direct INSERT / UPDATE / DELETE rejected | section 6 |
| anon (not signed in) has no access; no user id = NOT_AUTHENTICATED | section 3 |
| private helpers not callable by browser roles | section 3 |
| non-player cannot move / rematch / leave | section 6 |
| X/O turn enforcement, occupied square, invalid cell, unknown game | section 7 |
| win detection, score incremented exactly once | section 8 |
| no moves after a win or a draw | sections 8, 10 |
| rematch: needs both players, asking twice does nothing, marks swap, scores kept | sections 9, 11 |
| draw detection | section 10 |
| expiry at 1 hour (59 min ok, 61 min expired) for join / rematch / move | sections 12, 14 |
| leave closes the room; first leaver is kept; players can still read it | section 13 |
| rooms idle > 24 h cleaned up by `create_game` | section 14 |
| table added to the `supabase_realtime` publication | section 15 |
| hourly pg_cron clean-up of rooms idle > 24 h (and nothing else) | `cleanup.test.sql` |
| SQL rules = JS rules on all 19,683 boards | `database/cleanup.test.sql` | The hourly clean-up: only rooms idle for more than 24 hours are deleted, auth users are untouched, browser roles cannot run it, a second run deletes nothing, exactly one cron job (where pg_cron exists) | pgTAP (`supabase test db`) |
| `winner_parity/generate.js` |

## Concurrency (two sessions)

pgTAP runs in one session, so the races are checked by hand with two `psql`
windows against the test database (or later by an automated two-client test).
Set up a joined room first (e.g. by running the first sections of the test file
without the final `rollback`, in a scratch database).

**1. Two moves at nearly the same time** (e.g. a double tap):

```sql
-- Session A                                    -- Session B
begin;
select set_config('request.jwt.claim.sub', '<x player id>', true);
set local role authenticated;
select board from public.make_move('<game id>', 4);
                                                begin;
                                                select set_config('request.jwt.claim.sub', '<x player id>', true);
                                                set local role authenticated;
                                                select public.make_move('<game id>', 5);
                                                -- waits here: A holds the row lock
commit;
                                                -- now fails with NOT_YOUR_TURN
                                                rollback;
```

Expected: exactly one move is stored; the second request is re-checked
against the new board and rejected.

**2. Two people joining the same waiting room at once:** the same pattern
with `join_game('<code>')` from two different user ids. Expected: one becomes
the guest, the other gets `ROOM_FULL`.

## Not covered here (later phases)

- Realtime delivery of row changes to subscribed browsers, and that a
  stranger's subscription receives nothing (needs the client, phase 3C/3D).
- Presence / disconnect handling, reconnect and resync (phase 3E).
- Anonymous sign-in rate limits (a Supabase Auth setting, not this schema).
