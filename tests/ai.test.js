// Tests for the computer players in src/ai.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../src/game.js");
const AI = require("../src/ai.js");
const { board, seededRandom, fixedRandom } = require("./helpers.js");

// Every position the computer (O) can face in a real game: the human (X)
// always moves first, so O is to move when X has one more mark than O and
// nobody has won yet. Built by playing out every legal sequence of moves.
function allComputerTurnPositions() {
  const seen = new Map();
  function explore(b, player) {
    if (Game.getWinner(b) || Game.isBoardFull(b)) {
      return;
    }
    if (player === "O") {
      const key = b.join(",");
      if (seen.has(key)) {
        return;
      }
      seen.set(key, b.slice());
    }
    for (const i of Game.getEmptyIndexes(b)) {
      b[i] = player;
      explore(b, player === "X" ? "O" : "X");
      b[i] = "";
    }
  }
  explore(Game.createEmptyBoard(), "X");
  return [...seen.values()];
}

const POSITIONS = allComputerTurnPositions();

function assertLegal(b, index, label) {
  assert.ok(Number.isInteger(index) && index >= 0 && index <= 8, `${label}: index ${index}`);
  assert.equal(b[index], "", `${label}: cell ${index} is already taken on ${b}`);
}

test("the computer faces a non-trivial number of distinct positions", () => {
  assert.ok(POSITIONS.length > 1000, `only ${POSITIONS.length} positions`);
});

// --- Easy ---

test("Easy only chooses an empty square in every reachable position", () => {
  const random = seededRandom(1);
  for (const b of POSITIONS) {
    for (let k = 0; k < 5; k++) {
      assertLegal(b, AI.chooseEasyMove(b, random).index, "easy");
    }
  }
});

test("Easy never overwrites a mark, even at the extremes of the random range", () => {
  for (const b of POSITIONS) {
    for (const r of [0, 0.5, 0.999999]) {
      const before = b.slice();
      assertLegal(b, AI.chooseEasyMove(b, () => r).index, "easy");
      assert.deepEqual(b, before, "Easy must not change the board it is given");
    }
  }
});

