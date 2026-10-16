// Tic Tac Toe AI - browser UI
//
// This file handles the page: screens, themes, clicks, the scoreboard and the
// "Computer thinking..." pause. The game rules live in src/game.js and the
// computer players live in src/ai.js (both load before this file). Online
// play (create / invite / join) lives in src/online-ui.js, which loads after
// this file and uses showScreen() and announce() from here.
//
// Features:
//   - Screen switching (start menu <-> difficulty menu <-> the board, and the
//     "Play with a Friend" menus).
//   - Play with a Friend -> Same Device: two humans take turns on the board.
//   - Play vs Computer (Easy): you are X, the computer is O and plays a
//     random empty cell after a short "thinking" pause.
//   - Play vs Computer (Medium): a casual opponent. Most of the time it
//     plays smart (win / block / center / corner), but sometimes it plays a
//     random square, so it stays beatable and less predictable.
//   - Play vs Computer (Impossible): uses the Minimax algorithm to always
//     pick the best move, so the best you can do is draw.

// ---------------------------------------------------------------------------
// Screen switching
//
//   - The page has several <section class="screen"> blocks.
//   - Only one is visible; the rest have the "hidden" class.
//   - Any button with a data-target attribute, when clicked, hides every
//     screen and then shows the screen whose id matches that data-target.
//   - A button can also carry data-mode ("player", "easy", "medium", or
//     "impossible") to say which kind of game to start when it opens the board.
// ---------------------------------------------------------------------------

const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll("[data-target]");

// Show one screen by id and hide all the others, then move keyboard focus
// into the new screen (so focus never gets lost on a hidden button).
function showScreen(screenId) {
  // Cancel any pending computer move so it can't fire on another screen.
  clearTimeout(computerTimer);
  // Never leave the game screen's theme menu open behind another screen.
  closeThemeMenu();

  // Remember which screen we are leaving (used to choose where focus goes).
  const fromScreen = document.querySelector(".screen:not(.hidden)");
  const fromId = fromScreen ? fromScreen.id : null;

  screens.forEach((screen) => {
    screen.classList.add("hidden");
  });

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("hidden");
  }

  // Opening the board always begins a fresh game. Leaving it also clears it,
  // so a game abandoned mid-turn doesn't linger on the hidden board.
  // (An online match is drawn from the server's copy instead, by online-ui.js.)
  const openingLocalGame = screenId === "player-screen" && gameMode !== "online";
  if (openingLocalGame || fromId === "player-screen") {
    resetGame();
  }
  if (openingLocalGame) {
    announce("New game. " + statusText.textContent);
  }

  if (target) {
    moveFocusInto(target, fromId);
  }
}

// Going BACK to a menu puts focus on the button that led away from it, so a
// keyboard user picks up where they left off. Listed as
// "menu screen" -> { "screen we came back from": "button to focus" }.
function returnFocusTargets() {
  const gameButton = gameMode === "player" ? '[data-target="friend-screen"]' : '[data-target="computer-screen"]';
  return {
    "start-screen": {
      "how-screen": '[data-target="how-screen"]',
      "computer-screen": '[data-target="computer-screen"]',
      "friend-screen": '[data-target="friend-screen"]',
      "player-screen": gameButton,
    },
    "friend-screen": {
      "online-screen": '[data-target="online-screen"]',
    },
    "online-screen": {
      "lobby-screen": "#create-game",
      "player-screen": "#create-game",
    },
  };
}

// Where keyboard focus goes after a screen switch:
//   - back on a menu: the button that led away from it (see above);
//   - anywhere else: the new screen's heading (it has tabindex="-1" so it can
//     take focus without becoming a Tab stop).
function moveFocusInto(screen, fromId) {
  const targets = returnFocusTargets()[screen.id];
  const selector = targets && fromId ? targets[fromId] : null;
  const button = selector ? screen.querySelector(selector) : null;
  if (button) {
    button.focus();
    return;
  }
  const heading = screen.querySelector("h1, h2");
  if (heading) {
    heading.focus();
  }
}

// When a button is clicked, optionally set the game mode, then switch screens.
navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.getAttribute("data-mode");
    if (mode) {
      gameMode = mode;   // "player", "easy", "medium", or "impossible"
      resetScores();     // choosing a mode starts a fresh scoreboard
    }
    const targetId = button.getAttribute("data-target");
    showScreen(targetId);
  });
});

