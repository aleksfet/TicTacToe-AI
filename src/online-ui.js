// Tic Tac Toe AI - online lobby (create, invite, join)
//
// The screens that start an online game:
//   Online screen  -> Create Game, or type a room code and Join Game
//   Lobby screen   -> room code + invite link, "Waiting for opponent…",
//                     then "Match ready" once both players are in
//
// It uses showScreen() and announce() from script.js (loaded just before this
// file), the pure helpers in src/online.js, and the connection in
// src/online-client.js.
//
// Rules this file keeps:
//   - Nothing connects until the player asks for online play (Create Game,
//     Join Game, or opening a valid invite link). Opening the menus doesn't.
//   - The server's row is the truth. The screen only shows what it says, and
//     ignores updates older than the one already shown (row versions).
//   - There are no accounts: the player's identity is created silently.
//
// Once both players are in, "Start Match" opens the normal game screen in
// online mode (script.js draws it). Every change to the room - our own move
// (the server's reply), the opponent's move (a live update), or a re-read -
// goes through applyRow(), which ignores anything not newer than what is
// already shown. So a move is drawn and announced exactly once, and only
// after the server has accepted it.

(() => {
  const Online = TicTacToeOnline;
  const Connection = TicTacToeOnlineClient;

  // --- Elements ---------------------------------------------------------------

  const createButton = document.getElementById("create-game");
  const joinForm = document.getElementById("join-form");
  const codeInput = document.getElementById("room-code-input");
  const joinButton = document.getElementById("join-game");
  const onlineMessage = document.getElementById("online-message");
  const onlineBackButton = document.querySelector('#online-screen [data-target="friend-screen"]');

  const lobbyBadge = document.getElementById("lobby-badge");
  const lobbyStatus = document.getElementById("lobby-status");
  const lobbyCodeBox = document.getElementById("lobby-code-box");
  const lobbyCode = document.getElementById("lobby-code");
  const lobbyCodeSpoken = document.getElementById("lobby-code-spoken");
  const lobbyInvite = document.getElementById("lobby-invite");
  const inviteLink = document.getElementById("invite-link");
  const copyButton = document.getElementById("copy-invite");
  const shareButton = document.getElementById("share-invite");
  const lobbyNote = document.getElementById("lobby-note");
  const leaveButton = document.getElementById("lobby-leave");
  const leaveConfirm = document.getElementById("leave-confirm");
  const leaveYes = document.getElementById("leave-yes");
  const leaveNo = document.getElementById("leave-no");
  const startButton = document.getElementById("lobby-start");

  // The online parts of the game screen.
  const playerScreen = document.getElementById("player-screen");
  const rematchButton = document.getElementById("online-rematch");
  const boardLeave = document.getElementById("online-leave");
  const boardLeaveConfirm = document.getElementById("online-leave-confirm");
  const boardLeaveYes = document.getElementById("online-leave-yes");
  const boardLeaveNo = document.getElementById("online-leave-no");

  const COPY_LABEL = "Copy Invite Link";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // --- State ------------------------------------------------------------------

  // The room this browser is in: { client, userId, row, channel, code }.
  // null when not in a room.
  let room = null;

  // Goes up every time the player leaves the lobby. A slow request that
  // finishes after that compares its number and knows it is out of date.
  let visit = 0;

  // True while Create or Join is running (so a double click does nothing).
  let busy = false;

  // The room code being joined from an invite link (shown while joining).
  let joiningCode = null;

  let lastPhase = null;
  let copyTimer = null;

  // True while our own move (or rematch request) is on its way to the
  // server; the board stays locked until the server answers.
  let movePending = false;

  // A short message under the online board (e.g. "That move is no longer
  // available."). Cleared by the next newer version of the room.
  let boardNotice = "";

  // --- Small helpers ------------------------------------------------------------

  function setOnlineMessage(text, { error = false, invalidCode = false } = {}) {
    onlineMessage.textContent = text;
    onlineMessage.classList.toggle("is-error", error);
    if (invalidCode) {
      codeInput.setAttribute("aria-invalid", "true");
    } else {
      codeInput.removeAttribute("aria-invalid");
    }
  }

  // Disable the Online screen while a request runs, and show progress on the
  // button that was pressed.
  function setBusy(isBusy, button, busyLabel) {
    busy = isBusy;
    [createButton, joinButton, codeInput, onlineBackButton].forEach((el) => {
      el.disabled = isBusy;
    });
    if (button) {
      if (isBusy) {
        button.dataset.label = button.textContent;
        button.textContent = busyLabel;
        button.setAttribute("aria-busy", "true");
      } else {
        button.textContent = button.dataset.label || button.textContent;
        button.removeAttribute("aria-busy");
      }
    }
  }

  // Put ?room=CODE in the address bar (so a refresh rejoins this room), or
  // take it out again (so a refresh doesn't rejoin a room we left).
  function setAddressRoom(code) {
    const next = code ? Online.buildInviteUrl(window.location.href, code) : Online.removeRoomFromUrl(window.location.href);
    if (next && next !== window.location.href) {
      try {
        window.history.replaceState(null, "", next);
      } catch (error) {
        // Some file:// pages don't allow it; nothing else depends on it.
      }
    }
  }

  // --- The lobby screen ---------------------------------------------------------

  // quiet: don't announce (the online board is showing and announces itself).
  function renderLobby({ quiet = false } = {}) {
    const state = room && room.row ? Online.deriveOnlineState(room.row, room.userId) : null;
    let view = Online.getLobbyView(state);
    const code = (room && room.row && room.row.room_code) || joiningCode || "";

    // The room can no longer be used from this browser: say why, offer Back.
    if (room && (room.sessionEnded || room.expired)) {
      view = {
        ...view,
        phase: "closed",
        status: room.sessionEnded ? Online.MESSAGES.SESSION_ENDED : Online.MESSAGES.GAME_EXPIRED,
        note: room.sessionEnded ? Online.MESSAGES.SESSION_ENDED_HINT : Online.MESSAGES.GAME_EXPIRED_HINT,
        badge: null,
        showInvite: false,
        leaveLabel: "Back",
        confirmLeave: false,
        startLabel: undefined,
      };
    }
    // Connection news (reconnecting, friend disconnected, invite probably
    // expired) replaces the normal note while it applies.
    const connectionNote = room && room.row && !room.sessionEnded && !room.expired
      ? Online.lobbyConnectionNote({
          phase: view.phase,
          connection: room.connection,
          opponent: room.opponentBack ? "back" : room.opponent,
          likelyExpired: Boolean(room.expiryHint),
        })
      : null;

    lobbyStatus.textContent = view.status;
    lobbyNote.textContent = connectionNote || view.note;

    lobbyBadge.hidden = !view.badge;
    lobbyBadge.textContent = view.badge || "";

    lobbyCodeBox.hidden = !view.showCode || !code;
    lobbyCode.textContent = code;
    lobbyCodeSpoken.textContent = code ? "Room code " + Online.spellRoomCode(code) : "";

    lobbyInvite.hidden = !view.showInvite;
    if (view.showInvite) {
      inviteLink.value = Online.buildInviteUrl(window.location.href, code) || "";
      shareButton.hidden = !canShare;
    }

    leaveButton.textContent = view.leaveLabel;
    leaveButton.dataset.confirm = view.confirmLeave ? "yes" : "no";
    if (!view.confirmLeave) {
      leaveConfirm.hidden = true;
      leaveButton.hidden = false;
    }

    startButton.hidden = !view.startLabel || !leaveConfirm.hidden;
    startButton.textContent = view.startLabel || "Start Match";

    // Tell screen readers when the situation changes (once per change).
    if (view.phase !== lastPhase) {
      if (quiet) {
        // nothing: the board announces its own changes
      } else if (view.phase === "waiting") {
        announce(`Game created. ${lobbyCodeSpoken.textContent}. Waiting for opponent.`);
      } else if (view.phase === "ready") {
        announce(`Match ready. ${view.note}`);
      } else if (view.phase === "closed") {
        announce(view.status);
      } else if (view.phase === "joining") {
        announce("Joining game…");
      }
      lastPhase = view.phase;
    }
  }

  // --- Connection awareness -----------------------------------------------------
  //
  // Presence (who is connected) travels on the room's existing live channel.
  // It only changes messages and whether the board accepts clicks; the
  // players, the turn and whether the room is open always come from the
  // server's row.
  //
  // Per room this file keeps:
  //   connection   "connecting" | "connected" | "reconnecting"  (this browser)
  //   opponent     "unknown" | "present" | "away" | "disconnected" (the friend)
  //   opponentBack true for a few seconds after the friend returns
  //   expired / sessionEnded  the room can no longer be played from here

  const GRACE_MS = 8000; // a friend missing longer than this shows as disconnected
  const BACK_MS = 4000; // how long "Opponent is back." stays on screen
  const HEALTH_CHECK_MS = 2000; // how often the live connection is checked

  // The room in which this browser's online identity stopped working, so a
  // failed rejoin can be explained (see joinGame).
  let endedRoomCode = null;

  function onlineBoardVisible() {
    return gameMode === "online" && !playerScreen.classList.contains("hidden");
  }

  function boardOptions() {
    return {
      pending: movePending,
      connection: room.connection,
      opponent: room.opponentBack ? "back" : room.opponent,
      expired: room.expired,
      sessionEnded: room.sessionEnded,
    };
  }

  // Redraw whatever is showing (lobby and/or online board) without announcing.
  function renderAll() {
    renderLobby({ quiet: true });
    if (onlineBoardVisible()) {
      renderOnlineBoard();
    }
  }

  // THE one way the screen learns about the room. Called with the server's
  // reply to our own request, with live updates, and with re-reads. Older
  // or duplicate versions are ignored, so the same change is never drawn or
  // announced twice (e.g. our move arrives as a reply AND as a live update).
  function applyRow(row) {
    if (!room || !row || (room.row && row.id !== room.row.id)) {
      return;
    }
    const current = room.row ? room.row.version : null;
    if (!Online.shouldAcceptVersion(current, row.version)) {
      return;
    }
    const before = room.row ? Online.deriveOnlineState(room.row, room.userId) : null;
    room.row = row;
    boardNotice = "";
    const onBoard = onlineBoardVisible();
    renderLobby({ quiet: onBoard });
    if (onBoard) {
      renderOnlineBoard();
      const message = Online.describeOnlineChange(before, Online.deriveOnlineState(row, room.userId));
      if (message) {
        announce(message);
      }
    }
    // A guest may just have arrived: check whether they are connected.
    evaluatePresence(room);
  }

  // Read the room from the server again and show it if it is newer. Used
  // when the live connection (re)starts, when the tab becomes visible again,
  // when the friend comes back, and after a refused move - anything we might
  // have missed. Returns true if the server answered.
  async function refreshRoom() {
    const thisRoom = room;
    if (!thisRoom || !thisRoom.row) {
      return false;
    }
    let result;
    try {
      result = await thisRoom.client.from("online_games").select("*").eq("id", thisRoom.row.id).maybeSingle();
    } catch (error) {
      return false;
    }
    if (room !== thisRoom) {
      return false;
    }
    if (result.error) {
      if (Online.isSessionFailure(result.error)) {
        endSession();
      }
      return false;
    }
    if (!result.data) {
      return false;
    }
    applyRow(result.data);
    return true;
  }

  function setConnection(next) {
    if (!room || room.connection === next) {
      return;
    }
    const previous = room.connection;
    room.connection = next;
    if (next === "reconnecting") {
      announce(Online.MESSAGES.RECONNECTING);
    } else if (next === "connected" && previous === "reconnecting") {
      boardNotice = "";
      announce(Online.MESSAGES.CONNECTION_RESTORED);
    }
    renderAll();
  }

  // Is this browser's live connection to the room healthy? If not, show
  // "Reconnecting…" and lock the board. When it is healthy again, read the
  // room first and only then unlock (so a stale board is never playable).
  async function checkConnection() {
    const thisRoom = room;
    if (!thisRoom || !thisRoom.channel || thisRoom.sessionEnded) {
      return;
    }
    const healthy =
      navigator.onLine !== false && thisRoom.channel.state === "joined" && thisRoom.client.realtime.isConnected();
    if (!healthy) {
      if (thisRoom.subscribedOnce) {
        setConnection("reconnecting");
      }
      return;
    }
    if (thisRoom.connection !== "connected" && !thisRoom.recovering) {
      thisRoom.recovering = true;
      const ok = await refreshRoom();
      thisRoom.recovering = false;
      if (ok && room === thisRoom) {
        setConnection("connected");
      }
    }
    // A host waiting alone for a long time: the "probably expired" hint may
    // need to appear (display only; the server decides).
    const hint = Boolean(thisRoom.row && !thisRoom.row.guest_id && Online.isLikelyExpired(thisRoom.row));
    if (room === thisRoom && hint !== thisRoom.expiryHint) {
      thisRoom.expiryHint = hint;
      renderLobby({ quiet: true });
    }
  }

  // The online identity stopped working (e.g. it was signed out or expired).
  // Don't create a new one behind the player's back: the old seat belongs to
  // the old identity. Explain, and offer the way back.
  function endSession() {
    if (!room || room.sessionEnded) {
      return;
    }
    room.sessionEnded = true;
    endedRoomCode = room.row ? room.row.room_code : null;
    announce(`${Online.MESSAGES.SESSION_ENDED} ${Online.MESSAGES.SESSION_ENDED_HINT}`);
    renderAll();
  }

  function markExpired() {
    if (!room || room.expired) {
      return;
    }
    room.expired = true;
    announce(`${Online.MESSAGES.GAME_EXPIRED} ${Online.MESSAGES.GAME_EXPIRED_HINT}`);
    renderAll();
  }

  // Look at who is on the room's live channel and update the friend's state
  // (with the grace period, so a quick refresh never shows "disconnected").
  function evaluatePresence(thisRoom) {
    if (!thisRoom || room !== thisRoom || !thisRoom.channel || !thisRoom.row) {
      return;
    }
    const row = thisRoom.row;
    const opponentId = row.host_id === thisRoom.userId ? row.guest_id : row.host_id;
    if (row.left_by) {
      return; // the room is closed: nothing to watch
    }
    if (!opponentId) {
      // A host waiting alone: someone else appearing on the room's channel is
      // almost certainly the guest who just joined. Read the room, in case
      // the live "guest joined" update was missed.
      if (Object.keys(thisRoom.channel.presenceState()).some((key) => key !== thisRoom.userId)) {
        refreshRoom();
      }
      return;
    }
    const present = Object.prototype.hasOwnProperty.call(thisRoom.channel.presenceState(), opponentId);
    const change = Online.presenceTransition(thisRoom.opponent, present);
    if (change.next === thisRoom.opponent && !change.returned) {
      return;
    }
    thisRoom.opponent = change.next;
    if (change.cancelGrace) {
      clearTimeout(thisRoom.graceTimer);
    }
    if (change.startGrace) {
      clearTimeout(thisRoom.graceTimer);
      thisRoom.graceTimer = setTimeout(() => {
        if (room !== thisRoom || thisRoom.opponent !== "away" || (thisRoom.row && thisRoom.row.left_by)) {
          return;
        }
        thisRoom.opponent = "disconnected";
        announce(Online.MESSAGES.OPPONENT_DISCONNECTED);
        renderAll();
      }, GRACE_MS);
    }
    if (change.returned) {
      thisRoom.opponentBack = true;
      clearTimeout(thisRoom.backTimer);
      thisRoom.backTimer = setTimeout(() => {
        if (room === thisRoom) {
          thisRoom.opponentBack = false;
          renderAll();
        }
      }, BACK_MS);
      announce(Online.MESSAGES.OPPONENT_BACK);
      refreshRoom(); // they may have moved while we couldn't see it
    }
    renderAll();
  }

  // Listen for changes to this room (the guest arriving, moves, rematches)
  // and for who is connected (Presence), on one channel. Every time the
  // channel becomes live - the first time and after any reconnect - announce
  // ourselves again and read the room again before unlocking.
  async function subscribe(session) {
    const thisRoom = room;
    const id = thisRoom.row.id;
    try {
      await thisRoom.client.realtime.setAuth(session.access_token);
    } catch (error) {
      // The client also passes the token itself; this just makes it explicit.
    }
    if (room !== thisRoom) {
      return;
    }
    // Presence key = this browser's anonymous player id. Nothing personal.
    const channel = thisRoom.client
      .channel("online-game-" + id, { config: { presence: { key: thisRoom.userId } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "online_games", filter: "id=eq." + id }, (payload) => {
        if (room === thisRoom) {
          applyRow(payload.new);
        }
      })
      .on("presence", { event: "sync" }, () => evaluatePresence(thisRoom))
      .subscribe((status) => {
        if (room !== thisRoom) {
          return;
        }
        if (status === "SUBSCRIBED") {
          thisRoom.subscribedOnce = true;
          channel.track({ online: true }).catch(() => {});
          checkConnection();
          // The server can report "subscribed" a moment before it starts
          // delivering database changes; read once more shortly after, so a
          // change in that gap (e.g. the guest joining) is never missed.
          setTimeout(() => {
            if (room === thisRoom) {
              refreshRoom();
            }
          }, 1500);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (thisRoom.subscribedOnce) {
            setConnection("reconnecting");
          }
        }
      });
    thisRoom.channel = channel;
    thisRoom.healthTimer = setInterval(checkConnection, HEALTH_CHECK_MS);
  }

  // --- The online board ---------------------------------------------------------

  // Draw the game screen from the room: board, turn/result, scores, buttons.
  function renderOnlineBoard() {
    if (!room || !room.row) {
      return;
    }
    const state = Online.deriveOnlineState(room.row, room.userId);
    const view = Online.getOnlineBoardView(state, boardOptions());

    setBoardHeader(view.title, view.badge);
    setStatusLine(view.status, view.resultMark);
    // Scores are per person (marks swap on every rematch), straight from the
    // server's counts - never counted here.
    setScoreboard("You", "Opponent", view.scores.you, view.scores.opponent, view.scores.draws);
    renderBoard(state ? state.board : TicTacToeGame.createEmptyBoard(), {
      winningLine: state && !room.expired && !room.sessionEnded ? state.winningLine : null,
      locked: !view.interactive,
    });
    setBoardNote(boardNotice || view.note);

    const confirming = !boardLeaveConfirm.hidden;
    rematchButton.hidden = !view.primary || confirming;
    if (view.primary) {
      rematchButton.textContent = view.primary.label;
      rematchButton.disabled = view.primary.disabled || movePending;
    }
    boardLeave.textContent = view.leave.label;
    boardLeave.dataset.confirm = view.leave.confirm ? "yes" : "no";
    if (!view.leave.confirm && confirming) {
      // The room closed while we were asking: nothing left to confirm.
      boardLeaveConfirm.hidden = true;
      boardLeave.hidden = false;
    }
  }

  // "Start Match" / "Resume Match": open the board for this room.
  function startMatch() {
    if (!room || !room.row) {
      return;
    }
    boardNotice = "";
    boardLeaveConfirm.hidden = true;
    boardLeave.hidden = false;
    enterOnlineBoard(onSquare);
    renderOnlineBoard();
    const view = Online.getOnlineBoardView(Online.deriveOnlineState(room.row, room.userId), boardOptions());
    announce(`Online match. ${view.badge ? view.badge + ". " : ""}${view.status}`);
  }

  // What to do when a move or rematch request fails. Never retried
  // automatically: the next re-read of the room shows what really happened.
  async function handleActionError(thisRoom, error, { isMove }) {
    if (Online.isSessionFailure(error)) {
      endSession();
      return "";
    }
    const raw = Online.normalizeBackendError(error);
    if (raw && raw.code === "ROOM_EXPIRED") {
      markExpired();
      return "";
    }
    if (Online.friendlyErrorMessage(error).code === "UNAVAILABLE") {
      // The request may or may not have reached the server; the re-read
      // after reconnecting will show the truth.
      setConnection("reconnecting");
      return Online.MESSAGES.NETWORK_ACTION;
    }
    let notice = "";
    if (isMove && raw && (raw.code === "NOT_YOUR_TURN" || raw.code === "CELL_TAKEN")) {
      notice = "That move is no longer available.";
    } else if (!raw || !raw.known) {
      notice = Online.MESSAGES.GENERIC;
    }
    // GAME_OVER / ROOM_CLOSED / NOT_A_PLAYER: the re-read shows why.
    await refreshRoom();
    return notice;
  }

  // The player picked a square. The server decides; we only draw its answer.
  async function onSquare(index) {
    if (!room || !room.row || movePending) {
      return;
    }
    const state = Online.deriveOnlineState(room.row, room.userId);
    if (!Online.getOnlineBoardView(state, boardOptions()).interactive || state.board[index] !== "") {
      return; // not our turn / square taken / not connected: nothing to send
    }
    const thisRoom = room;
    movePending = true;
    renderOnlineBoard(); // locks the board while the move is on its way
    let notice = "";
    try {
      const { data, error } = await thisRoom.client.rpc("make_move", { game_id: thisRoom.row.id, cell: index });
      if (error) {
        throw error;
      }
      movePending = false;
      if (room === thisRoom) {
        applyRow(data);
      }
    } catch (error) {
      movePending = false;
      if (room !== thisRoom) {
        return;
      }
      notice = await handleActionError(thisRoom, error, { isMove: true });
    } finally {
      movePending = false;
    }
    if (room === thisRoom) {
      boardNotice = notice;
      renderOnlineBoard();
      if (notice) {
        announce(notice);
      }
    }
  }

  // Rematch / Accept Rematch.
  rematchButton.addEventListener("click", async () => {
    if (!room || !room.row || movePending || room.connection !== "connected") {
      return;
    }
    const thisRoom = room;
    movePending = true;
    rematchButton.disabled = true;
    let notice = "";
    try {
      const { data, error } = await thisRoom.client.rpc("request_rematch", { game_id: thisRoom.row.id });
      if (error) {
        throw error;
      }
      movePending = false;
      if (room === thisRoom) {
        applyRow(data);
      }
    } catch (error) {
      movePending = false;
      if (room !== thisRoom) {
        return;
      }
      notice = await handleActionError(thisRoom, error, { isMove: false });
    } finally {
      movePending = false;
    }
    if (room === thisRoom) {
      boardNotice = notice;
      renderOnlineBoard();
      if (notice) {
        announce(notice);
      }
    }
  });

  // Leave Match (asks first: it closes the room for the friend too), or Back
  // once the room is closed / expired / no longer ours.
  boardLeave.addEventListener("click", () => {
    if (boardLeave.dataset.confirm === "yes") {
      boardLeave.hidden = true;
      rematchButton.hidden = true;
      boardLeaveConfirm.hidden = false;
      boardLeaveNo.focus();
      announce(document.getElementById("online-leave-text").textContent);
      return;
    }
    exitLobby({ closeRoom: false });
  });

  boardLeaveYes.addEventListener("click", () => exitLobby({ closeRoom: true }));

  boardLeaveNo.addEventListener("click", () => {
    boardLeaveConfirm.hidden = true;
    boardLeave.hidden = false;
    renderOnlineBoard();
    boardLeave.focus();
  });

  startButton.addEventListener("click", startMatch);

  // A phone waking up or a tab coming back may have missed live updates:
  // check the connection, say we're here again, and read the room again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !room || !room.row) {
      return;
    }
    if (room.channel && room.channel.state === "joined") {
      room.channel.track({ online: true }).catch(() => {});
    }
    checkConnection();
    refreshRoom();
  });

  // The browser's own idea of being online changes the connection display at
  // once (the periodic check would notice within a couple of seconds anyway).
  window.addEventListener("offline", () => checkConnection());
  window.addEventListener("online", () => checkConnection());

  // We have a room row from create_game or join_game: show the lobby.
  function enterRoom(connection, row) {
    room = {
      client: connection.client,
      userId: connection.user.id,
      row: null,
      channel: null,
      connection: "connecting",
      subscribedOnce: false,
      recovering: false,
      opponent: "unknown",
      opponentBack: false,
      graceTimer: null,
      backTimer: null,
      healthTimer: null,
      expired: false,
      sessionEnded: false,
      expiryHint: false,
    };
    joiningCode = null;
    endedRoomCode = null;
    applyRow(row);
    setAddressRoom(row.room_code);
    if (document.getElementById("lobby-screen").classList.contains("hidden")) {
      showScreen("lobby-screen");
    }
    subscribe(connection.session);
  }

  // Leave the lobby: stop listening, optionally close the room on the server,
  // and go back to the Online screen. (Never called for a refresh or a closed
  // tab: then the room stays open and the player can come back.)
  async function exitLobby({ closeRoom }) {
    const leaving = room;
    room = null;
    joiningCode = null;
    visit++;
    lastPhase = null;
    movePending = false;
    boardNotice = "";
    clearTimeout(copyTimer);
    copyButton.textContent = COPY_LABEL;
    setAddressRoom(null);
    if (leaving) {
      clearTimeout(leaving.graceTimer);
      clearTimeout(leaving.backTimer);
      clearInterval(leaving.healthTimer);
    }

    if (leaving && closeRoom && leaving.row) {
      [leaveButton, leaveYes, boardLeave, boardLeaveYes].forEach((b) => (b.disabled = true));
      try {
        await leaving.client.rpc("leave_game", { game_id: leaving.row.id });
      } catch (error) {
        // If this fails the room simply expires after an hour of inactivity.
      }
      [leaveButton, leaveYes, boardLeave, boardLeaveYes].forEach((b) => (b.disabled = false));
    }
    if (leaving && leaving.channel) {
      leaving.client.removeChannel(leaving.channel);
    }
    leaveConfirm.hidden = true;
    leaveButton.hidden = false;
    boardLeaveConfirm.hidden = true;
    boardLeave.hidden = false;
    setOnlineMessage("");
    showScreen("online-screen");
  }

  // --- Create -----------------------------------------------------------------

  async function createGame() {
    if (busy) {
      return;
    }
    const myVisit = visit;
    setBusy(true, createButton, "Creating game…");
    setOnlineMessage("");
    announce("Creating game…");
    let connection;
    let row;
    try {
      connection = await Connection.ensureAnonymousSession();
      const { data, error } = await connection.client.rpc("create_game");
      if (error) {
        throw error;
      }
      row = data;
    } catch (error) {
      const friendly = Online.friendlyErrorMessage(error);
      setOnlineMessage(friendly.message, { error: true });
      announce(friendly.message);
      return;
    } finally {
      setBusy(false, createButton);
    }
    if (myVisit !== visit) {
      // The player went elsewhere meanwhile: don't leave a room waiting.
      connection.client.rpc("leave_game", { game_id: row.id });
      return;
    }
    enterRoom(connection, row);
  }

  // --- Join ---------------------------------------------------------------------

  // fromLink: the player opened an invite link (the lobby already shows
  // "Joining game…"); otherwise they typed the code on the Online screen.
  async function joinGame(code, { fromLink = false } = {}) {
    if (busy) {
      return;
    }
    const myVisit = visit;
    if (fromLink) {
      busy = true;
    } else {
      setBusy(true, joinButton, "Joining game…");
      setOnlineMessage("");
      announce("Joining game…");
    }
    let connection;
    let row;
    let failure = null;
    try {
      connection = await Connection.ensureAnonymousSession();
      const { data, error } = await connection.client.rpc("join_game", { code });
      if (error) {
        throw error;
      }
      row = data;
    } catch (error) {
      failure = error;
    } finally {
      if (fromLink) {
        busy = false;
      } else {
        setBusy(false, joinButton);
      }
    }

    if (myVisit !== visit) {
      // Cancelled while joining: if we got a seat, give it back.
      if (row) {
        connection.client.rpc("leave_game", { game_id: row.id });
      }
      return;
    }
    if (failure) {
      const friendly = Online.friendlyErrorMessage(failure);
      if (fromLink) {
        // Back to the Online screen with the code filled in, to retry.
        joiningCode = null;
        lastPhase = null;
        setAddressRoom(null);
        codeInput.value = code;
        showScreen("online-screen");
      }
      // After this browser's online identity ended, a new identity can't take
      // the old seat; say so plainly instead of a bare "game is full".
      const message = friendly.code === "ROOM_FULL" && endedRoomCode === code
        ? Online.MESSAGES.SESSION_SEAT_TAKEN
        : friendly.message;
      setOnlineMessage(message, { error: true, invalidCode: friendly.code === "INVALID_ROOM_CODE" });
      announce(message);
      return;
    }
    enterRoom(connection, row);
  }

  // The Join form: check the code here first, so an obviously wrong code
  // never touches the network.
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const code = Online.normalizeRoomCode(codeInput.value);
    if (!Online.isValidRoomCode(code)) {
      setOnlineMessage(Online.MESSAGES.INVALID_ROOM_CODE, { error: true, invalidCode: true });
      announce(Online.MESSAGES.INVALID_ROOM_CODE);
      codeInput.focus();
      return;
    }
    codeInput.value = code;
    joinGame(code);
  });

  // Typing again clears an old error.
  codeInput.addEventListener("input", () => {
    if (codeInput.getAttribute("aria-invalid") === "true" || onlineMessage.classList.contains("is-error")) {
      setOnlineMessage("");
    }
  });

  createButton.addEventListener("click", createGame);

  // A fresh Online screen each time it is opened from the friend menu.
  document.querySelectorAll('[data-target="online-screen"]').forEach((button) => {
    button.addEventListener("click", () => {
      if (!busy) {
        setOnlineMessage("");
      }
    });
  });

  // --- Copy / share -------------------------------------------------------------

  copyButton.addEventListener("click", async () => {
    const link = inviteLink.value;
    if (!link) {
      return;
    }
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(link);
      copyButton.textContent = "Link copied!";
      announce("Invite link copied.");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyButton.textContent = COPY_LABEL;
      }, 2500);
    } catch (error) {
      // Couldn't copy (e.g. no permission): select the link so the player can.
      inviteLink.focus();
      inviteLink.select();
      const text = "Couldn't copy automatically. The link is selected so you can copy it.";
      lobbyNote.textContent = text;
      announce(text);
    }
  });

  shareButton.addEventListener("click", async () => {
    const code = room && room.row ? room.row.room_code : "";
    try {
      await navigator.share({
        title: "Tic Tac Toe AI Arena",
        text: `Play Tic Tac Toe with me! Room code: ${code}`,
        url: inviteLink.value,
      });
    } catch (error) {
      if (error && error.name !== "AbortError") {
        const text = "Couldn't open sharing. Use Copy Invite Link instead.";
        lobbyNote.textContent = text;
        announce(text);
      }
    }
  });

  // --- Cancel / leave -------------------------------------------------------------

  leaveButton.addEventListener("click", () => {
    if (leaveButton.dataset.confirm === "yes") {
      // Two players are in the room: leaving closes it for the friend too.
      leaveButton.hidden = true;
      startButton.hidden = true;
      leaveConfirm.hidden = false;
      leaveNo.focus();
      announce(document.getElementById("leave-confirm-text").textContent);
      return;
    }
    // Waiting alone, still joining, or the room is already closed.
    const phase = lastPhase;
    exitLobby({ closeRoom: phase === "waiting" });
  });

  leaveYes.addEventListener("click", () => exitLobby({ closeRoom: true }));

  leaveNo.addEventListener("click", () => {
    leaveConfirm.hidden = true;
    leaveButton.hidden = false;
    renderLobby({ quiet: true }); // brings Start Match back
    leaveButton.focus();
  });

  // --- Invite links -------------------------------------------------------------

  // Opening the site with ?room=CODE goes straight to joining that game.
  const invite = Online.getInviteFromUrl(window.location.href);
  if (invite.status === "valid") {
    joiningCode = invite.code;
    renderLobby(); // "Joining game…" with the code
    showScreen("lobby-screen");
    joinGame(invite.code, { fromLink: true });
  } else if (invite.status === "invalid") {
    // A broken link: explain, and don't connect to anything.
    setAddressRoom(null);
    showScreen("online-screen");
    setOnlineMessage(Online.MESSAGES.INVALID_INVITE, { error: true });
    announce(Online.MESSAGES.INVALID_INVITE);
  }
})();
