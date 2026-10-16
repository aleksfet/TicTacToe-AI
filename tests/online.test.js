// Tests for the pure online helpers in src/online.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const Online = require("../src/online.js");

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

// A game row shaped like public.online_games, with sensible defaults.
function row(overrides = {}) {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    room_code: "K7M2QX",
    host_id: HOST,
    guest_id: GUEST,
    board: ".........",
    host_mark: "X",
    rematch_requested_by: null,
    left_by: null,
    host_wins: 0,
    guest_wins: 0,
    draws: 0,
    version: 2,
    created_at: "2026-10-16T10:00:00.000Z",
    updated_at: "2026-10-16T10:00:00.000Z",
    ...overrides,
  };
}

// --- Room codes ---------------------------------------------------------------

test("normalizeRoomCode: capitals, no spaces or dashes", () => {
  assert.equal(Online.normalizeRoomCode("k7m2qx"), "K7M2QX");
  assert.equal(Online.normalizeRoomCode("  K7M2QX \n"), "K7M2QX");
  assert.equal(Online.normalizeRoomCode("k7m-2qx"), "K7M2QX");
  assert.equal(Online.normalizeRoomCode("K7M 2QX"), "K7M2QX");
  assert.equal(Online.normalizeRoomCode("k\t7-m 2-q x"), "K7M2QX");
});

test("normalizeRoomCode: anything that is not text becomes an empty string", () => {
  for (const value of [null, undefined, 123456, {}, ["K7M2QX"], true]) {
    assert.equal(Online.normalizeRoomCode(value), "");
  }
});