// ---------------------------------------------------------------------------
// Arena (theme) selection
//
//   - Each theme is a CSS class on <body> ("theme-classic", "theme-ocean",
//     "theme-neon"); Ocean and Neon override the color variables.
//   - The chosen theme is just a body class, so it stays put no matter which
//     screen is shown (switching screens never touches the body class).
// ---------------------------------------------------------------------------

const themeButtons = document.querySelectorAll("[data-theme]");
const THEME_CLASSES = ["theme-classic", "theme-ocean", "theme-neon"];

function setTheme(theme) {
  // Swap the theme class on the body...
  document.body.classList.remove(...THEME_CLASSES);
  document.body.classList.add("theme-" + theme);
  // ...and highlight the matching arena button (aria-pressed tells screen
  // readers which one is selected).
  themeButtons.forEach((button) => {
    const selected = button.getAttribute("data-theme") === theme;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

themeButtons.forEach((button) => {
  button.addEventListener("click", () => setTheme(button.getAttribute("data-theme")));
});

// Start on the Classic arena.
setTheme("classic");

// --- The small theme menu on the game screen ---
//
// The palette button (top-right of the game card) opens a little list of the
// same three arenas. Its buttons carry data-theme too, so the code above
// already switches the theme and keeps both pickers in step. Changing the
// theme only swaps the body class: the board, scores, turn, the computer and
// an online match are never touched.

const themeMenu = document.getElementById("theme-menu");
const themeToggle = document.getElementById("theme-toggle");
const themePopover = document.getElementById("theme-popover");

function openThemeMenu() {
  themePopover.hidden = false;
  themeToggle.setAttribute("aria-expanded", "true");
  // Start on the arena in use, so keyboard users see where they are.
  const current = themePopover.querySelector('[aria-pressed="true"]') || themePopover.querySelector("button");
  current.focus();
}

// returnFocus: put focus back on the palette button (after choosing, or
// Escape). Not when the player clicked somewhere else on the page.
function closeThemeMenu({ returnFocus = false } = {}) {
  if (themePopover.hidden) {
    return;
  }
  themePopover.hidden = true;
  themeToggle.setAttribute("aria-expanded", "false");
  if (returnFocus) {
    themeToggle.focus();
  }
}

themeToggle.addEventListener("click", () => {
  if (themePopover.hidden) {
    openThemeMenu();
  } else {
    closeThemeMenu();
  }
});

// Choosing an arena closes the menu (the theme itself is set above).
themePopover.querySelectorAll("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => closeThemeMenu({ returnFocus: true }));
});

themeMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !themePopover.hidden) {
    event.preventDefault();
    closeThemeMenu({ returnFocus: true });
  }
});

// A click or tap anywhere else closes it...
document.addEventListener("pointerdown", (event) => {
  if (!themeMenu.contains(event.target)) {
    closeThemeMenu();
  }
});

// ...and so does tabbing away from it.
themeMenu.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !themeMenu.contains(event.relatedTarget)) {
    closeThemeMenu();
  }
});

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

// Grab the parts of the board screen we need to read or update.
const boardEl = document.getElementById("board");
const cells = document.querySelectorAll(".cell");
const statusText = document.getElementById("status");
const announcer = document.getElementById("announcer");
const boardTitle = document.getElementById("board-title");
const difficultyBadge = document.getElementById("difficulty-badge");
const restartButton = document.getElementById("restart");
const resetScoreButton = document.getElementById("reset-score");
const explanationEl = document.getElementById("ai-explanation");
const localControls = document.getElementById("local-controls");
const onlineControls = document.getElementById("online-controls");

// Holds the most recent "why the computer moved" text, from the AI's choice.
let aiExplanation = "";

// Scoreboard pieces: the two labels that change per mode, and the three values.
const scoreLabelX = document.getElementById("score-label-x");
const scoreLabelO = document.getElementById("score-label-o");
const scoreValueX = document.getElementById("score-x");
const scoreValueO = document.getElementById("score-o");
const scoreValueDraws = document.getElementById("score-draws");
const scoreboardEl = document.querySelector("#player-screen .scoreboard");

// Session scores. "x" counts X / You wins, "o" counts O / Computer wins.
// (The human is always X and the computer is always O, so this lines up.)
let scores = { x: 0, o: 0, draws: 0 };

// The board is a list of 9 strings: "", "X", or "O" (index 0..8).
//   0 | 1 | 2
//   3 | 4 | 5
//   6 | 7 | 8
let board = TicTacToeGame.createEmptyBoard();
let currentPlayer = "X";   // X always goes first
let gameOver = false;      // becomes true once someone wins or it's a draw

