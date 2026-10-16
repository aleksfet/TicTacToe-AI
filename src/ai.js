// Tic Tac Toe AI - the computer players
//
// The human is always X and the computer is always O.
//
// Every "choose" function takes the current board (it is never changed) and
// returns { index, explanation }:
//   - index:       the cell the computer plays (or null if the board is full)
//   - explanation: a short note about why it picked that cell
//
// Easy and Medium use randomness. They take an optional "random" function
// that works like Math.random (returns a number from 0 up to, but not
// including, 1). The game leaves it out so Math.random is used; the tests pass
// their own so the results are predictable.
//
// In the browser this file defines the global TicTacToeAI object (and needs
// game.js loaded first). In Node it is loaded with require("./ai.js").

const TicTacToeAI = ((Game) => {
  // Pick a random item from a list.
  function randomFrom(list, random) {
    return list[Math.floor(random() * list.length)];
  }

  // Easy: just pick a random empty cell.
  function chooseEasyMove(board, random = Math.random) {
    const empties = Game.getEmptyIndexes(board);
    return {
      index: empties.length > 0 ? randomFrom(empties, random) : null,
      explanation: "Easy AI picked a random open square.",
    };
  }

  // How often Medium uses its smart logic (0.65 = about 65% of the time).
  // The rest of the time it just plays a random empty square, which keeps it
  // beatable and less predictable than a perfect player.
  const MEDIUM_SMART_CHANCE = 0.65;

  // The "smart" part of Medium: a simple priority order. Each branch also
  // returns a short explanation of what it did.
  function chooseMediumSmartMove(board, random = Math.random) {
    // 1. Take an immediate win if there is one (computer is O).
    let move = Game.findCompletingMove(board, "O");
    if (move !== null) {
      return { index: move, explanation: "Medium AI found a winning move." };
    }

    // 2. Otherwise block the human (X) if they are about to win.
    move = Game.findCompletingMove(board, "X");
    if (move !== null) {
      return { index: move, explanation: "Medium AI blocked your threat." };
    }

    // 3. Take the center if it is open.
    if (board[4] === "") {
      return { index: 4, explanation: "Medium AI took the center." };
    }

    // 4. Take a random open corner.
    const openCorners = [0, 2, 6, 8].filter((i) => board[i] === "");
    if (openCorners.length > 0) {
      return { index: randomFrom(openCorners, random), explanation: "Medium AI chose a corner." };
    }

    // 5. Fall back to any random empty square.
    const empties = Game.getEmptyIndexes(board);
    return {
      index: empties.length > 0 ? randomFrom(empties, random) : null,
      explanation: "Medium AI made a random move.",
    };
  }

  // Medium: mix smart play with random play so it feels like a casual opponent.
  //   - ~65% of turns: use the smart priority logic above.
  //   - ~35% of turns: ignore strategy and just pick a random empty square.
  function chooseMediumMove(board, random = Math.random) {
    if (random() < MEDIUM_SMART_CHANCE) {
      return chooseMediumSmartMove(board, random);
    }
    return {
      index: chooseEasyMove(board, random).index, // a plain random empty square
      explanation: "Medium AI made a random move.",
    };
  }

  // --- Impossible mode: the Minimax algorithm ---

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
    const winner = Game.getWinner(state);
    if (winner === "O") {
      return 10 - depth; // computer wins (sooner is better)
    }
    if (winner === "X") {
      return depth - 10; // human wins (later is "less bad")
    }
    if (Game.isBoardFull(state)) {
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
  function chooseImpossibleMove(board) {
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

    return {
      index: bestMove,
      explanation: "Impossible AI used Minimax to search future outcomes and pick the best move.",
    };
  }

  // Pick the computer's move based on the difficulty ("easy", "medium", or
  // "impossible"). Any other mode falls back to Easy.
  function chooseComputerMove(mode, board, random = Math.random) {
    if (mode === "medium") {
      return chooseMediumMove(board, random);
    }
    if (mode === "impossible") {
      return chooseImpossibleMove(board);
    }
    return chooseEasyMove(board, random);
  }

  return {
    MEDIUM_SMART_CHANCE,
    chooseEasyMove,
    chooseMediumSmartMove,
    chooseMediumMove,
    minimax,
    chooseImpossibleMove,
    chooseComputerMove,
  };
})(typeof module !== "undefined" && module.exports ? require("./game.js") : TicTacToeGame);

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeAI;
}
