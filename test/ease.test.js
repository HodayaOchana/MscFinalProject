// Unit tests for CF/ease.js - EASE learns "readers of book i also read book j".
// Tiny data: books 0,1,2 are always read together; books 3,4 are always read together.
const test = require("node:test");
const assert = require("node:assert/strict");
const { gram, invertSPD, trainEASE, easeScores } = require("../CF/ease");
// trainEASE may be async (returns a Promise) - `await` works for both versions

const users = [[0, 1, 2], [0, 1, 2], [0, 1], [1, 2], [3, 4], [3, 4], [3, 4], [0, 2]].map((b) => Int32Array.from(b));
const nB = 5;

test("gram: counts how many readers read each pair (+ lambda on the diagonal)", () => {
  const G = gram(users, nB, 10);
  assert.equal(G[0 * nB + 1], 3);  // books 0 and 1 read together by 3 readers
  assert.equal(G[0 * nB + 3], 0);  // never together
  assert.equal(G[0 * nB + 0], 4 + 10); // book 0 has 4 readers
});

test("invertSPD: G times its inverse is the identity", () => {
  const G = gram(users, nB, 1);
  const P = invertSPD(Float64Array.from(G), nB);
  for (let i = 0; i < nB; i++) for (let j = 0; j < nB; j++) {
    let s = 0;
    for (let k = 0; k < nB; k++) s += G[i * nB + k] * P[k * nB + j];
    assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-9, `(${i},${j}) = ${s}`);
  }
});

test("trainEASE: positive weight inside a group, no weight to itself", async () => {
  const m = await trainEASE(users, nB, { lambda: 1, top: nB });
  const weight = (i, j) => {
    for (let k = 0; k < m.top; k++) if (m.idx[i * m.top + k] === j) return m.w[i * m.top + k];
    return 0;
  };
  assert.ok(weight(3, 4) > 0, "readers of 3 want 4");
  assert.ok(weight(0, 1) > 0, "readers of 0 want 1");
  assert.ok(weight(0, 1) > weight(0, 3), "a book of the same group beats the other group");
  for (let i = 0; i < nB; i++) assert.equal(weight(i, i), 0);
});

test("trainEASE: keeps only the top weights per book", async () => {
  const m = await trainEASE(users, nB, { lambda: 1, top: 2 });
  assert.equal(m.idx.length, nB * 2);
  assert.equal(m.w.length, nB * 2);
});

test("easeScores: a reader of book 3 gets book 4 first", async () => {
  const m = await trainEASE(users, nB, { lambda: 1, top: nB });
  const s = easeScores(m, [3], nB);
  const best = [0, 1, 2, 4].sort((a, b) => s[b] - s[a])[0];
  assert.equal(best, 4);
  const s2 = easeScores(m, [0, 1], nB);
  assert.ok(s2[2] > s2[3] && s2[2] > s2[4], "a reader of 0 and 1 gets 2, not the other group");
});
