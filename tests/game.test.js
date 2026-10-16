// Tests for the pure game rules in src/game.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../src/game.js");
const { board } = require("./helpers.js");

test("there are exactly 8 winning lines: 3 rows, 3 columns, 2 diagonals", () => {
  assert.deepEqual(Game.WINNING_LINES, [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ]);
});

test("every winning line is detected for X and for O", () => {
  for (const line of Game.WINNING_LINES) {
    for (const player of ["X", "O"]) {
      const b = Game.createEmptyBoard();
      line.forEach((i) => (b[i] = player));
      assert.deepEqual(Game.findWinningLine(b), line, `${player} on ${line}`);
      assert.equal(Game.getWinner(b), player);
      assert.equal(Game.isDraw(b), false);
    }
  }
});

test("X win is detected in a real game position", () => {
  const b = board("XXX OO. ...");
  assert.equal(Game.getWinner(b), "X");
  assert.deepEqual(Game.findWinningLine(b), [0, 1, 2]);
});

test("O win is detected in a real game position", () => {
  const b = board("XXO .O. OX.");
  assert.equal(Game.getWinner(b), "O");
  assert.deepEqual(Game.findWinningLine(b), [2, 4, 6]);
});

test("a full board with no three in a row is a draw", () => {
  const b = board("XOX XOO OXX");
  assert.equal(Game.getWinner(b), null);
  assert.equal(Game.isBoardFull(b), true);
  assert.equal(Game.isDraw(b), true);
});

test("an unfinished board has no winner and is not a draw", () => {
  for (const b of [Game.createEmptyBoard(), board("XO. .X. ..O"), board("XOX XOO OX.")]) {
    assert.equal(Game.getWinner(b), null);
    assert.equal(Game.findWinningLine(b), null);
    assert.equal(Game.isBoardFull(b), false);
    assert.equal(Game.isDraw(b), false);
  }
});

test("a win on the final square counts as a win, not a draw", () => {
  // X fills the last empty cell (index 8) and completes the 2-5-8 column.
  const b = board("OXX XOX OOX");
  assert.equal(Game.isBoardFull(b), true);
  assert.equal(Game.getWinner(b), "X");
  assert.equal(Game.isDraw(b), false);
});

test("getEmptyIndexes lists exactly the legal moves", () => {
  assert.deepEqual(Game.getEmptyIndexes(Game.createEmptyBoard()), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(Game.getEmptyIndexes(board("XO. .X. ..O")), [2, 3, 5, 6, 7]);
  assert.deepEqual(Game.getEmptyIndexes(board("XOX XOO OXX")), []);
});

test("findCompletingMove finds the empty cell that completes two in a row", () => {
  assert.equal(Game.findCompletingMove(board("XX. ... O.O"), "X"), 2);
  assert.equal(Game.findCompletingMove(board("XX. ... O.O"), "O"), 7);
  assert.equal(Game.findCompletingMove(board("X.. .O. ..."), "X"), null);
  // A line that is already blocked is not a threat.
  assert.equal(Game.findCompletingMove(board("XXO ... ..."), "X"), null);
});

test("createEmptyBoard returns a new array each time", () => {
  const a = Game.createEmptyBoard();
  const b = Game.createEmptyBoard();
  a[0] = "X";
  assert.equal(b[0], "");
});
