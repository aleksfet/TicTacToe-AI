// Tic Tac Toe AI - game logic
//
// What works so far:
//   - Screen switching (start menu <-> placeholder screens <-> the board).
//   - A playable two-player game on the board (Play vs Player).
//
// Not built yet: computer AI and the Easy/Medium/Impossible difficulty logic.

// ---------------------------------------------------------------------------
// Screen switching
//
//   - The page has several <section class="screen"> blocks.
//   - Only one is visible; the rest have the "hidden" class.
//   - Any button with a data-target attribute, when clicked, hides every
//     screen and then shows the screen whose id matches that data-target.
// ---------------------------------------------------------------------------

const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll("[data-target]");

// Show one screen by id and hide all the others.
function showScreen(screenId) {
  screens.forEach((screen) => {
    screen.classList.add("hidden");
  });

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("hidden");
  }

  // Starting "Play vs Player" should always begin a fresh game.
  if (screenId === "player-screen") {
    resetGame();
  }
}

// When a button is clicked, switch to the screen it points at.
navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-target");
    showScreen(targetId);
  });
});

// ---------------------------------------------------------------------------
// The two-player game
// ---------------------------------------------------------------------------

// Grab the parts of the board screen we need to read or update.
const cells = document.querySelectorAll(".cell");
const statusText = document.getElementById("status");
const restartButton = document.getElementById("restart");

// The board is a list of 9 strings: "", "X", or "O" (index 0..8).
//   0 | 1 | 2
//   3 | 4 | 5
//   6 | 7 | 8
let board = ["", "", "", "", "", "", "", "", ""];
let currentPlayer = "X";   // X always goes first
let gameOver = false;      // becomes true once someone wins or it's a draw

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

// Handle a click on one of the cells.
function handleCellClick(event) {
  const cell = event.currentTarget;
  const index = Number(cell.getAttribute("data-index"));

  // Ignore the click if the game is over or the cell is already filled.
  if (gameOver || board[index] !== "") {
    return;
  }

  // Place the current player's mark in the data and on the screen.
  board[index] = currentPlayer;
  cell.textContent = currentPlayer;
  cell.classList.add("taken");
  cell.classList.add(currentPlayer === "X" ? "x" : "o");

  // Did that move end the game?
  const winningLine = findWinningLine();
  if (winningLine) {
    gameOver = true;
    statusText.textContent = "Player " + currentPlayer + " wins!";
    // Highlight the three winning cells.
    winningLine.forEach((i) => cells[i].classList.add("win"));
    return;
  }

  // If the board is full with no winner, it's a draw.
  if (board.every((value) => value !== "")) {
    gameOver = true;
    statusText.textContent = "It's a draw!";
    return;
  }

  // Otherwise switch players and update the status line.
  currentPlayer = currentPlayer === "X" ? "O" : "X";
  statusText.textContent = "Player " + currentPlayer + "'s turn";
}

// Clear the board back to a fresh game (used by Restart and when entering).
function resetGame() {
  board = ["", "", "", "", "", "", "", "", ""];
  currentPlayer = "X";
  gameOver = false;
  statusText.textContent = "Player X's turn";

  // Wipe the marks and any highlight/color classes off every cell.
  cells.forEach((cell) => {
    cell.textContent = "";
    cell.classList.remove("taken", "x", "o", "win");
  });
}

// Wire up the cell clicks and the Restart button.
cells.forEach((cell) => cell.addEventListener("click", handleCellClick));
restartButton.addEventListener("click", resetGame);