// Game mode:
//   "player"     = two humans
//   "easy"       = human is X, computer is O, computer plays random moves
//   "medium"     = human is X, computer is O, computer plays smarter moves
//   "impossible" = human is X, computer is O, computer uses Minimax (perfect)
//   "online"     = two people on different devices (src/online-ui.js). The
//                  server's copy of the game is the truth: this file never
//                  places a mark in online mode, it only passes the click on.
let gameMode = "player";

// In online mode, square clicks go to this function (set by online-ui.js).
let onlineMoveHandler = null;

// True whenever the computer is one of the players.
function isComputerMode() {
  return gameMode === "easy" || gameMode === "medium" || gameMode === "impossible";
}

// While the computer is "thinking", we lock the board so the human can't move.
let lockBoard = false;

// Remembers the pending "computer thinking" timer so we can cancel it if the
// player restarts or leaves before the computer has moved.
let computerTimer = null;

// --- Accessibility helpers ---

// "Row 2, column 3" for cell index 5.
function cellPosition(index) {
  return "Row " + (Math.floor(index / 3) + 1) + ", column " + ((index % 3) + 1);
}

// Give a cell its screen reader name, e.g. "Row 1, column 2, empty" or
// "Row 2, column 3, X". The visible cell is unchanged.
function cellLabel(index, value) {
  return cellPosition(index) + ", " + (value === "" ? "empty" : value);
}

function updateCellLabel(index) {
  cells[index].setAttribute("aria-label", cellLabel(index, board[index]));
}

// Draw the whole board from a list of 9 values ("", "X" or "O"). Used by
// every mode: local, the computer modes and online play.
//   options.winningLine  the three cells to highlight, or null
//   options.locked       true when no square can be played right now: no
//                        hover, no pointer cursor, and every cell reports
//                        aria-disabled. (aria-disabled, not the disabled
//                        attribute, so a focused cell keeps keyboard focus.)
// Only cells whose mark changed are touched, so marks already on the board
// don't replay their pop-in animation.
function renderBoard(values, { winningLine = null, locked = false } = {}) {
  values.forEach((value, index) => {
    const cell = cells[index];
    if (cell.textContent !== value) {
      if (value === "") {
        cell.textContent = "";
        cell.classList.remove("taken", "x", "o");
      } else {
        // Wrap the mark in a span so it can pop in (see the .mark CSS animation).
        cell.innerHTML = '<span class="mark">' + value + "</span>";
        cell.classList.remove(value === "X" ? "o" : "x");
        cell.classList.add("taken");
        cell.classList.add(value === "X" ? "x" : "o");
      }
    }
    cell.classList.toggle("win", Boolean(winningLine) && winningLine.includes(index));
    cell.setAttribute("aria-label", cellLabel(index, value));
  });
  boardEl.classList.toggle("locked", locked);
  cells.forEach((cell, index) => {
    cell.setAttribute("aria-disabled", String(locked || values[index] !== ""));
  });
}

// Redraw the local game's board. While the computer is thinking, or once the
// game is over, the whole board is locked; a finished game keeps its winning
// line highlighted.
function updateBoardState() {
  renderBoard(board, {
    winningLine: gameOver ? TicTacToeGame.findWinningLine(board) : null,
    locked: lockBoard || gameOver,
  });
}

// Tell screen reader users what just happened. The #announcer region is
// visually hidden; a no-break space is toggled on the end so that the same
// message twice in a row (e.g. two restarts) is still announced.
function announce(message) {
  const same = announcer.textContent.replace(/ $/, "") === message;
  announcer.textContent = same && !announcer.textContent.endsWith(" ") ? message + " " : message;
}

// Put a mark ("X" or "O") into a cell, both in the data and on the screen.
function placeMark(index, player) {
  board[index] = player;
  updateBoardState();
}

// Remove the big "result" styling from the status line (used when a new turn
// or a new game starts, so the turn text looks normal again).
function clearResultStyle() {
  statusText.classList.remove("result", "result-x", "result-o", "result-draw");
}

// Set the "whose turn" line, using different words for each mode.
function showTurnStatus() {
  clearResultStyle();
  if (isComputerMode()) {
    statusText.textContent = currentPlayer === "X" ? "Your turn" : "Computer thinking...";
  } else {
    statusText.textContent = "Player " + currentPlayer + "'s turn";
  }
}

// Build the win message for the given winner, depending on the mode.
function winMessage(winner) {
  if (isComputerMode()) {
    // Against the computer the human is X and the computer is O.
    return winner === "X" ? "You win!" : "Computer wins!";
  }
  return "Player " + winner + " wins!";
}

