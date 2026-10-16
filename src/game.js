// Tic Tac Toe AI - pure game rules
//
// Everything in this file works on a plain board array and never touches the
// page, so it can run both in the browser and in Node (for the tests).
//
// The board is a list of 9 strings: "", "X", or "O" (index 0..8).
//   0 | 1 | 2
//   3 | 4 | 5
//   6 | 7 | 8
//
// In the browser this file defines the global TicTacToeGame object.
// In Node it is loaded with require("./game.js").

const TicTacToeGame = (() => {
  // All eight winning lines, written as the three cell indexes that make them.
  const WINNING_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
    [0, 4, 8], [2, 4, 6],              // diagonals
  ];

  // A fresh, empty board.
  function createEmptyBoard() {
    return ["", "", "", "", "", "", "", "", ""];
  }

  // Return the winning line (array of 3 indexes) if someone has won, else null.
  function findWinningLine(board) {
    for (const line of WINNING_LINES) {
      const [a, b, c] = line;
      // All three must be non-empty AND equal to each other.
      if (board[a] !== "" && board[a] === board[b] && board[a] === board[c]) {
        return line;
      }
    }
    return null;
  }

  // Return the winner: "X", "O", or null if nobody has three in a row yet.
  function getWinner(board) {
    const line = findWinningLine(board);
    return line ? board[line[0]] : null;
  }

  // True when every cell is filled.
  function isBoardFull(board) {
    return board.every((value) => value !== "");
  }

  // A draw is a full board with no winner (a win on the last square is a win).
  function isDraw(board) {
    return isBoardFull(board) && getWinner(board) === null;
  }

  // Return the indexes of every empty cell (the legal moves).
  function getEmptyIndexes(board) {
    const result = [];
    board.forEach((value, index) => {
      if (value === "") {
        result.push(index);
      }
    });
    return result;
  }

  // If "player" has two marks in a line with the third cell empty, return that
  // empty cell's index (the move that would complete the line). Otherwise null.
  // Used both to find the computer's own winning move and to block the human.
  function findCompletingMove(board, player) {
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

  return {
    WINNING_LINES,
    createEmptyBoard,
    findWinningLine,
    getWinner,
    isBoardFull,
    isDraw,
    getEmptyIndexes,
    findCompletingMove,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeGame;
}
