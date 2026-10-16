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
    normalizeBackendError,
  };
})(typeof module !== "undefined" && module.exports ? require("./game.js") : TicTacToeGame);

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeOnline;
}
