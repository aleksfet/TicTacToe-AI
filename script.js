// Tic Tac Toe AI - browser UI
//
// This file handles the page: screens, themes, clicks, the scoreboard and the
// "Computer thinking..." pause. The game rules live in src/game.js and the
// computer players live in src/ai.js (both load before this file).
//
// Features:
//   - Screen switching (start menu <-> difficulty menu <-> the board).
//   - Play vs Player: two humans take turns on the board.
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
  if (screenId === "player-screen" || fromId === "player-screen") {
    resetGame();
  }
  if (screenId === "player-screen") {
    announce("New game. " + statusText.textContent);
  }

  if (target) {
    moveFocusInto(target, fromId);
  }
}

// Where keyboard focus goes after a screen switch:
//   - back on the start menu: the button that led away from it, so a keyboard
//     user picks up where they left off;
//   - anywhere else: the new screen's heading (it has tabindex="-1" so it can
//     take focus without becoming a Tab stop).
function moveFocusInto(screen, fromId) {
  if (screen.id === "start-screen" && fromId) {
    let selector = '[data-target="computer-screen"]';
    if (fromId === "how-screen") {
      selector = '[data-target="how-screen"]';
    } else if (fromId === "player-screen" && gameMode === "player") {
      selector = '[data-mode="player"]';
    }
    const button = screen.querySelector(selector);
    if (button) {
      button.focus();
      return;
    }
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

// Holds the most recent "why the computer moved" text, from the AI's choice.
let aiExplanation = "";

// Scoreboard pieces: the two labels that change per mode, and the three values.
const scoreLabelX = document.getElementById("score-label-x");
const scoreLabelO = document.getElementById("score-label-o");
const scoreValueX = document.getElementById("score-x");
const scoreValueO = document.getElementById("score-o");
const scoreValueDraws = document.getElementById("score-draws");

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
let gameMode = "player";

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
function updateCellLabel(index) {
  const value = board[index] === "" ? "empty" : board[index];
  cells[index].setAttribute("aria-label", cellPosition(index) + ", " + value);
}

// Mark the board as playable or not. While the computer is thinking, or once
// the game is over, the whole board is "locked": no hover, no pointer cursor,
// and every cell reports aria-disabled. (aria-disabled, not the disabled
// attribute, so a focused cell keeps keyboard focus.)
function updateBoardState() {
  const locked = lockBoard || gameOver;
  boardEl.classList.toggle("locked", locked);
  cells.forEach((cell, index) => {
    cell.setAttribute("aria-disabled", String(locked || board[index] !== ""));
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
  const cell = cells[index];
  // Wrap the mark in a span so it can pop in (see the .mark CSS animation).
  cell.innerHTML = '<span class="mark">' + player + "</span>";
  cell.classList.add("taken");
  cell.classList.add(player === "X" ? "x" : "o");
  updateCellLabel(index);
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
    winningLine.forEach((i) => cells[i].classList.add("win"));
    recordResult(winner);
    updateBoardState();
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

  // Wipe the marks and any highlight/color classes off every cell.
  cells.forEach((cell, index) => {
    cell.textContent = "";
    cell.classList.remove("taken", "x", "o", "win");
    updateCellLabel(index);
  });
  updateBoardState();
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