test("isValidRoomCode: exactly 6 characters from the alphabet", () => {
  assert.equal(Online.isValidRoomCode("K7M2QX"), true);
  assert.equal(Online.isValidRoomCode("ABCDEF"), true);
  assert.equal(Online.isValidRoomCode("234567"), true);
  for (const bad of ["", "K7M2Q", "K7M2QXX", "k7m2qx", "K7M-2Q", "K7M2Q ", null, undefined, 123456]) {
    assert.equal(Online.isValidRoomCode(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("isValidRoomCode: the confusing characters 0, O, 1, I and L are not allowed", () => {
  for (const ch of ["0", "O", "1", "I", "L"]) {
    assert.equal(Online.isValidRoomCode("K7M2Q" + ch), false, `should reject ${ch}`);
  }
});

test("room code alphabet matches the database: 31 characters, none of 0 O 1 I L", () => {
  assert.equal(Online.ROOM_CODE_ALPHABET, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  assert.equal(new Set(Online.ROOM_CODE_ALPHABET).size, 31);
  for (const ch of Online.ROOM_CODE_ALPHABET) {
    assert.equal(Online.isValidRoomCode(ch.repeat(6)), true);
  }
});

test("normalize then validate accepts what people type", () => {
  for (const typed of ["k7m2qx", " k7m-2qx ", "K7M 2QX"]) {
    assert.equal(Online.isValidRoomCode(Online.normalizeRoomCode(typed)), true);
  }
  for (const typed of ["k7m2q", "k7m2qo", "hello!", ""]) {
    assert.equal(Online.isValidRoomCode(Online.normalizeRoomCode(typed)), false);
  }
});

// --- Boards -------------------------------------------------------------------

test("boardFromServer: empty and mixed boards", () => {
  assert.deepEqual(Online.boardFromServer("........."), ["", "", "", "", "", "", "", "", ""]);
  assert.deepEqual(Online.boardFromServer("X.O..X..O"), ["X", "", "O", "", "", "X", "", "", "O"]);
});

test("boardFromServer: invalid input gives null", () => {
  for (const bad of ["", "........", "..........", "x........", "X.O.....?", "XO-......", null, undefined, 9, ["X"]]) {
    assert.equal(Online.boardFromServer(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("boardToServer: arrays back to the server format", () => {
  assert.equal(Online.boardToServer(["", "", "", "", "", "", "", "", ""]), ".........");
  assert.equal(Online.boardToServer(["X", "", "O", "", "", "X", "", "", "O"]), "X.O..X..O");
});

test("boardToServer: invalid input gives null", () => {
  assert.equal(Online.boardToServer(null), null);
  assert.equal(Online.boardToServer("........."), null);
  assert.equal(Online.boardToServer(["X", "", ""]), null);
  assert.equal(Online.boardToServer(["x", "", "", "", "", "", "", "", ""]), null);
  assert.equal(Online.boardToServer([".", "", "", "", "", "", "", "", ""]), null);
  assert.equal(Online.boardToServer([null, "", "", "", "", "", "", "", ""]), null);
});

test("board conversion round-trips for every one of the 19,683 boards", () => {
  const symbols = [".", "X", "O"];
  for (let n = 0; n < 3 ** 9; n++) {
    let text = "";
    for (let square = 0; square < 9; square++) {
      text += symbols[Math.floor(n / 3 ** square) % 3];
    }
    assert.equal(Online.boardToServer(Online.boardFromServer(text)), text);
  }
});

// --- deriveOnlineState ------------------------------------------------------------

test("host is X and guest is O in the first round", () => {
  const host = Online.deriveOnlineState(row(), HOST);
  assert.equal(host.amHost, true);
  assert.equal(host.amGuest, false);
  assert.equal(host.amPlayer, true);
  assert.equal(host.myMark, "X");
  assert.equal(host.opponentMark, "O");

  const guest = Online.deriveOnlineState(row(), GUEST);
  assert.equal(guest.amHost, false);
  assert.equal(guest.amGuest, true);
  assert.equal(guest.myMark, "O");
  assert.equal(guest.opponentMark, "X");
});

test("after a rematch the marks swap: host O, guest X", () => {
  const swapped = row({ host_mark: "O" });
  assert.equal(Online.deriveOnlineState(swapped, HOST).myMark, "O");
  assert.equal(Online.deriveOnlineState(swapped, GUEST).myMark, "X");
  // X always starts, so now the guest moves first.
  assert.equal(Online.deriveOnlineState(swapped, GUEST).isMyTurn, true);
  assert.equal(Online.deriveOnlineState(swapped, HOST).isMyTurn, false);
});

test("waiting room: no guest yet", () => {
  const state = Online.deriveOnlineState(row({ guest_id: null, version: 1 }), HOST);
  assert.equal(state.status, "waiting");
  assert.equal(state.waitingForOpponent, true);
  assert.equal(state.isMyTurn, false, "nobody moves before the opponent arrives");
  assert.equal(state.amHost, true);
});

test("active room: turns alternate and only the right player may move", () => {
  const empty = row();
  assert.equal(Online.deriveOnlineState(empty, HOST).status, "playing");
  assert.equal(Online.deriveOnlineState(empty, HOST).turn, "X");
  assert.equal(Online.deriveOnlineState(empty, HOST).isMyTurn, true);
  assert.equal(Online.deriveOnlineState(empty, GUEST).isMyTurn, false);

  const afterX = row({ board: "X........", version: 3 });
  assert.equal(Online.deriveOnlineState(afterX, HOST).turn, "O");
  assert.equal(Online.deriveOnlineState(afterX, HOST).isMyTurn, false);
  assert.equal(Online.deriveOnlineState(afterX, GUEST).isMyTurn, true);
});

test("a stranger (or no user) is never a player and never has a turn", () => {
  for (const who of [STRANGER, null, undefined, ""]) {
    const state = Online.deriveOnlineState(row(), who);
    assert.equal(state.amPlayer, false);
    assert.equal(state.myMark, null);
    assert.equal(state.isMyTurn, false);
    assert.equal(state.myWins, null);
    assert.equal(state.draws, null);
  }
});

test("win: winner, winning line and result from each side", () => {
  const won = row({ board: "XXXOO....", host_wins: 1, version: 7 });
  const host = Online.deriveOnlineState(won, HOST);
  const guest = Online.deriveOnlineState(won, GUEST);
  assert.equal(host.status, "finished");
  assert.equal(host.winner, "X");
  assert.deepEqual(host.winningLine, [0, 1, 2]);
  assert.equal(host.result, "win");
  assert.equal(guest.result, "loss");
  assert.equal(host.isMyTurn, false);
  assert.equal(guest.isMyTurn, false, "no turns after the game ends");
});

test("draw", () => {
  const drawn = row({ board: "XOXXOOOXX", draws: 1 });
  const state = Online.deriveOnlineState(drawn, GUEST);
  assert.equal(state.status, "finished");
  assert.equal(state.winner, null);
  assert.equal(state.winningLine, null);
  assert.equal(state.draw, true);
  assert.equal(state.result, "draw");
  assert.equal(state.isMyTurn, false);
});

test("closed room: who left, and nobody can move", () => {
  const closed = row({ board: "X........", left_by: GUEST });
  const host = Online.deriveOnlineState(closed, HOST);
  const guest = Online.deriveOnlineState(closed, GUEST);
  assert.equal(host.status, "closed");
  assert.equal(host.closed, true);
  assert.equal(host.leftBy, "opponent");
  assert.equal(guest.leftBy, "me");
  assert.equal(host.isMyTurn, false);
  assert.equal(guest.isMyTurn, false);
  // Closed wins over waiting (a host can cancel a waiting room).
  assert.equal(Online.deriveOnlineState(row({ guest_id: null, left_by: HOST }), HOST).status, "closed");
});

test("scores are mapped to You / Opponent for each side, and survive the mark swap", () => {
  const scored = row({ host_mark: "O", host_wins: 3, guest_wins: 1, draws: 2 });
  const host = Online.deriveOnlineState(scored, HOST);
  const guest = Online.deriveOnlineState(scored, GUEST);
  assert.deepEqual([host.myWins, host.opponentWins, host.draws], [3, 1, 2]);
  assert.deepEqual([guest.myWins, guest.opponentWins, guest.draws], [1, 3, 2]);
});

test("rematch requests are reported from each side", () => {
  const asked = row({ board: "XXXOO....", rematch_requested_by: HOST });
  assert.equal(Online.deriveOnlineState(asked, HOST).rematch, "me");
  assert.equal(Online.deriveOnlineState(asked, GUEST).rematch, "opponent");
  assert.equal(Online.deriveOnlineState(row(), HOST).rematch, null);
});

test("deriveOnlineState passes through ids and version", () => {
  const state = Online.deriveOnlineState(row({ version: 5 }), HOST);
  assert.equal(state.version, 5);
  assert.equal(state.roomCode, "K7M2QX");
  assert.equal(state.gameId, "a0000000-0000-4000-8000-000000000001");
});

test("deriveOnlineState: unusable rows give null", () => {
  for (const bad of [null, undefined, "row", 42, row({ board: "bad" }), row({ host_mark: "Z" }), row({ host_id: null })]) {
    assert.equal(Online.deriveOnlineState(bad, HOST), null);
  }
});

test("isLikelyExpired is a hint based on 1 hour of inactivity", () => {
  const updated = Date.parse("2026-10-16T10:00:00.000Z");
  const r = row({ updated_at: "2026-10-16T10:00:00.000Z" });
  assert.equal(Online.isLikelyExpired(r, updated + 59 * 60 * 1000), false);
  assert.equal(Online.isLikelyExpired(r, updated + 60 * 60 * 1000), false);
  assert.equal(Online.isLikelyExpired(r, updated + 61 * 60 * 1000), true);
  assert.equal(Online.isLikelyExpired(row({ updated_at: null })), false);
  assert.equal(Online.isLikelyExpired(null), false);
});

// --- Versions ---------------------------------------------------------------------

test("shouldAcceptVersion: only newer versions are accepted", () => {
  assert.equal(Online.shouldAcceptVersion(3, 4), true);
  assert.equal(Online.shouldAcceptVersion(3, 9), true, "a skipped update is still newer");
  assert.equal(Online.shouldAcceptVersion(3, 3), false, "duplicate");
  assert.equal(Online.shouldAcceptVersion(3, 2), false, "stale");
});

test("shouldAcceptVersion: with nothing on screen yet, any valid version is accepted", () => {
  assert.equal(Online.shouldAcceptVersion(null, 1), true);
  assert.equal(Online.shouldAcceptVersion(undefined, 7), true);
});

test("shouldAcceptVersion: invalid incoming versions are rejected", () => {
  for (const bad of [null, undefined, 0, -1, 2.5, "4", NaN]) {
    assert.equal(Online.shouldAcceptVersion(null, bad), false, `should reject ${String(bad)}`);
    assert.equal(Online.shouldAcceptVersion(3, bad), false, `should reject ${String(bad)}`);
  }
});

// --- Invite links -----------------------------------------------------------------

test("buildInviteUrl adds ?room=CODE to the game's address", () => {
  assert.equal(Online.buildInviteUrl("https://example.com/", "K7M2QX"), "https://example.com/?room=K7M2QX");
  assert.equal(Online.buildInviteUrl("https://example.com/games/ttt/index.html", "K7M2QX"),
    "https://example.com/games/ttt/index.html?room=K7M2QX");
});

test("buildInviteUrl normalizes the code", () => {
  assert.equal(Online.buildInviteUrl("https://example.com/", "k7m-2qx"), "https://example.com/?room=K7M2QX");
});

test("buildInviteUrl keeps other query parameters, replaces an old room and drops the #fragment", () => {
  assert.equal(Online.buildInviteUrl("https://example.com/?theme=neon#top", "K7M2QX"), "https://example.com/?theme=neon&room=K7M2QX");
  assert.equal(Online.buildInviteUrl("https://example.com/?room=AAAAAA&x=1", "K7M2QX"), "https://example.com/?room=K7M2QX&x=1");
});

test("buildInviteUrl: invalid room code or address gives null", () => {
  assert.equal(Online.buildInviteUrl("https://example.com/", "K7M2Q"), null);
  assert.equal(Online.buildInviteUrl("https://example.com/", "K7M2Q0"), null);
  assert.equal(Online.buildInviteUrl("https://example.com/", null), null);
  assert.equal(Online.buildInviteUrl("not a url", "K7M2QX"), null);
});

test("getRoomCodeFromUrl reads and normalizes ?room=", () => {
  assert.equal(Online.getRoomCodeFromUrl("https://example.com/?room=K7M2QX"), "K7M2QX");
  assert.equal(Online.getRoomCodeFromUrl("https://example.com/?room=k7m2qx"), "K7M2QX");
  assert.equal(Online.getRoomCodeFromUrl("https://example.com/?theme=neon&room=k7m-2qx#x"), "K7M2QX");
  assert.equal(Online.getRoomCodeFromUrl(new URL("https://example.com/?room=K7M2QX")), "K7M2QX");
});

test("getRoomCodeFromUrl: missing or invalid rooms give null", () => {
  for (const url of [
    "https://example.com/",
    "https://example.com/?room=",
    "https://example.com/?room=K7M2Q",
    "https://example.com/?room=K7M2QO",
    "https://example.com/?room=%3Cscript%3E",
    "https://example.com/#room=K7M2QX",
    "not a url",
    null,
  ]) {
    assert.equal(Online.getRoomCodeFromUrl(url), null, `should reject ${url}`);
  }
});

test("invite links round-trip", () => {
  const link = Online.buildInviteUrl("https://example.com/?theme=ocean", "x7m2qk");
  assert.equal(Online.getRoomCodeFromUrl(link), "X7M2QK");
});

// --- Server errors ----------------------------------------------------------------

test("every known game error is recognized from a Supabase RPC error", () => {
  const expected = [
    "ROOM_FULL", "ROOM_NOT_FOUND", "ROOM_EXPIRED", "ROOM_CLOSED", "INVALID_ROOM_CODE", "NOT_A_PLAYER",
    "WAITING_FOR_OPPONENT", "GAME_OVER", "INVALID_CELL", "CELL_TAKEN", "NOT_YOUR_TURN", "GAME_NOT_FINISHED",
    "NOT_AUTHENTICATED", "ROOM_CODE_UNAVAILABLE",
  ];
  assert.deepEqual([...Online.KNOWN_ERRORS].sort(), [...expected].sort());
  for (const code of expected) {
    const error = { code: "P0001", message: code, details: null, hint: null };
    assert.deepEqual(Online.normalizeBackendError(error), { known: true, code, message: code });
  }
});

test("unknown errors stay distinguishable from game errors", () => {
  const permission = Online.normalizeBackendError({ code: "42501", message: "permission denied for table online_games" });
  assert.equal(permission.known, false);
  assert.equal(permission.code, "UNKNOWN");
  assert.equal(permission.message, "permission denied for table online_games");

  const network = Online.normalizeBackendError(new TypeError("Failed to fetch"));
  assert.deepEqual(network, { known: false, code: "UNKNOWN", message: "Failed to fetch" });

  // Same text, but not from our functions (wrong Postgres code): not trusted.
  assert.equal(Online.normalizeBackendError({ code: "42501", message: "ROOM_FULL" }).known, false);

  // Errors without a Postgres code (e.g. thrown by our own client code).
  assert.equal(Online.normalizeBackendError(new Error("ROOM_FULL")).known, true);
  assert.equal(Online.normalizeBackendError("ROOM_FULL").known, true);
  assert.equal(Online.normalizeBackendError("Something odd").known, false);
  assert.equal(Online.normalizeBackendError({}).known, false);
});

test("no error gives null", () => {
  assert.equal(Online.normalizeBackendError(null), null);
  assert.equal(Online.normalizeBackendError(undefined), null);
});

// --- Invite links in the address bar (Phase 3C) -------------------------------------

test("getInviteFromUrl tells apart no invite, a valid invite and a broken one", () => {
  assert.deepEqual(Online.getInviteFromUrl("https://example.com/"), { status: "none" });
  assert.deepEqual(Online.getInviteFromUrl("https://example.com/?theme=neon"), { status: "none" });
  assert.deepEqual(Online.getInviteFromUrl("https://example.com/?room=k7m2qx"), { status: "valid", code: "K7M2QX" });
  assert.deepEqual(Online.getInviteFromUrl("https://example.com/?room=K7M-2QX&x=1"), { status: "valid", code: "K7M2QX" });
  for (const broken of ["https://example.com/?room=", "https://example.com/?room=K7M2Q", "https://example.com/?room=K7M2QO", "https://example.com/?room=%3Cb%3E"]) {
    assert.deepEqual(Online.getInviteFromUrl(broken), { status: "invalid" }, broken);
  }
  assert.deepEqual(Online.getInviteFromUrl("not a url"), { status: "none" });
});

test("removeRoomFromUrl drops ?room= and keeps everything else", () => {
  assert.equal(Online.removeRoomFromUrl("https://example.com/?room=K7M2QX"), "https://example.com/");
  assert.equal(Online.removeRoomFromUrl("https://example.com/app/?theme=neon&room=K7M2QX"), "https://example.com/app/?theme=neon");
  assert.equal(Online.removeRoomFromUrl("https://example.com/"), "https://example.com/");
  assert.equal(Online.removeRoomFromUrl("not a url"), null);
});

// --- Friendly error messages ------------------------------------------------------

test("each game error gets its player-facing message", () => {
  const cases = {
    ROOM_FULL: "This game already has two players.",
    ROOM_NOT_FOUND: "Game not found. Check the code and try again.",
    ROOM_EXPIRED: "This game has expired. Ask your friend to create a new one.",
    ROOM_CLOSED: "This game has been closed.",
    INVALID_ROOM_CODE: "Enter a valid 6-character room code.",
    ROOM_CODE_UNAVAILABLE: "Couldn't create a room. Try again.",
  };
  for (const [code, message] of Object.entries(cases)) {
    assert.deepEqual(Online.friendlyErrorMessage({ code: "P0001", message: code }), { code, message });
  }
});

test("sign-in problems never mention accounts or authentication", () => {
  const result = Online.friendlyErrorMessage({ code: "P0001", message: "NOT_AUTHENTICATED" });
  assert.equal(result.code, "CONNECTION");
  assert.doesNotMatch(result.message, /auth|account|login|sign/i);
});

test("connection problems say online play is unavailable", () => {
  const unavailable = [
    new Error("SUPABASE_LIBRARY_UNAVAILABLE"),
    new TypeError("Failed to fetch"),
    Object.assign(new Error("Load failed"), {}),
    Object.assign(new Error("x"), { name: "AuthRetryableFetchError", status: 0 }),
    Object.assign(new Error("Service Unavailable"), { status: 503 }),
  ];
  for (const error of unavailable) {
    assert.deepEqual(Online.friendlyErrorMessage(error), { code: "UNAVAILABLE", message: "Online play is unavailable right now. Try again." });
  }
});

test("rate limits and anything unknown get polite, non-technical messages", () => {
  assert.equal(Online.friendlyErrorMessage(Object.assign(new Error("Request rate limit reached"), { status: 429 })).code, "TOO_MANY_ATTEMPTS");
  const unknown = Online.friendlyErrorMessage({ code: "42501", message: "permission denied for function create_game" });
  assert.equal(unknown.code, "GENERIC");
  // Game errors that the lobby never expects still read politely.
  assert.equal(Online.friendlyErrorMessage({ code: "P0001", message: "NOT_YOUR_TURN" }).code, "GENERIC");
});

test("no player-facing message contains technical words", () => {
  for (const message of Object.values(Online.MESSAGES)) {
    assert.doesNotMatch(message, /P0001|42501|supabase|postgres|jwt|auth|rpc|account|login|password|email/i, message);
  }
});

// --- Lobby view -------------------------------------------------------------------------

test("lobby while joining from a link", () => {
  const view = Online.getLobbyView(null);
  assert.equal(view.phase, "joining");
  assert.equal(view.status, "Joining game…");
  assert.equal(view.showInvite, false);
  assert.equal(view.leaveLabel, "Cancel");
  assert.equal(view.confirmLeave, false);
});

test("host waiting alone sees the invite and can cancel without confirming", () => {
  const view = Online.getLobbyView(Online.deriveOnlineState(row({ guest_id: null, version: 1 }), HOST));
  assert.equal(view.phase, "waiting");
  assert.equal(view.status, "Waiting for opponent…");
  assert.equal(view.showCode, true);
  assert.equal(view.showInvite, true);
  assert.equal(view.badge, "You are X");
  assert.equal(view.leaveLabel, "Cancel");
  assert.equal(view.confirmLeave, false);
});

test("match ready, from both sides", () => {
  const host = Online.getLobbyView(Online.deriveOnlineState(row(), HOST));
  const guest = Online.getLobbyView(Online.deriveOnlineState(row(), GUEST));
  for (const view of [host, guest]) {
    assert.equal(view.phase, "ready");
    assert.equal(view.status, "Match ready");
    assert.equal(view.showInvite, false, "the room is full, no more invites");
    assert.equal(view.leaveLabel, "Leave Match");
    assert.equal(view.confirmLeave, true, "leaving closes the room for the friend");
  }
  assert.equal(host.badge, "You are X");
  assert.match(host.note, /Your friend joined\. You are X and go first\./);
  assert.equal(guest.badge, "You are O");
  assert.match(guest.note, /You joined your friend's game\. You are O\. Your friend goes first\./);
});

test("after a rematch swap the lobby describes the new marks", () => {
  const view = Online.getLobbyView(Online.deriveOnlineState(row({ host_mark: "O" }), GUEST));
  assert.equal(view.badge, "You are X");
  assert.match(view.note, /You are X and go first/);
});

test("closed rooms explain who left and offer only Back", () => {
  const byGuest = row({ left_by: GUEST });
  assert.equal(Online.getLobbyView(Online.deriveOnlineState(byGuest, HOST)).status, "Your friend left the game.");
  assert.equal(Online.getLobbyView(Online.deriveOnlineState(byGuest, GUEST)).status, "You left this game.");
  const view = Online.getLobbyView(Online.deriveOnlineState(byGuest, HOST));
  assert.equal(view.phase, "closed");
  assert.equal(view.showInvite, false);
  assert.equal(view.leaveLabel, "Back");
  assert.equal(view.confirmLeave, false);
  // A waiting room the host cancelled.
  assert.equal(Online.getLobbyView(Online.deriveOnlineState(row({ guest_id: null, left_by: HOST }), HOST)).phase, "closed");
});

test("someone who is not in the room never sees a usable lobby", () => {
  assert.equal(Online.getLobbyView(Online.deriveOnlineState(row(), STRANGER)).phase, "closed");
});

test("spellRoomCode spells the code out for screen readers", () => {
  assert.equal(Online.spellRoomCode("K7M2QX"), "K 7 M 2 Q X");
  assert.equal(Online.spellRoomCode(null), "");
});

// --- Online board (Phase 3D) ------------------------------------------------------------

const boardView = (overrides, who, options) => Online.getOnlineBoardView(Online.deriveOnlineState(row(overrides), who), options);

test("online status: your turn / opponent's turn, and only the player to move may click", () => {
  const host = boardView({}, HOST);
  const guest = boardView({}, GUEST);
  assert.equal(host.status, "Your turn");
  assert.equal(host.interactive, true);
  assert.equal(guest.status, "Opponent's turn");
  assert.equal(guest.interactive, false);
  assert.equal(host.title, "Online Match");
  assert.equal(host.badge, "You are X");
  assert.equal(guest.badge, "You are O");
  assert.equal(host.resultMark, null);
  assert.equal(host.primary, null, "no Rematch during a game");
  assert.deepEqual(host.leave, { label: "Leave Match", confirm: true });
});

test("online board stays locked while our own move is on its way", () => {
  assert.equal(boardView({}, HOST, { pending: true }).interactive, false);
});

test("online results from each side, coloured by the winning mark", () => {
  const won = { board: "XXXOO....", host_wins: 1 };
  assert.equal(boardView(won, HOST).status, "You win!");
  assert.equal(boardView(won, GUEST).status, "Opponent wins.");
  assert.equal(boardView(won, HOST).resultMark, "x");
  assert.equal(boardView(won, HOST).interactive, false);
  const drawn = { board: "XOXXOOOXX", draws: 1 };
  assert.equal(boardView(drawn, GUEST).status, "It's a draw!");
  assert.equal(boardView(drawn, GUEST).resultMark, "draw");
  // After a mark swap, O can win and the colour follows the mark.
  assert.equal(boardView({ host_mark: "O", board: "OOOXX.X..", guest_wins: 0, host_wins: 1 }, HOST).resultMark, "o");
});

test("online scoreboard is You / Draws / Opponent from the server's per-person counts", () => {
  const scored = { host_mark: "O", host_wins: 2, guest_wins: 5, draws: 3 };
  assert.deepEqual(boardView(scored, HOST).scores, { you: 2, draws: 3, opponent: 5 });
  assert.deepEqual(boardView(scored, GUEST).scores, { you: 5, draws: 3, opponent: 2 });
});

test("rematch button: Rematch -> waiting -> Accept Rematch", () => {
  const finished = { board: "XXXOO....", host_wins: 1 };
  assert.deepEqual(boardView(finished, HOST).primary, { label: "Rematch", disabled: false });
  const asked = { ...finished, rematch_requested_by: HOST };
  assert.deepEqual(boardView(asked, HOST).primary, { label: "Waiting for opponent…", disabled: true });
  assert.equal(boardView(asked, HOST).note, "Rematch requested. Waiting for your friend.");
  assert.deepEqual(boardView(asked, GUEST).primary, { label: "Accept Rematch", disabled: false });
  assert.equal(boardView(asked, GUEST).note, "Opponent wants a rematch.");
});

test("closed match: no moves, no rematch, only Back", () => {
  const closed = boardView({ board: "X........", left_by: GUEST }, HOST);
  assert.equal(closed.status, "Match closed.");
  assert.equal(closed.note, "Your friend left the game.");
  assert.equal(closed.interactive, false);
  assert.equal(closed.primary, null);
  assert.deepEqual(closed.leave, { label: "Back", confirm: false });
  assert.equal(closed.badge, null);
  assert.equal(boardView({ left_by: GUEST }, GUEST).note, "You left this game.");
});

test("a stranger never gets an interactive online board", () => {
  const view = boardView({}, STRANGER);
  assert.equal(view.interactive, false);
  assert.equal(view.status, "Match closed.");
});

test("lobby offers Start Match for a fresh game and Resume Match for one under way", () => {
  const lobby = (overrides, who = HOST) => Online.getLobbyView(Online.deriveOnlineState(row(overrides), who));
  assert.equal(lobby({}).startLabel, "Start Match");
  assert.equal(lobby({ board: "X........", version: 3 }).startLabel, "Resume Match");
  assert.equal(lobby({ board: "XXXOO....", host_wins: 1 }).startLabel, "Resume Match");
  assert.equal(lobby({ guest_id: null }).startLabel, undefined, "no Start while waiting");
});

// --- Announcements --------------------------------------------------------------------

const derive = (overrides, who) => Online.deriveOnlineState(row(overrides), who);

test("announce the opponent's move and whose turn it is", () => {
  const prev = derive({ board: ".........", version: 2 }, GUEST);
  const next = derive({ board: "X........", version: 3 }, GUEST);
  assert.equal(Online.describeOnlineChange(prev, next), "Opponent played Row 1, column 1. Your turn.");
});

test("announce our own confirmed move", () => {
  const prev = derive({ board: "X........", version: 3 }, GUEST);
  const next = derive({ board: "X...O....", version: 4 }, GUEST);
  assert.equal(Online.describeOnlineChange(prev, next), "You played Row 2, column 2. Opponent's turn.");
});

test("announce a win, a loss and a draw", () => {
  const before = derive({ board: "XX.OO....", version: 6 }, HOST);
  assert.equal(Online.describeOnlineChange(before, derive({ board: "XXXOO....", version: 7 }, HOST)), "You played Row 1, column 3. You win!");
  const beforeG = derive({ board: "XX.OO....", version: 6 }, GUEST);
  assert.equal(Online.describeOnlineChange(beforeG, derive({ board: "XXXOO....", version: 7 }, GUEST)), "Opponent played Row 1, column 3. Opponent wins.");
  const almost = derive({ board: "XOXXOOOX.", version: 9 }, HOST);
  assert.equal(Online.describeOnlineChange(almost, derive({ board: "XOXXOOOXX", version: 10 }, HOST)), "You played Row 3, column 3. It's a draw!");
});

test("announce rematch requests and the new round with swapped marks", () => {
  const done = derive({ board: "XXXOO....", version: 7 }, GUEST);
  const asked = derive({ board: "XXXOO....", version: 8, rematch_requested_by: HOST }, GUEST);
  assert.equal(Online.describeOnlineChange(done, asked), "Opponent wants a rematch.");
  const restarted = derive({ board: ".........", version: 9, host_mark: "O" }, GUEST);
  assert.equal(Online.describeOnlineChange(asked, restarted), "New game. You are X and go first.");
  const hostView = Online.describeOnlineChange(derive({ board: "XXXOO....", version: 8, rematch_requested_by: HOST }, HOST),
    derive({ board: ".........", version: 9, host_mark: "O" }, HOST));
  assert.equal(hostView, "New game. You are O. Opponent goes first.");
});

test("announce the friend leaving, but not our own leaving", () => {
  const playing = derive({ board: "X........" }, HOST);
  assert.equal(Online.describeOnlineChange(playing, derive({ board: "X........", left_by: GUEST }, HOST)), "Your friend left the game.");
  assert.equal(Online.describeOnlineChange(playing, derive({ board: "X........", left_by: HOST }, HOST)), "");
});

test("several missed moves at once are summarised; nothing new means nothing to say", () => {
  const prev = derive({ board: "X........" }, GUEST);
  assert.equal(Online.describeOnlineChange(prev, derive({ board: "XO.X.....", version: 5 }, GUEST)), "The board was updated. Your turn.");
  assert.equal(Online.describeOnlineChange(prev, prev), "");
  assert.equal(Online.describeOnlineChange(null, prev), "");
});

// --- Connection awareness (Phase 3E) -------------------------------------------------

test("presence: a friend who disappears gets a grace period before 'disconnected'", () => {
  assert.deepEqual(Online.presenceTransition("present", false), { next: "away", startGrace: true, cancelGrace: false, returned: false });
  assert.deepEqual(Online.presenceTransition("unknown", false), { next: "away", startGrace: true, cancelGrace: false, returned: false });
  // Still missing: nothing new (the timer that is already running decides).
  assert.deepEqual(Online.presenceTransition("away", false), { next: "away", startGrace: false, cancelGrace: false, returned: false });
  assert.deepEqual(Online.presenceTransition("disconnected", false), { next: "disconnected", startGrace: false, cancelGrace: false, returned: false });
});

test("presence: back within the grace period is silent; back after it is announced", () => {
  assert.deepEqual(Online.presenceTransition("away", true), { next: "present", startGrace: false, cancelGrace: true, returned: false });
  assert.deepEqual(Online.presenceTransition("disconnected", true), { next: "present", startGrace: false, cancelGrace: true, returned: true });
  assert.deepEqual(Online.presenceTransition("unknown", true), { next: "present", startGrace: false, cancelGrace: false, returned: false });
  assert.deepEqual(Online.presenceTransition("present", true), { next: "present", startGrace: false, cancelGrace: false, returned: false });
});

test("own connection down: board locked, 'Reconnecting…' instead of a misleading turn", () => {
  const view = boardView({}, HOST, { connection: "reconnecting" });
  assert.equal(view.status, "Reconnecting…");
  assert.equal(view.interactive, false, "never a playable board while disconnected");
  assert.equal(boardView({}, HOST, { connection: "connecting" }).status, "Connecting…");
  assert.equal(boardView({}, HOST, { connection: "connecting" }).interactive, false);
  assert.equal(boardView({}, HOST, { connection: "connected" }).interactive, true);
});

test("own connection down after a result: the result stays, rematch waits", () => {
  const view = boardView({ board: "XXXOO....", host_wins: 1 }, HOST, { connection: "reconnecting" });
  assert.equal(view.status, "You win!", "the result is not replaced");
  assert.equal(view.note, "Reconnecting…");
  assert.equal(view.primary.disabled, true, "no rematch request while disconnected");
});

test("friend disconnected / back only changes the note; turn and result stay", () => {
  const playing = boardView({}, HOST, { opponent: "disconnected" });
  assert.equal(playing.status, "Your turn");
  assert.equal(playing.interactive, true, "the room is still open; the server decides");
  assert.equal(playing.note, "Opponent disconnected. Waiting for them to return…");
  assert.equal(boardView({}, HOST, { opponent: "back" }).note, "Opponent is back.");
  const finished = boardView({ board: "XXXOO....", host_wins: 1 }, GUEST, { opponent: "disconnected" });
  assert.equal(finished.status, "Opponent wins.");
  assert.equal(finished.note, "Opponent disconnected. Waiting for them to return…");
  // "away" (inside the grace period) shows nothing.
  assert.equal(boardView({}, HOST, { opponent: "away" }).note, "");
});

test("closed rooms ignore presence and connection messages", () => {
  const view = boardView({ left_by: GUEST }, HOST, { opponent: "disconnected", connection: "reconnecting" });
  assert.equal(view.status, "Match closed.");
  assert.equal(view.note, "Your friend left the game.");
});

test("expired room: clear message and only Back", () => {
  const view = boardView({ board: "X........" }, HOST, { expired: true });
  assert.equal(view.status, "This game has expired.");
  assert.equal(view.note, "Start a new game.");
  assert.equal(view.interactive, false);
  assert.equal(view.primary, null);
  assert.deepEqual(view.leave, { label: "Back", confirm: false });
});

test("session ended: clear message without technical words, and only Back", () => {
  const view = boardView({ board: "X........" }, HOST, { sessionEnded: true });
  assert.equal(view.status, "Your online session ended.");
  assert.equal(view.note, "Return to Online and rejoin the game.");
  assert.equal(view.interactive, false);
  assert.deepEqual(view.leave, { label: "Back", confirm: false });
  assert.doesNotMatch(view.status + view.note, /auth|token|jwt|account|login|supabase/i);
});

test("isSessionFailure recognises a lost identity, not ordinary errors", () => {
  assert.equal(Online.isSessionFailure({ code: "42501", message: "permission denied for function make_move" }), true);
  assert.equal(Online.isSessionFailure({ code: "42501", message: "permission denied for table online_games" }), true);
  assert.equal(Online.isSessionFailure({ code: "PGRST301", message: "JWT expired" }), true);
  assert.equal(Online.isSessionFailure(Object.assign(new Error("Unauthorized"), { status: 401 })), true);
  assert.equal(Online.isSessionFailure({ code: "P0001", message: "NOT_AUTHENTICATED" }), true);
  for (const other of [{ code: "P0001", message: "NOT_YOUR_TURN" }, new TypeError("Failed to fetch"), null, undefined, "x"]) {
    assert.equal(Online.isSessionFailure(other), false);
  }
});

test("lobby connection note", () => {
  const note = (o) => Online.lobbyConnectionNote(o);
  assert.equal(note({ phase: "ready", connection: "reconnecting" }), "Reconnecting…");
  assert.equal(note({ phase: "waiting", connection: "reconnecting" }), "Reconnecting…");
  assert.equal(note({ phase: "waiting", likelyExpired: true }), "This invite has probably expired. Start a new game.");
  assert.equal(note({ phase: "ready", opponent: "disconnected" }), "Opponent disconnected. Waiting for them to return…");
  assert.equal(note({ phase: "ready", opponent: "back" }), "Opponent is back.");
  assert.equal(note({ phase: "ready", opponent: "away" }), null);
  assert.equal(note({ phase: "waiting", opponent: "disconnected" }), null, "no friend yet to be disconnected");
  assert.equal(note({ phase: "closed", connection: "reconnecting" }), null);
  assert.equal(note({ phase: "joining", connection: "reconnecting" }), null);
});
