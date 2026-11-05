// "92% match" on the book cards (server/match.js). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { addMatch } = require("../server/match");

test("the best book is 99% and the others are relative to it", () => {
  const out = addMatch([{ id: 1, score: 2 }, { id: 2, score: 1 }, { id: 3, score: 0.5 }]);
  assert.deepEqual(out.map((b) => b.match), [99, 50, 25]);
});

test("new books (CBF only) are compared with each other, not with the rated ones", () => {
  const out = addMatch([{ id: 1, score: 10 }, { id: 2, score: 0.4, isNew: true }, { id: 3, score: 0.2, isNew: true }]);
  assert.deepEqual(out.map((b) => b.match), [99, 99, 50]);
});

test("no percent without evidence, never below 1%, and any score function", () => {
  const out = addMatch([{ id: 1, score: 1000 }, { id: 2, score: 1 }, { id: 3, score: 0 }, { id: 4, score: -1 }]);
  assert.deepEqual(out.map((b) => b.match), [99, 1, undefined, undefined]);
  assert.deepEqual(addMatch([{ similarity: 0.8 }, { similarity: 0.4 }], (b) => b.similarity).map((b) => b.match), [99, 50]);
});
