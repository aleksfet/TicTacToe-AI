// Tic Tac Toe AI - game logic
//
// What works so far:
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

// Check whether the game just ended. If so, set gameOver + status and (for a
// win) highlight the winning cells. Returns true when the game is over.
function checkGameEnd() {
  const winningLine = findWinningLine();
  if (winningLine) {
    gameOver = true;
    const winner = board[winningLine[0]];
    statusText.textContent = winMessage(winner);
    // Big result text, colored to match the winner (X = blue, O = pink).
    statusText.classList.add("result", winner === "X" ? "result-x" : "result-o");
    winningLine.forEach((i) => cells[i].classList.add("win"));
    return true;
  }

  // Board full with no winner => draw.
  if (board.every((value) => value !== "")) {
    gameOver = true;
    statusText.textContent = "It's a draw!";
    // Big result text in a neutral gold color.
    statusText.classList.add("result", "result-draw");
    return true;
  }

  return false;
}

// --- Helpers the computer uses to choose a move ---

// Return the indexes of every empty cell (so we only ever pick empty ones).
function emptyIndexes() {
  const result = [];
  board.forEach((value, index) => {
    if (value === "") {
      result.push(index);
    }
  });
  return result;
}

// Pick a random item from a list.
function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// If "player" has two marks in a line with the third cell empty, return that
// empty cell's index (the move that would complete the line). Otherwise null.
// Used both to find the computer's own winning move and to block the human.
function findCompletingMove(player) {
  for (const line of WINNING_LINES) {
    const marks = line.map((i) => board[i]);
    const ownCount = marks.filter((m) => m === player).length;
    const emptyCount = marks.filter((m) => m === "").length;
    if (ownCount === 2 && emptyCount === 1) {
      return line[marks.indexOf("")]; // the one empty cell in this line
    }
  }
  return null;
}

// Easy: just pick a random empty cell.
function chooseEasyMove() {
  const empties = emptyIndexes();
  return empties.length > 0 ? randomFrom(empties) : null;
}

// How often Medium uses its smart logic (0.65 = about 65% of the time).
// The rest of the time it just plays a random empty square, which keeps it
// beatable and less predictable than a perfect player.
const MEDIUM_SMART_CHANCE = 0.65;

// The "smart" part of Medium: a simple priority order.
function chooseMediumSmartMove() {
  // 1. Take an immediate win if there is one (computer is O).
  let move = findCompletingMove("O");
  if (move !== null) {
    return move;
  }

  // 2. Otherwise block the human (X) if they are about to win.
  move = findCompletingMove("X");
  if (move !== null) {
    return move;
  }

  // 3. Take the center if it is open.
  if (board[4] === "") {
    return 4;
  }

  // 4. Take a random open corner.
  const openCorners = [0, 2, 6, 8].filter((i) => board[i] === "");
  if (openCorners.length > 0) {
    return randomFrom(openCorners);
  }

  // 5. Fall back to any random empty square.
  const empties = emptyIndexes();
  return empties.length > 0 ? randomFrom(empties) : null;
}

// Medium: mix smart play with random play so it feels like a casual opponent.
//   - ~65% of turns: use the smart priority logic above.
//   - ~35% of turns: ignore strategy and just pick a random empty square.
function chooseMediumMove() {
  if (Math.random() < MEDIUM_SMART_CHANCE) {
    return chooseMediumSmartMove();
  }
  return chooseEasyMove(); // a plain random empty square
}

// --- Impossible mode: the Minimax algorithm ---

// Check a *hypothetical* board (not the real one) and return its winner:
// "X", "O", or null if nobody has three in a row yet.
function winnerOf(state) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (state[a] !== "" && state[a] === state[b] && state[a] === state[c]) {
      return state[a];
    }
  }
  return null;
}

// Minimax looks ahead at EVERY possible way the game could finish and scores it:
//   - O (the computer) tries to get the HIGHEST score  -> it "maximizes".
//   - X (the human)    tries to get the LOWEST score   -> it "minimizes".
// Scores: O win = +10, X win = -10, draw = 0. We also use "depth" (how many
// moves deep we are) so the computer prefers winning sooner and losing later.
//
// "state" is a copy of the board that we change and then change back as we try
// each possible move (this is called recursion: the function calls itself to
// explore the next move).
function minimax(state, computerToMove, depth) {
  // First, see if this imagined board is already finished.
  const winner = winnerOf(state);
  if (winner === "O") {
    return 10 - depth; // computer wins (sooner is better)
  }
  if (winner === "X") {
    return depth - 10; // human wins (later is "less bad")
  }
  if (state.every((cell) => cell !== "")) {
    return 0; // no empty cells and no winner => draw
  }

  if (computerToMove) {
    // The computer (O) wants the highest score it can reach.
    let bestScore = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (state[i] === "") {
        state[i] = "O";                                   // try this move
        const score = minimax(state, false, depth + 1);   // human replies next
        state[i] = "";                                    // undo the move
        bestScore = Math.max(bestScore, score);
      }
    }
    return bestScore;
  } else {
    // The human (X) is assumed to play their best, picking the lowest score.
    let bestScore = Infinity;
    for (let i = 0; i < 9; i++) {
      if (state[i] === "") {
        state[i] = "X";                                   // try this move
        const score = minimax(state, true, depth + 1);    // computer replies next
        state[i] = "";                                    // undo the move
        bestScore = Math.min(bestScore, score);
      }
    }
    return bestScore;
  }
}

// Impossible: try every empty cell, score it with minimax, and keep the best.
function chooseImpossibleMove() {
  const state = board.slice(); // a copy we can safely experiment on
  let bestScore = -Infinity;
  let bestMove = null;

  for (let i = 0; i < 9; i++) {
    if (state[i] === "") {
      state[i] = "O";                                 // imagine playing here
      const score = minimax(state, false, 1);         // then the human moves
      state[i] = "";                                  // undo
      if (score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }

  return bestMove;
}

// Pick the computer's move based on the current difficulty.
function chooseComputerMove() {
  if (gameMode === "medium") {
    return chooseMediumMove();
  }
  if (gameMode === "impossible") {
    return chooseImpossibleMove();
  }
  return chooseEasyMove(); // easy (and any other computer mode for now)
}

// The computer's move: choose a cell, play O there, then hand back to the human.
function computerMove() {
  // Safety check: never move if the game is already over.
  if (gameOver) {
    lockBoard = false;
    return;
  }

  const choice = chooseComputerMove();
  if (choice === null) {
    lockBoard = false;
    return; // no empty cells left
  }

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

  // Against the computer the human only ever places X.
  if (isComputerMode() && currentPlayer !== "X") {
    return;
  }

  placeMark(index, currentPlayer);

  if (checkGameEnd()) {
    return;
  }

  // Switch to the other player.
  currentPlayer = currentPlayer === "X" ? "O" : "X";
  showTurnStatus();

  // Against the computer, once it is O's turn, let it move after a short,
  // slightly random pause (about 400-600ms).
  if (isComputerMode() && currentPlayer === "O" && !gameOver) {
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
  if (gameMode === "easy") {
    boardTitle.textContent = "Play vs Computer (Easy)";
  } else if (gameMode === "medium") {
    boardTitle.textContent = "Play vs Computer (Medium)";
  } else if (gameMode === "impossible") {
    boardTitle.textContent = "Play vs Computer (Impossible)";
  } else {
    boardTitle.textContent = "Play vs Player";
  }
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
