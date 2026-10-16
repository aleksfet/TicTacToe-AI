// Small helpers shared by the test files.

// Build a board from a readable string. "." is an empty cell; spaces are
// ignored, so a board can be written one row at a time:
//   board("XO. .X. ..O")
function board(text) {
  const cells = text.replace(/\s/g, "").split("");
  if (cells.length !== 9) {
    throw new Error("A board needs exactly 9 cells: " + text);
  }
  return cells.map((c) => (c === "." ? "" : c));
}

// A seeded random number generator (mulberry32). It works like Math.random
// but always produces the same sequence for the same seed, so tests that use
// randomness are repeatable.
function seededRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A "random" function that returns the given values in order, then repeats
// the last one. Handy for forcing a particular branch.
function fixedRandom(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

module.exports = { board, seededRandom, fixedRandom };
