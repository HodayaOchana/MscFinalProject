// Unit tests for CF/als.js - ALS learns a vector per reader and per book;
// score = reader vector . book vector. Two separate groups of readers and books.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, trainALS, foldInUser, gram, toVectorLiteral } = require("../CF/als");

// readers 0-3 read books 0-2, readers 4-7 read books 3-5; reader 0 has not read book 2, reader 4 not book 5
const pairs = [];
for (let u = 0; u < 4; u++) for (let b = 0; b < 3; b++) if (!(u === 0 && b === 2)) pairs.push([u, b, 5]);
for (let u = 4; u < 8; u++) for (let b = 3; b < 6; b++) if (!(u === 4 && b === 5)) pairs.push([u, b, 4]);
const uIdx = Int32Array.from(pairs, (p) => p[0]);
const bIdx = Int32Array.from(pairs, (p) => p[1]);
const vals = Float32Array.from(pairs, (p) => p[2]);
const nU = 8, nB = 6, f = 4;
const opts = { factors: f, iters: 15, cgSteps: 4 };
const dot = (A, i, B, j) => { let s = 0; for (let a = 0; a < f; a++) s += A[i * f + a] * B[j * f + a]; return s; };

test("the settings that were measured and chosen", () => {
  assert.deepEqual(DEFAULTS, { factors: 128, alpha: 10, reg: 0.1, iters: 10, cgSteps: 3, seed: 42 });
});

test("trainALS: returns vectors of the right size", () => {
  const { X, Y, f: ff } = trainALS(uIdx, bIdx, vals, nU, nB, opts);
  assert.equal(ff, f);
  assert.equal(X.length, nU * f);
  assert.equal(Y.length, nB * f);
  assert.ok([...X, ...Y].every(Number.isFinite));
});

test("trainALS: the missing book of the reader's own group scores higher than the other group's", () => {
  const { X, Y } = trainALS(uIdx, bIdx, vals, nU, nB, opts);
  assert.ok(dot(X, 0, Y, 2) > dot(X, 0, Y, 5), "reader 0: book 2 > book 5");
  assert.ok(dot(X, 4, Y, 5) > dot(X, 4, Y, 2), "reader 4: book 5 > book 2");
});

test("trainALS: same seed, same model (repeatable runs)", () => {
  const a = trainALS(uIdx, bIdx, vals, nU, nB, opts);
  const b = trainALS(uIdx, bIdx, vals, nU, nB, opts);
  assert.deepEqual(Array.from(a.Y), Array.from(b.Y));
});

test("foldInUser: a new reader who rated books 3,4 is closest to book 5", () => {
  const { Y } = trainALS(uIdx, bIdx, vals, nU, nB, opts);
  const YtY = gram(Y, nB, f);
  const vec = (j) => Array.from(Y.slice(j * f, j * f + f));
  const x = foldInUser(YtY, [{ vector: vec(3), rating: 5 }, { vector: vec(4), rating: 5 }], f, DEFAULTS.alpha, DEFAULTS.reg);
  const score = (j) => vec(j).reduce((s, v, a) => s + v * x[a], 0);
  assert.ok(score(5) > score(0) && score(5) > score(1) && score(5) > score(2));
});

test("toVectorLiteral: the pgvector text format", () => {
  assert.equal(toVectorLiteral([1, 0.5, -2]), "[1.000000,0.5000000,-2.000000]");
});
