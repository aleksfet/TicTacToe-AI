// Tic Tac Toe AI - game logic
//
// What works so far:
//   - Screen switching (start menu <-> difficulty menu <-> the board).
//   - Play vs Player: two humans take turns on the board.
//   - Play vs Computer (Easy): you are X, the computer is O and plays a
//     random empty cell after a short "thinking" pause.
//
// Not built yet: Medium AI and Impossible (minimax) AI.

// ---------------------------------------------------------------------------
// Screen switching
//
//   - The page has several <section class="screen"> blocks.
//   - Only one is visible; the rest have the "hidden" class.
//   - Any button with a data-target attribute, when clicked, hides every
//     screen and then shows the screen whose id matches that data-target.
//   - A button can also carry data-mode ("player" or "easy") to say which
//     kind of game to start when it opens the board.
// ---------------------------------------------------------------------------

const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll("[data-target]");

// Show one screen by id and hide all the others.
function showScreen(screenId) {
  // Cancel any pending computer move so it can't fire on another screen.
  clearTimeout(computerTimer);

  screens.forEach((screen) => {
    screen.classList.add("hidden");
  });

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("hidden");
  }

  // Opening the board should always begin a fresh game.
  if (screenId === "player-screen") {
    resetGame();
  }
}

// When a button is clicked, optionally set the game mode, then switch screens.
navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.getAttribute("data-mode");
    if (mode) {
      gameMode = mode;   // "player" or "easy" (set before the board resets)
    }
    const targetId = button.getAttribute("data-target");
    showScreen(targetId);
  });
});

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

// Grab the parts of the board screen we need to read or update.
const cells = document.querySelectorAll(".cell");
const statusText = document.getElementById("status");
const boardTitle = document.getElementById("board-title");
const restartButton = document.getElementById("restart");

// The board is a list of 9 strings: "", "X", or "O" (index 0..8).
//   0 | 1 | 2
//   3 | 4 | 5
//   6 | 7 | 8
let board = ["", "", "", "", "", "", "", "", ""];
let currentPlayer = "X";   // X always goes first
let gameOver = false;      // becomes true once someone wins or it's a draw

// "player" = two humans. "easy" = human is X, computer is O (random moves).
let gameMode = "player";

// While the computer is "thinking", we lock the board so the human can't move.
let lockBoard = false;

// Remembers the pending "computer thinking" timer so we can cancel it if the
// player restarts or leaves before the computer has moved.
let computerTimer = null;

// All eight winning lines, written as the three cell indexes that make them.
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
  [0, 4, 8], [2, 4, 6],              // diagonals
];

// Return the winning line (array of 3 indexes) if someone has won, else null.
function findWinningLine() {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    // All three must be non-empty AND equal to each other.
    if (board[a] !== "" && board[a] === board[b] && board[a] === board[c]) {
      return line;
    }
  }
  return null;
}

// Put a mark ("X" or "O") into a cell, both in the data and on the screen.
function placeMark(index, player) {
  board[index] = player;
  const cell = cells[index];
  cell.textContent = player;
  cell.classList.add("taken");
  cell.classList.add(player === "X" ? "x" : "o");
}

// Set the "whose turn" line, using different words for each mode.
function showTurnStatus() {
  if (gameMode === "easy") {
    statusText.textContent = currentPlayer === "X" ? "Your turn" : "Computer thinking...";
  } else {
    statusText.textContent = "Player " + currentPlayer + "'s turn";
  }
}

// Build the win message for the given winner, depending on the mode.
function winMessage(winner) {
  if (gameMode === "easy") {
    // In easy mode the human is X and the computer is O.
    return winner === "X" ? "You win!" : "Computer wins!";
  }
  return "Player " + winner + " wins!";
}

// Check whether the game just ended. If so, set gameOver + status and (for a
// win) highlight the winning cells. Returns true when the game is over.
function checkGameEnd() {
  const winningLine = findWinningLine();
  if (winningLine) {
    gameOver = true;
    statusText.textContent = winMessage(board[winningLine[0]]);
    winningLine.forEach((i) => cells[i].classList.add("win"));
    return true;
  }

  // Board full with no winner => draw.
  if (board.every((value) => value !== "")) {
    gameOver = true;
    statusText.textContent = "It's a draw!";
    return true;
  }

  return false;
}

// The computer's (Easy) move: pick a random empty cell and play O there.
function computerMove() {
  // Safety checks: never move if the game is already over.
  if (gameOver) {
    lockBoard = false;
    return;
  }

  // Collect the indexes of all empty cells, so we only ever pick an empty one.
  const emptyCells = [];
  board.forEach((value, index) => {
    if (value === "") {
      emptyCells.push(index);
    }
  });

  if (emptyCells.length === 0) {
    lockBoard = false;
    return;
  }

  // Choose one of the empty cells at random.
  const choice = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  placeMark(choice, "O");

  // The computer's turn is done, so unlock the board for the human.
  lockBoard = false;

  if (checkGameEnd()) {
    return;
  }

  // Hand the turn back to the human (X).
  currentPlayer = "X";
  showTurnStatus();
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

  // In easy mode the human only ever places X.
  if (gameMode === "easy" && currentPlayer !== "X") {
    return;
  }

  placeMark(index, currentPlayer);

  if (checkGameEnd()) {
    return;
  }

  // Switch to the other player.
  currentPlayer = currentPlayer === "X" ? "O" : "X";
  showTurnStatus();

  // In easy mode, once it is the computer's turn (O), let it move after a
  // short, slightly random pause (about 400-600ms).
  if (gameMode === "easy" && currentPlayer === "O" && !gameOver) {
    lockBoard = true;
    statusText.textContent = "Computer thinking...";
    const delay = 400 + Math.floor(Math.random() * 200);
    computerTimer = setTimeout(computerMove, delay);
  }
}

// Clear the board back to a fresh game (used by Restart and when entering).
function resetGame() {
  // Cancel a pending computer move so it can't land on the fresh board.
  clearTimeout(computerTimer);

  board = ["", "", "", "", "", "", "", "", ""];
  currentPlayer = "X";
  gameOver = false;
  lockBoard = false;

  // Title and status both depend on the current mode.
  boardTitle.textContent = gameMode === "easy" ? "Play vs Computer (Easy)" : "Play vs Player";
  showTurnStatus();

  // Wipe the marks and any highlight/color classes off every cell.
  cells.forEach((cell) => {
    cell.textContent = "";
    cell.classList.remove("taken", "x", "o", "win");
  });
}

// Wire up the cell clicks and the Restart button.
cells.forEach((cell) => cell.addEventListener("click", handleCellClick));
restartButton.addEventListener("click", resetGame);