// --- Scoreboard ---

// Set the two changing labels to match the mode ("X"/"O" or "You"/"Computer").
function updateScoreLabels() {
  if (isComputerMode()) {
    scoreLabelX.textContent = "You";
    scoreLabelO.textContent = "Computer";
  } else {
    scoreLabelX.textContent = "X";
    scoreLabelO.textContent = "O";
  }
}

// Copy the score numbers onto the screen.
function renderScores() {
  scoreValueX.textContent = scores.x;
  scoreValueO.textContent = scores.o;
  scoreValueDraws.textContent = scores.draws;
}

// Zero the scores (used when a brand new mode is chosen from the menu).
function resetScores() {
  scores = { x: 0, o: 0, draws: 0 };
  renderScores();
}

// Add one to the right bucket after a game ends. Pass "X", "O", or null (draw).
function recordResult(winner) {
  if (winner === "X") {
    scores.x += 1;
  } else if (winner === "O") {
    scores.o += 1;
  } else {
    scores.draws += 1;
  }
  renderScores();
}

// Check whether the game just ended. If so, set gameOver + status and (for a
// win) highlight the winning cells. Returns true when the game is over.
function checkGameEnd() {
  const winningLine = TicTacToeGame.findWinningLine(board);
  if (winningLine) {
    gameOver = true;
    const winner = board[winningLine[0]];
    statusText.textContent = winMessage(winner);
    // Big result text, colored to match the winner (X = blue, O = pink).
    statusText.classList.add("result", winner === "X" ? "result-x" : "result-o");
    recordResult(winner);
    updateBoardState(); // highlights the winning line and locks the board
    return true;
  }

  // Board full with no winner => draw.
  if (TicTacToeGame.isBoardFull(board)) {
    gameOver = true;
    statusText.textContent = "It's a draw!";
    // Big result text in a neutral gold color.
    statusText.classList.add("result", "result-draw");
    recordResult(null);
    updateBoardState();
    return true;
  }

  return false;
}

// The computer's move: choose a cell, play O there, then hand back to the human.
function computerMove() {
  // Safety check: never move if the game is already over.
  if (gameOver) {
    lockBoard = false;
    updateBoardState();
    return;
  }

  // Ask the AI (src/ai.js) for a move and the reason behind it.
  const choice = TicTacToeAI.chooseComputerMove(gameMode, board);
  aiExplanation = choice.explanation;
  if (choice.index === null) {
    lockBoard = false;
    updateBoardState();
    return; // no empty cells left
  }

  // The computer's turn is done, so unlock the board for the human.
  // (Set before placing the mark so the board state is updated once.)
  lockBoard = false;

  placeMark(choice.index, "O");

  // Show what the AI just did (from the AI's choice). Done before the
  // game-over check so it still appears on a game-ending computer move.
  explanationEl.textContent = aiExplanation;

  const moveSummary = "Computer played " + cellPosition(choice.index) + ". " + aiExplanation;

  if (checkGameEnd()) {
    announce(moveSummary + " " + statusText.textContent);
    return;
  }

  // Hand the turn back to the human (X).
  currentPlayer = "X";
  showTurnStatus();
  announce(moveSummary + " " + statusText.textContent);
}

// Handle a click on one of the cells.
function handleCellClick(event) {
  const cell = event.currentTarget;
  const index = Number(cell.getAttribute("data-index"));

  // Online: the server decides; online-ui.js sends the move and redraws.
  if (gameMode === "online") {
    if (onlineMoveHandler) {
      onlineMoveHandler(index);
    }
    return;
  }

  // Ignore the click if the game is over, the board is locked (computer is
  // thinking), or the cell is already filled.
  if (gameOver || lockBoard || board[index] !== "") {
    return;
  }

  // Against the computer the human only ever places X.
  if (isComputerMode() && currentPlayer !== "X") {
    return;
  }

  // Against the computer, lock the board straight away (in this same click)
  // so a fast second click or key press can't sneak in another move.
  if (isComputerMode()) {
    lockBoard = true;
  }

  placeMark(index, currentPlayer);

  if (checkGameEnd()) {
    // The human's move ended the game, so the computer's last explanation
    // no longer describes what happened: clear it.
    lockBoard = false;
    explanationEl.textContent = "";
    announce(statusText.textContent);
    return;
  }

  // Switch to the other player. In computer modes this also shows
  // "Computer thinking..." (see showTurnStatus).
  currentPlayer = currentPlayer === "X" ? "O" : "X";
  showTurnStatus();
  announce(statusText.textContent);

  // Against the computer, once it is O's turn, let it move after a short,
  // slightly random pause (about 400-600ms). The board stays locked until then.
  if (isComputerMode() && currentPlayer === "O" && !gameOver) {
    const delay = 400 + Math.floor(Math.random() * 200);
    computerTimer = setTimeout(computerMove, delay);
  }
}