test("Easy can pick any empty square", () => {
  const b = board("X.. ... ...");
  const picked = new Set();
  const random = seededRandom(7);
  for (let k = 0; k < 500; k++) {
    picked.add(AI.chooseEasyMove(b, random).index);
  }
  assert.deepEqual([...picked].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("Easy returns null on a full board", () => {
  assert.equal(AI.chooseEasyMove(board("XOX XOO OXX")).index, null);
});

// --- Medium ---

const FORCE_SMART = () => 0; // 0 < 0.65, so the smart branch always runs

test("Medium only chooses legal moves in every reachable position", () => {
  const random = seededRandom(2);
  for (const b of POSITIONS) {
    for (let k = 0; k < 5; k++) {
      assertLegal(b, AI.chooseMediumMove(b, random).index, "medium");
    }
  }
});

test("Medium (smart branch) takes an immediate win", () => {
  // O can win at 5 (row 3-4-5). X also threatens at 2, but winning comes first.
  const b = board("XX. OO. X..");
  const choice = AI.chooseMediumMove(b, FORCE_SMART);
  assert.equal(choice.index, 5);
  assert.equal(choice.explanation, "Medium AI found a winning move.");
});

test("Medium (smart branch) blocks an immediate human win", () => {
  const b = board("XX. .O. ...");
  const choice = AI.chooseMediumMove(b, FORCE_SMART);
  assert.equal(choice.index, 2);
  assert.equal(choice.explanation, "Medium AI blocked your threat.");
});

test("Medium (smart branch) takes the center when there is no win or block", () => {
  for (const first of [0, 1, 2, 3, 5, 6, 7, 8]) {
    const b = Game.createEmptyBoard();
    b[first] = "X";
    const choice = AI.chooseMediumMove(b, FORCE_SMART);
    assert.equal(choice.index, 4, `X opened at ${first}`);
    assert.equal(choice.explanation, "Medium AI took the center.");
  }
});

test("Medium (smart branch) picks an open corner when the center is taken", () => {
  const b = board("... .X. ...");
  const picked = new Set();
  for (const r of [0, 0.3, 0.6, 0.99]) {
    // First value forces the smart branch, second picks the corner.
    const choice = AI.chooseMediumMove(b, fixedRandom(0, r));
    assert.equal(choice.explanation, "Medium AI chose a corner.");
    picked.add(choice.index);
  }
  assert.deepEqual([...picked].sort(), [0, 2, 6, 8]);
});

test("Medium (smart branch) falls back to a random square when no corner is open", () => {
  // Center and all corners taken, no wins or threats: only edges remain.
  const b = board("X.O OXX X.O");
  // No completing moves for either side here.
  assert.equal(Game.findCompletingMove(b, "O"), null);
  assert.equal(Game.findCompletingMove(b, "X"), null);
  const choice = AI.chooseMediumMove(b, FORCE_SMART);
  assert.ok([1, 7].includes(choice.index));
  assert.equal(choice.explanation, "Medium AI made a random move.");
});

test("Medium uses its smart logic below 0.65 and plays randomly from 0.65 up", () => {
  assert.equal(AI.MEDIUM_SMART_CHANCE, 0.65);
  const b = board("XX. .O. ...");
  // 0.649 -> smart -> blocks at 2.
  assert.equal(AI.chooseMediumMove(b, fixedRandom(0.649, 0)).index, 2);
  // 0.65 -> random branch, which ignores the threat: the second value (0.99)
  // picks the last of the 6 empty cells, 8.
  const randomChoice = AI.chooseMediumMove(b, fixedRandom(0.65, 0.99));
  assert.equal(randomChoice.explanation, "Medium AI made a random move.");
  assert.equal(randomChoice.index, 8);
});

test("Medium's random branch still produces legal moves everywhere", () => {
  const random = seededRandom(3);
  for (const b of POSITIONS) {
    const before = b.slice();
    // First call forces the random branch; later calls are seeded.
    let first = true;
    const forceRandomBranch = () => (first ? ((first = false), 0.9) : random());
    const choice = AI.chooseMediumMove(b, forceRandomBranch);
    assert.equal(choice.explanation, "Medium AI made a random move.");
    assertLegal(b, choice.index, "medium random");
    assert.deepEqual(b, before, "Medium must not change the board it is given");
  }
});

test("Medium smart branch never misses a win or a needed block", () => {
  for (const b of POSITIONS) {
    const win = Game.findCompletingMove(b, "O");
    const block = Game.findCompletingMove(b, "X");
    const choice = AI.chooseMediumSmartMove(b, () => 0);
    if (win !== null) {
      assert.equal(choice.index, win);
    } else if (block !== null) {
      assert.equal(choice.index, block);
    }
  }
});

// --- Impossible (Minimax) ---

test("Impossible only chooses legal moves and never changes the board it is given", () => {
  for (const b of POSITIONS) {
    const before = b.slice();
    assertLegal(b, AI.chooseImpossibleMove(b).index, "impossible");
    assert.deepEqual(b, before);
  }
});

test("Impossible takes an immediate win instead of blocking", () => {
  // O wins at 5; X also threatens at 2.
  assert.equal(AI.chooseImpossibleMove(board("XX. OO. X..")).index, 5);
});

test("Impossible always takes an immediate win when one exists", () => {
  let checked = 0;
  for (const b of POSITIONS) {
    if (Game.findCompletingMove(b, "O") !== null) {
      const after = b.slice();
      after[AI.chooseImpossibleMove(b).index] = "O";
      assert.equal(Game.getWinner(after), "O", `missed a win on ${b}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("Impossible always blocks a single immediate threat when it cannot win", () => {
  let checked = 0;
  for (const b of POSITIONS) {
    if (Game.findCompletingMove(b, "O") !== null) {
      continue;
    }
    // Every cell where X could win on its next move.
    const threats = Game.getEmptyIndexes(b).filter((i) => {
      const t = b.slice();
      t[i] = "X";
      return Game.getWinner(t) === "X";
    });
    if (threats.length === 1) {
      assert.equal(AI.chooseImpossibleMove(b).index, threats[0], `did not block on ${b}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("Impossible blocks a forced immediate loss", () => {
  assert.equal(AI.chooseImpossibleMove(board("XX. .O. ...")).index, 2);
  assert.equal(AI.chooseImpossibleMove(board("X.. .O. X..")).index, 3);
});

test("Impossible answers a corner opening with the center", () => {
  for (const corner of [0, 2, 6, 8]) {
    const b = Game.createEmptyBoard();
    b[corner] = "X";
    assert.equal(AI.chooseImpossibleMove(b).index, 4);
  }
});

test("Impossible returns null on a full board", () => {
  assert.equal(AI.chooseImpossibleMove(board("XOX XOO OXX")).index, null);
});

test("minimax scores finished boards: O win > draw > X win, faster wins score higher", () => {
  assert.equal(AI.minimax(board("OOO XX. X.."), false, 1), 9);
  assert.equal(AI.minimax(board("OOO XX. X.."), false, 3), 7);
  assert.equal(AI.minimax(board("XXX OO. ..."), true, 1), -9);
  assert.equal(AI.minimax(board("XOX XOO OXX"), true, 9), 0);
});

test("perfect play from an empty board is a draw", () => {
  assert.equal(AI.minimax(Game.createEmptyBoard(), false, 0), 0);
});

// Play out EVERY legal sequence of human (X) moves against the real
// Impossible strategy. The human moves first and may choose any empty cell;
// the computer always replies with chooseImpossibleMove. Each finished game
// is counted.
function exploreAllGamesAgainstImpossible() {
  const results = { games: 0, aiWins: 0, draws: 0, humanWins: 0, illegalMoves: 0 };

  function humanTurn(b) {
    for (const i of Game.getEmptyIndexes(b)) {
      b[i] = "X";
      if (Game.getWinner(b) === "X") {
        results.games++;
        results.humanWins++;
      } else if (Game.isBoardFull(b)) {
        results.games++;
        results.draws++;
      } else {
        computerTurn(b);
      }
      b[i] = "";
    }
  }

  function computerTurn(b) {
    const move = AI.chooseImpossibleMove(b).index;
    if (move === null || b[move] !== "") {
      results.illegalMoves++;
      return;
    }
    b[move] = "O";
    if (Game.getWinner(b) === "O") {
      results.games++;
      results.aiWins++;
    } else if (Game.isBoardFull(b)) {
      results.games++;
      results.draws++;
    } else {
      humanTurn(b);
    }
    b[move] = "";
  }

  humanTurn(Game.createEmptyBoard());
  return results;
}

test("exhaustive: no legal sequence of human moves can beat Impossible", (t) => {
  const r = exploreAllGamesAgainstImpossible();
  t.diagnostic(
    `games=${r.games} aiWins=${r.aiWins} draws=${r.draws} humanWins=${r.humanWins} illegal=${r.illegalMoves}`
  );
  assert.equal(r.humanWins, 0, "the human must never win");
  assert.equal(r.illegalMoves, 0);
  assert.equal(r.games, r.aiWins + r.draws);
  // Matches the pre-refactor audit exactly (the strategy is deterministic).
  assert.deepEqual(
    { games: r.games, aiWins: r.aiWins, draws: r.draws },
    { games: 569, aiWins: 386, draws: 183 }
  );
});

// --- The dispatcher the browser calls ---

test("chooseComputerMove routes each difficulty to the right strategy", () => {
  const b = board("XX. .O. ...");
  assert.equal(AI.chooseComputerMove("easy", b, () => 0).explanation, "Easy AI picked a random open square.");
  assert.equal(AI.chooseComputerMove("medium", b, () => 0).explanation, "Medium AI blocked your threat.");
  assert.deepEqual(AI.chooseComputerMove("impossible", b), {
    index: 2,
    explanation: "Impossible AI used Minimax to search future outcomes and pick the best move.",
  });
});
