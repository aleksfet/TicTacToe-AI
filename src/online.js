// Tic Tac Toe AI - online multiplayer helpers (pure)
//
// Small helpers the online screens will use. Like src/game.js, nothing here
// touches the page or the network, so it all runs in Node for the tests.
//
// IMPORTANT: these helpers only describe the game for DISPLAY. The server is
// the referee: the make_move / join_game / ... database functions decide what
// is legal. Nothing here should ever be used to decide whether a move is
// allowed - the browser just shows what the server says.
//
// The server stores a room as one row of public.online_games (see
// supabase/migrations/). Its board is a 9-character string such as "X.O......"
// ("." = empty); src/game.js uses an array of "", "X", "O".
//
// In the browser this file defines the global TicTacToeOnline object (and
// needs game.js loaded first). In Node it is loaded with require("./online.js").

const TicTacToeOnline = ((Game) => {
  // --- Room codes ---------------------------------------------------------

  // Same alphabet as the database: no 0/O or 1/I/L, so codes are easy to read
  // out loud and type.
  const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const ROOM_CODE_LENGTH = 6;
  const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

  // Tidy up what a person typed or pasted: drop spaces and dashes and use
  // capitals ("k7m-2qx " -> "K7M2QX"). This matches what join_game() does on
  // the server. Anything that is not text becomes "".
  function normalizeRoomCode(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/[\s-]/g, "").toUpperCase();
  }

  // True only for a code already in its tidy form: exactly 6 characters from
  // the alphabet above. (Run normalizeRoomCode first on user input.)
  function isValidRoomCode(value) {
    return typeof value === "string" && ROOM_CODE_PATTERN.test(value);
  }

  // --- Boards ---------------------------------------------------------------

  // "X.O......" -> ["X", "", "O", "", "", "", "", "", ""], or null if the
  // text is not a valid 9-square board.
  function boardFromServer(boardString) {
    if (typeof boardString !== "string" || !/^[XO.]{9}$/.test(boardString)) {
      return null;
    }
    return boardString.split("").map((c) => (c === "." ? "" : c));
  }

  // ["X", "", "O", ...] -> "X.O......", or null if it is not a valid board.
  function boardToServer(board) {
    if (!Array.isArray(board) || board.length !== 9 || !board.every((v) => v === "" || v === "X" || v === "O")) {
      return null;
    }
    return board.map((v) => v || ".").join("");
  }

  // --- Reading a game row ---------------------------------------------------

  function otherMark(mark) {
    return mark === "X" ? "O" : "X";
  }

  // Turn a game row from the server into everything the screen needs, seen
  // from one player's side ("me" = myUserId). Returns null if the row is not
  // a usable game row.
  //
  // status is one of:
  //   "closed"    someone left the room (nothing more can happen)
  //   "waiting"   no opponent has joined yet
  //   "finished"  this round is over (win or draw); a rematch may follow
  //   "playing"   the round is in progress
  function deriveOnlineState(row, myUserId) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const board = boardFromServer(row.board);
    if (!board || (row.host_mark !== "X" && row.host_mark !== "O") || !row.host_id) {
      return null;
    }

    const me = typeof myUserId === "string" && myUserId !== "" ? myUserId : null;
    const amHost = me !== null && row.host_id === me;
    const amGuest = me !== null && !amHost && row.guest_id === me;
    const amPlayer = amHost || amGuest;

    const hostMark = row.host_mark;
    const guestMark = otherMark(hostMark);
    const myMark = amHost ? hostMark : amGuest ? guestMark : null;
    const opponentMark = myMark ? otherMark(myMark) : null;

    const winner = Game.getWinner(board);
    const winningLine = Game.findWinningLine(board);
    const draw = winner === null && Game.isBoardFull(board);
    const xCount = board.filter((v) => v === "X").length;
    const oCount = board.filter((v) => v === "O").length;
    const turn = xCount === oCount ? "X" : "O"; // X always starts

    const waitingForOpponent = !row.guest_id;
    const closed = Boolean(row.left_by);

    let status = "playing";
    if (closed) {
      status = "closed";
    } else if (waitingForOpponent) {
      status = "waiting";
    } else if (winner !== null || draw) {
      status = "finished";
    }

    let result = null; // from my side: "win", "loss" or "draw"
    if (amPlayer && winner !== null) {
      result = winner === myMark ? "win" : "loss";
    } else if (amPlayer && draw) {
      result = "draw";
    }

    let leftBy = null; // "me", "opponent", or null
    if (closed && amPlayer) {
      leftBy = row.left_by === me ? "me" : "opponent";
    }

    let rematch = null; // "me", "opponent", or null: who has asked
    if (row.rematch_requested_by && amPlayer) {
      rematch = row.rematch_requested_by === me ? "me" : "opponent";
    }

    return {
      roomCode: row.room_code || null,
      gameId: row.id || null,
      version: Number.isInteger(row.version) ? row.version : null,

      amHost,
      amGuest,
      amPlayer,
      myMark,
      opponentMark,

      board,
      turn,
      isMyTurn: status === "playing" && amPlayer && turn === myMark,
      winner,
      winningLine,
      draw,
      result,

      status,
      waitingForOpponent,
      closed,
      leftBy,
      rematch,

      // Scores are kept per person (marks swap on every rematch).
      myWins: amHost ? row.host_wins : amGuest ? row.guest_wins : null,
      opponentWins: amHost ? row.guest_wins : amGuest ? row.host_wins : null,
      draws: amPlayer ? row.draws : null,

      updatedAt: row.updated_at || null,
    };
  }

  // A room expires after 1 hour without activity. This is only a hint for
  // the screen (e.g. to suggest starting a new game); the server decides.
  const ROOM_LIFETIME_MS = 60 * 60 * 1000;

  function isLikelyExpired(row, nowMs = Date.now()) {
    const updated = row && row.updated_at ? Date.parse(row.updated_at) : NaN;
    return Number.isFinite(updated) && nowMs - updated > ROOM_LIFETIME_MS;
  }

  // --- Ordering updates -----------------------------------------------------

  // Every change on the server raises the room's version by one. Updates can
  // arrive twice or out of order (e.g. a live update and a reply to our own
  // request), so only ever move forward: accept a row only if its version is
  // newer than the one on screen. With nothing on screen yet, accept any
  // valid version.
  function shouldAcceptVersion(currentVersion, incomingVersion) {
    if (!Number.isInteger(incomingVersion) || incomingVersion < 1) {
      return false;
    }
    if (currentVersion === null || currentVersion === undefined) {
      return true;
    }
    return incomingVersion > currentVersion;
  }

  // --- Invite links -----------------------------------------------------------

  // The invite link is the game's own address with ?room=CODE added, e.g.
  // https://example.com/?room=K7M2QX. Other query parameters are kept and any
  // #fragment is dropped. Returns null for a bad address or room code.
  function buildInviteUrl(baseUrl, roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) {
      return null;
    }
    let url;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      return null;
    }
    url.searchParams.set("room", code);
    url.hash = "";
    return url.toString();
  }

  // Read the room code from an address such as https://example.com/?room=k7m2qx.
  // Returns the tidy code ("K7M2QX"), or null if there is none or it is invalid.
  function getRoomCodeFromUrl(urlLike) {
    let url;
    try {
      url = new URL(String(urlLike));
    } catch (error) {
      return null;
    }
    const code = normalizeRoomCode(url.searchParams.get("room"));
    return isValidRoomCode(code) ? code : null;
  }

  // Look at the page address for an invite. Returns:
  //   { status: "none" }                   no ?room= at all
  //   { status: "valid", code: "K7M2QX" }  a usable invite
  //   { status: "invalid" }                ?room= is there but is not a code
  // (Kept separate from getRoomCodeFromUrl so a broken link can be explained
  // to the player instead of silently ignored.)
  function getInviteFromUrl(urlLike) {
    let url;
    try {
      url = new URL(String(urlLike));
    } catch (error) {
      return { status: "none" };
    }
    if (!url.searchParams.has("room")) {
      return { status: "none" };
    }
    const code = normalizeRoomCode(url.searchParams.get("room"));
    return isValidRoomCode(code) ? { status: "valid", code } : { status: "invalid" };
  }

  // The same address without ?room= (used when leaving a room, so a refresh
  // does not try to rejoin it). Other parameters and the path are kept.
  function removeRoomFromUrl(urlLike) {
    let url;
    try {
      url = new URL(String(urlLike));
    } catch (error) {
      return null;
    }
    url.searchParams.delete("room");
    return url.toString();
  }

  // --- Server errors ----------------------------------------------------------

  // The database functions report problems with these short codes. They
  // arrive from Supabase as { code: "P0001", message: "ROOM_FULL", ... }.
  const KNOWN_ERRORS = Object.freeze([
    "NOT_AUTHENTICATED",
    "INVALID_ROOM_CODE",
    "ROOM_NOT_FOUND",
    "ROOM_EXPIRED",
    "ROOM_CLOSED",
    "ROOM_FULL",
    "ROOM_CODE_UNAVAILABLE",
    "NOT_A_PLAYER",
    "WAITING_FOR_OPPONENT",
    "GAME_OVER",
    "INVALID_CELL",
    "CELL_TAKEN",
    "NOT_YOUR_TURN",
    "GAME_NOT_FINISHED",
  ]);

  // Turn any error into { known, code, message }:
  //   - known: true and code = "ROOM_FULL" etc. for one of our game errors;
  //   - known: false and code = "UNKNOWN" for anything else (network
  //     trouble, permission errors, bugs), keeping the original message so it
  //     can be logged.
  // A game error must come from our functions (Postgres code P0001, the code
  // RAISE EXCEPTION uses), so an unrelated error that merely happens to have
  // the same text is not mistaken for one.
  function normalizeBackendError(error) {
    if (error === null || error === undefined) {
      return null;
    }
    const message = typeof error === "string" ? error : error && typeof error.message === "string" ? error.message : "";
    const pgCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const fromOurFunctions = pgCode === undefined || pgCode === "P0001";
    if (fromOurFunctions && KNOWN_ERRORS.includes(message)) {
      return { known: true, code: message, message };
    }
    return { known: false, code: "UNKNOWN", message: message || String(error) };
  }

  // --- Friendly messages ------------------------------------------------------

  // What the player reads. No technical words (no codes, no product names).
  const MESSAGES = Object.freeze({
    ROOM_FULL: "This game already has two players.",
    ROOM_NOT_FOUND: "Game not found. Check the code and try again.",
    ROOM_EXPIRED: "This game has expired. Ask your friend to create a new one.",
    ROOM_CLOSED: "This game has been closed.",
    INVALID_ROOM_CODE: "Enter a valid 6-character room code.",
    ROOM_CODE_UNAVAILABLE: "Couldn't create a room. Try again.",
    INVALID_INVITE: "That invite link isn't valid.",
    CONNECTION: "Couldn't connect to online play. Try again.",
    UNAVAILABLE: "Online play is unavailable right now. Try again.",
    TOO_MANY_ATTEMPTS: "Too many attempts right now. Wait a minute and try again.",
    GENERIC: "Something went wrong. Please try again.",
    // Connection and match-health messages (Phase 3E).
    RECONNECTING: "Reconnecting…",
    CONNECTING: "Connecting…",
    CONNECTION_RESTORED: "Connection restored.",
    NETWORK_ACTION: "Couldn't reach the game. Reconnecting…",
    OPPONENT_DISCONNECTED: "Opponent disconnected. Waiting for them to return…",
    OPPONENT_BACK: "Opponent is back.",
    SESSION_ENDED: "Your online session ended.",
    SESSION_ENDED_HINT: "Return to Online and rejoin the game.",
    SESSION_SEAT_TAKEN: "Your online session ended, so this browser can't take its old seat back. Ask your friend to create a new game.",
    GAME_EXPIRED: "This game has expired.",
    GAME_EXPIRED_HINT: "Start a new game.",
    INVITE_PROBABLY_EXPIRED: "This invite has probably expired. Start a new game.",
  });

  // Signs that the problem is the connection rather than the game: the online
  // library could not load, the network failed, or the service is down.
  function looksUnavailable(error) {
    if (!error) {
      return false;
    }
    const message = typeof error === "string" ? error : String(error.message || "");
    const status = typeof error === "object" ? error.status : undefined;
    return (
      message === "SUPABASE_LIBRARY_UNAVAILABLE" ||
      /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message) ||
      (typeof error === "object" && error.name === "AuthRetryableFetchError") ||
      status === 0 ||
      (Number.isInteger(status) && status >= 500)
    );
  }

  // Turn any error from the online code into { code, message } for the player.
  // code is our own short name (ROOM_FULL, UNAVAILABLE, ...); message is safe
  // to show as-is.
  function friendlyErrorMessage(error) {
    const normalized = normalizeBackendError(error);
    if (normalized && normalized.known) {
      if (normalized.code === "NOT_AUTHENTICATED") {
        return { code: "CONNECTION", message: MESSAGES.CONNECTION };
      }
      if (MESSAGES[normalized.code]) {
        return { code: normalized.code, message: MESSAGES[normalized.code] };
      }
      return { code: "GENERIC", message: MESSAGES.GENERIC };
    }
    if (looksUnavailable(error)) {
      return { code: "UNAVAILABLE", message: MESSAGES.UNAVAILABLE };
    }
    if (error && typeof error === "object" && error.status === 429) {
      return { code: "TOO_MANY_ATTEMPTS", message: MESSAGES.TOO_MANY_ATTEMPTS };
    }
    return { code: "GENERIC", message: MESSAGES.GENERIC };
  }

  // --- The online lobby ---------------------------------------------------------

  // What the lobby screen shows for a room, seen from one player's side.
  // state is deriveOnlineState(row, me), or null while we are still joining.
  // Returns { phase, status, note, badge, showCode, showInvite, leaveLabel,
  // confirmLeave }:
  //   phase       "joining" | "waiting" | "ready" | "closed"
  //   showInvite  show the invite link / copy / share controls
  //   leaveLabel  text of the button that leaves the lobby
  //   confirmLeave ask "are you sure?" first (leaving closes the room for
  //               the friend too)
  function getLobbyView(state) {
    if (!state) {
      return {
        phase: "joining", status: "Joining game…", note: "", badge: null,
        showCode: true, showInvite: false, leaveLabel: "Cancel", confirmLeave: false,
      };
    }
    if (state.status === "closed" || !state.amPlayer) {
      let status = MESSAGES.ROOM_CLOSED;
      if (state.leftBy === "opponent") {
        status = "Your friend left the game.";
      } else if (state.leftBy === "me") {
        status = "You left this game.";
      }
      return {
        phase: "closed", status, note: "", badge: null,
        showCode: false, showInvite: false, leaveLabel: "Back", confirmLeave: false,
      };
    }
    const badge = state.myMark ? `You are ${state.myMark}` : null;
    if (state.status === "waiting") {
      return {
        phase: "waiting", status: "Waiting for opponent…",
        note: "Send the invite link or room code to a friend.", badge,
        showCode: true, showInvite: true, leaveLabel: "Cancel", confirmLeave: false,
      };
    }
    // Both players are in the room ("playing" or "finished"). The screen
    // moves on to the board straight away (see shouldShowOnlineBoard), so
    // this is only ever on screen for a moment.
    return {
      phase: "ready", status: "Match ready", note: matchEntryMessage(state), badge,
      showCode: true, showInvite: false, leaveLabel: "Leave Match", confirmLeave: true,
    };
  }

  // Should this player be on the online board? Yes as soon as the server's
  // row has both players in an open room that this player belongs to - no
  // Start button, no countdown. A host waiting alone stays in the lobby.
  // (Presence plays no part: only the row decides.)
  function shouldShowOnlineBoard(state) {
    return Boolean(
      state && state.amPlayer && !state.closed && !state.waitingForOpponent &&
        (state.status === "playing" || state.status === "finished"),
    );
  }

  // What to tell the player when the board opens on its own: who joined and
  // who goes first for a fresh game, or where things stand for a game that
  // is already under way (e.g. after a refresh).
  function matchEntryMessage(state) {
    const underway = state.board.some((v) => v !== "") || state.status === "finished" || state.rematch !== null;
    if (underway) {
      const text = onlineStatusText(state);
      return `Match resumed. You are ${state.myMark}. ${state.status === "finished" ? text : text + "."}`;
    }
    const who = state.amHost ? "Your friend joined." : "You joined your friend's game.";
    const first = state.myMark === "X" ? "You are X and go first." : "You are O. Your friend goes first.";
    return `${who} ${first}`;
  }

  // --- The online board -----------------------------------------------------------

  // "Row 2, column 3" for square 5 (same wording as the local board).
  function squareName(index) {
    return `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}`;
  }

  // The online status line for a state (no trailing full stop on turns, like
  // the local game's "Your turn").
  function onlineStatusText(state) {
    if (!state || state.status === "closed" || !state.amPlayer) {
      return "Match closed.";
    }
    if (state.status === "finished") {
      if (state.result === "win") return "You win!";
      if (state.result === "loss") return "Opponent wins.";
      return "It's a draw!";
    }
    if (state.status === "waiting") {
      return "Waiting for opponent…";
    }
    return state.isMyTurn ? "Your turn" : "Opponent's turn";
  }

  // --- Connection awareness (Phase 3E) ---------------------------------------------
  //
  // None of this decides anything about the game: who the players are, whose
  // turn it is and whether the room is open all come from the server's row.
  // It only changes what the screen says and whether it accepts clicks.

  // The opponent's presence, as seen through the live connection:
  //   "unknown"       not heard yet
  //   "present"       connected
  //   "away"          just disappeared; in the grace period (maybe a refresh)
  //   "disconnected"  gone for longer than the grace period
  // presenceTransition(current, isPresent) says what changes when presence
  // is (re)reported, so the screen only reacts to real changes.
  //   startGrace  start the grace timer (the opponent just disappeared)
  //   cancelGrace stop it (they came back in time)
  //   returned    they came back after being shown as disconnected
  function presenceTransition(current, isPresent) {
    if (isPresent) {
      return {
        next: "present",
        startGrace: false,
        cancelGrace: current === "away" || current === "disconnected",
        returned: current === "disconnected",
      };
    }
    if (current === "present" || current === "unknown") {
      return { next: "away", startGrace: true, cancelGrace: false, returned: false };
    }
    return { next: current, startGrace: false, cancelGrace: false, returned: false };
  }

  // Is this error the browser's online identity no longer being accepted
  // (e.g. it was signed out or expired)? Then the player has to rejoin.
  function isSessionFailure(error) {
    if (!error || typeof error !== "object") {
      return false;
    }
    const message = typeof error.message === "string" ? error.message : "";
    const code = typeof error.code === "string" ? error.code : "";
    return (
      error.status === 401 ||
      /^PGRST30\d$/.test(code) ||
      (code === "P0001" && message === "NOT_AUTHENTICATED") ||
      // Without a valid identity the request runs with browser-only rights,
      // which may not call the game functions or read rooms at all.
      (code === "42501" && /permission denied for (function|table)/i.test(message))
    );
  }

  // Everything the game screen shows during an online match, from one
  // player's side.
  //   options.pending       our own move is on its way to the server (the
  //                         board stays locked until the server answers)
  //   options.connection    "connected" | "connecting" | "reconnecting"
  //   options.opponent      "unknown" | "present" | "away" | "disconnected"
  //                         | "back" (just returned; shown briefly)
  //   options.expired       the server said the room expired
  //   options.sessionEnded  this browser's online identity stopped working
  // Returns:
  //   interactive  may this player pick a square right now?
  //   resultMark   "x" / "o" / "draw" to colour the result line, or null
  //   primary      the main button: { label, disabled } or null
  //   leave        { label, confirm }: confirm = ask first (closes the room)
  // Scores are per person (You / Opponent), never per mark: marks swap.
  function getOnlineBoardView(state, options = {}) {
    const view = baseOnlineBoardView(state, options);
    const { connection = "connected", opponent = "present", expired = false, sessionEnded = false } = options;

    // The room can no longer be played from this browser: only Back.
    if (sessionEnded || expired) {
      return {
        ...view,
        badge: null,
        status: sessionEnded ? MESSAGES.SESSION_ENDED : MESSAGES.GAME_EXPIRED,
        resultMark: null,
        note: sessionEnded ? MESSAGES.SESSION_ENDED_HINT : MESSAGES.GAME_EXPIRED_HINT,
        interactive: false,
        primary: null,
        leave: { label: "Back", confirm: false },
      };
    }
    const closed = !state || state.status === "closed" || !state.amPlayer;
    if (closed) {
      return view;
    }

    // Our own connection is down: never offer a playable board.
    if (connection !== "connected") {
      const text = connection === "connecting" ? MESSAGES.CONNECTING : MESSAGES.RECONNECTING;
      const finished = state.status === "finished";
      return {
        ...view,
        // A finished game keeps its result on screen; otherwise the turn
        // line would be misleading while the board is locked.
        status: finished ? view.status : text,
        note: finished ? text : "",
        interactive: false,
        primary: view.primary ? { ...view.primary, disabled: true } : null,
      };
    }

    // The opponent's connection only changes the message, not the game.
    if (state.status === "playing" || state.status === "finished") {
      if (opponent === "disconnected") {
        return { ...view, note: MESSAGES.OPPONENT_DISCONNECTED };
      }
      if (opponent === "back") {
        return { ...view, note: MESSAGES.OPPONENT_BACK };
      }
    }
    return view;
  }

  // The lobby's extra line about the connection, or null to keep its normal
  // note. likelyExpired is the display-only hint for a host who has waited a
  // long time (the server still decides; see isLikelyExpired).
  function lobbyConnectionNote({ phase, connection = "connected", opponent = "present", likelyExpired = false }) {
    if (phase === "closed" || phase === "joining") {
      return null;
    }
    if (connection === "reconnecting") {
      return MESSAGES.RECONNECTING;
    }
    if (phase === "waiting" && likelyExpired) {
      return MESSAGES.INVITE_PROBABLY_EXPIRED;
    }
    if (phase === "ready" && opponent === "disconnected") {
      return MESSAGES.OPPONENT_DISCONNECTED;
    }
    if (phase === "ready" && opponent === "back") {
      return MESSAGES.OPPONENT_BACK;
    }
    return null;
  }

  function baseOnlineBoardView(state, { pending = false } = {}) {
    const closed = !state || state.status === "closed" || !state.amPlayer;
    const view = {
      title: "Online Match",
      badge: state && state.myMark && !closed ? `You are ${state.myMark}` : null,
      status: onlineStatusText(state),
      resultMark: null,
      interactive: false,
      note: "",
      scores: {
        you: state && state.amPlayer ? state.myWins : 0,
        draws: state && state.amPlayer ? state.draws : 0,
        opponent: state && state.amPlayer ? state.opponentWins : 0,
      },
      primary: null,
      leave: closed ? { label: "Back", confirm: false } : { label: "Leave Match", confirm: true },
    };
    if (closed) {
      if (state && state.leftBy === "opponent") view.note = "Your friend left the game.";
      else if (state && state.leftBy === "me") view.note = "You left this game.";
      return view;
    }
    if (state.status === "playing") {
      view.interactive = state.isMyTurn && !pending;
    }
    if (state.status === "finished") {
      view.resultMark = state.winner ? state.winner.toLowerCase() : "draw";
      if (state.rematch === "me") {
        view.primary = { label: "Waiting for opponent…", disabled: true };
        view.note = "Rematch requested. Waiting for your friend.";
      } else if (state.rematch === "opponent") {
        view.primary = { label: "Accept Rematch", disabled: false };
        view.note = "Opponent wants a rematch.";
      } else {
        view.primary = { label: "Rematch", disabled: false };
      }
    }
    return view;
  }

  // What to tell screen reader users when the room changes from prev to next
  // (two deriveOnlineState results). Called once per accepted version, so the
  // same move is never announced twice. Returns "" when there is nothing new.
  function describeOnlineChange(prev, next) {
    if (!prev || !next) {
      return "";
    }
    if (next.status === "closed" && prev.status !== "closed") {
      if (next.leftBy === "opponent") return "Your friend left the game.";
      if (next.leftBy === "me") return "";
      return "Match closed.";
    }
    const parts = [];
    const roundReset = prev.status === "finished" && next.board.every((v) => v === "");
    if (roundReset) {
      parts.push(next.myMark === "X" ? "New game. You are X and go first." : "New game. You are O. Opponent goes first.");
      return parts.join(" ");
    }
    const placed = next.board.map((v, i) => (prev.board[i] === "" && v !== "" ? i : -1)).filter((i) => i >= 0);
    if (placed.length === 1) {
      const who = next.board[placed[0]] === next.myMark ? "You" : "Opponent";
      parts.push(`${who} played ${squareName(placed[0])}.`);
    } else if (placed.length > 1) {
      parts.push("The board was updated.");
    }
    if (placed.length > 0) {
      parts.push(next.status === "finished" ? onlineStatusText(next) : `${onlineStatusText(next)}.`);
    }
    if (next.rematch !== prev.rematch) {
      if (next.rematch === "opponent") parts.push("Opponent wants a rematch.");
      else if (next.rematch === "me") parts.push("Rematch requested. Waiting for your friend.");
    }
    return parts.join(" ");
  }

  // A room code spelled out for screen readers ("K7M2QX" -> "K 7 M 2 Q X"),
  // so it is read letter by letter instead of as a word.
  function spellRoomCode(code) {
    return typeof code === "string" ? code.split("").join(" ") : "";
  }

  return {
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    ROOM_LIFETIME_MS,
    KNOWN_ERRORS,
    normalizeRoomCode,
    isValidRoomCode,
    boardFromServer,
    boardToServer,
    deriveOnlineState,
    isLikelyExpired,
    shouldAcceptVersion,
    buildInviteUrl,
    getRoomCodeFromUrl,
    getInviteFromUrl,
    removeRoomFromUrl,
    normalizeBackendError,
    MESSAGES,
    friendlyErrorMessage,
    getLobbyView,
    shouldShowOnlineBoard,
    matchEntryMessage,
    spellRoomCode,
    squareName,
    onlineStatusText,
    getOnlineBoardView,
    describeOnlineChange,
    presenceTransition,
    isSessionFailure,
    lobbyConnectionNote,
  };
})(typeof module !== "undefined" && module.exports ? require("./game.js") : TicTacToeGame);

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeOnline;
}