// Clear the board back to a fresh game (used by Restart and when entering).
function resetGame() {
  // Cancel a pending computer move so it can't land on the fresh board.
  clearTimeout(computerTimer);

  board = TicTacToeGame.createEmptyBoard();
  currentPlayer = "X";
  gameOver = false;
  lockBoard = false;

  // Clear the AI explanation at the start of each round. The note only
  // exists in computer modes, so it takes up no space in Play vs Player.
  aiExplanation = "";
  explanationEl.textContent = "";
  explanationEl.hidden = !isComputerMode();

  // Match header + difficulty badge both depend on the current mode.
  if (gameMode === "easy") {
    boardTitle.textContent = "You vs Easy AI";
  } else if (gameMode === "medium") {
    boardTitle.textContent = "You vs Medium AI";
  } else if (gameMode === "impossible") {
    boardTitle.textContent = "You vs Impossible AI";
  } else {
    boardTitle.textContent = "Player vs Player";
  }

  // Show the difficulty badge (Easy / Medium / Impossible) in computer modes.
  if (isComputerMode()) {
    difficultyBadge.textContent = gameMode.charAt(0).toUpperCase() + gameMode.slice(1);
    difficultyBadge.classList.remove("hidden");
  } else {
    difficultyBadge.classList.add("hidden");
  }

  // Keep the scoreboard labels/values in step with the mode. (Restart calls
  // resetGame, so this refreshes the display WITHOUT zeroing the scores.)
  updateScoreLabels();
  renderScores();

  showTurnStatus();

  // Local controls (Restart / Reset Score) belong to every non-online game.
  localControls.hidden = false;
  onlineControls.hidden = true;
  scoreboardEl.classList.remove("is-online");

  // Wipe the marks and any highlight off every cell.
  updateBoardState();
}

// --- The same game screen, used by online play (src/online-ui.js) ---
//
// Online play draws the board with renderBoard() above and fills in the rest
// of the screen with these small helpers. Nothing here keeps score or decides
// moves: online, the server does that.

// Switch the game screen to online mode and show it. onMove(index) is called
// when the player activates a square.
function enterOnlineBoard(onMove) {
  clearTimeout(computerTimer);
  lockBoard = false;
  gameMode = "online";
  onlineMoveHandler = onMove;
  localControls.hidden = true;
  onlineControls.hidden = false;
  // Online scores are per person (You / Opponent) and marks swap on every
  // rematch, so the score numbers drop the X / O colours (see styles.css).
  scoreboardEl.classList.add("is-online");
  explanationEl.hidden = false;
  showScreen("player-screen");
}

// Title and the small badge under it (null hides the badge).
function setBoardHeader(title, badge) {
  boardTitle.textContent = title;
  difficultyBadge.textContent = badge || "";
  difficultyBadge.classList.toggle("hidden", !badge);
}

// The turn / result line. resultMark "x", "o" or "draw" shows the big
// coloured result style; null shows a normal turn line.
function setStatusLine(text, resultMark) {
  clearResultStyle();
  statusText.textContent = text;
  if (resultMark) {
    statusText.classList.add("result", "result-" + resultMark);
  }
}

// The three score boxes: labels and numbers.
function setScoreboard(leftLabel, rightLabel, left, right, draws) {
  scoreLabelX.textContent = leftLabel;
  scoreLabelO.textContent = rightLabel;
  scoreValueX.textContent = left;
  scoreValueO.textContent = right;
  scoreValueDraws.textContent = draws;
}

// The small note under the board (used for AI explanations offline).
function setBoardNote(text) {
  explanationEl.textContent = text;
}

// Wire up the cell clicks and the buttons.
cells.forEach((cell) => cell.addEventListener("click", handleCellClick));

// Give the empty cells their labels right away.
cells.forEach((cell, index) => updateCellLabel(index));

// Restart Game: clear the board only, keeping the scoreboard.
restartButton.addEventListener("click", () => {
  resetGame();
  announce("New game. " + statusText.textContent);
});

// Reset Score: zero the scoreboard AND start a clean board, so the player gets
// a fresh game with the score back to 0.
resetScoreButton.addEventListener("click", () => {
  resetScores();
  resetGame();
  announce("Scores reset. New game. " + statusText.textContent);
});
