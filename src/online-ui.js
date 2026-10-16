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
// Online board play (moves, scoreboard, rematch) comes in a later phase; for
// now the lobby ends at "Match ready".

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

  function renderLobby() {
    const state = room && room.row ? Online.deriveOnlineState(room.row, room.userId) : null;
    const view = Online.getLobbyView(state);
    const code = (room && room.row && room.row.room_code) || joiningCode || "";

    lobbyStatus.textContent = view.status;
    lobbyNote.textContent = view.note;

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

    // Tell screen readers when the situation changes (once per change).
    if (view.phase !== lastPhase) {
      if (view.phase === "waiting") {
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

  // Show a newer version of the room (from our own request, a live update,
  // or a re-check). Older or duplicate versions are ignored.
  function applyRow(row) {
    if (!room || !row || (room.row && row.id !== room.row.id)) {
      return;
    }
    const current = room.row ? room.row.version : null;
    if (!Online.shouldAcceptVersion(current, row.version)) {
      return;
    }
    room.row = row;
    renderLobby();
  }

  // Listen for changes to this room (e.g. the guest arriving). Once the
  // subscription is live, read the room again: the guest may have joined in
  // the moment between creating the room and subscribing.
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
    const channel = thisRoom.client
      .channel("online-game-" + id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "online_games", filter: "id=eq." + id }, (payload) => {
        if (room === thisRoom) {
          applyRow(payload.new);
        }
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || room !== thisRoom) {
          return;
        }
        const { data } = await thisRoom.client.from("online_games").select("*").eq("id", id).maybeSingle();
        if (data && room === thisRoom) {
          applyRow(data);
        }
      });
    thisRoom.channel = channel;
  }

  // We have a room row from create_game or join_game: show the lobby.
  function enterRoom(connection, row) {
    room = { client: connection.client, userId: connection.user.id, row: null, channel: null };
    joiningCode = null;
    applyRow(row);
    setAddressRoom(row.room_code);
    if (document.getElementById("lobby-screen").classList.contains("hidden")) {
      showScreen("lobby-screen");
    }
    subscribe(connection.session);
  }

  // Leave the lobby: stop listening, optionally close the room on the server,
  // and go back to the Online screen.
  async function exitLobby({ closeRoom }) {
    const leaving = room;
    room = null;
    joiningCode = null;
    visit++;
    lastPhase = null;
    clearTimeout(copyTimer);
    copyButton.textContent = COPY_LABEL;
    setAddressRoom(null);

    if (leaving && closeRoom && leaving.row) {
      leaveButton.disabled = true;
      leaveYes.disabled = true;
      try {
        await leaving.client.rpc("leave_game", { game_id: leaving.row.id });
      } catch (error) {
        // If this fails the room simply expires after an hour of inactivity.
      }
      leaveButton.disabled = false;
      leaveYes.disabled = false;
    }
    if (leaving && leaving.channel) {
      leaving.client.removeChannel(leaving.channel);
    }
    leaveConfirm.hidden = true;
    leaveButton.hidden = false;
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
      setOnlineMessage(friendly.message, { error: true, invalidCode: friendly.code === "INVALID_ROOM_CODE" });
      announce(friendly.message);
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
