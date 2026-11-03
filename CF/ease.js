/**
 * EASE - Embarrassingly Shallow Autoencoder (Steck, 2019), a CF model.
 *
 * Learns, for every pair of books (i, j), ONE weight B[i][j]: how much reading
 * book i predicts reading book j - positive ("readers of i want j") or negative
 * ("readers of i rarely want j"). All pairs are solved TOGETHER, so a pair that is
 * only "similar" because both are popular (everybody read Harry Potter) does not
 * get credit twice - that is what makes it more precise than item-item CF.
 *
 *   G = X^T X + lambda * I        X = users x books, 1 = the user read the book
 *   P = G^-1
 *   B[i][j] = -P[i][j] / P[j][j],  B[j][j] = 0
 *   score(user, j) = sum over the user's books i of B[i][j]
 *
 * Measured (03/11/2026, all goodbooks ratings, 2,000 users, validation, the split of
 * CF/experiment-to-read.js): Precision@10  ALS 21.70%  ->  EASE 25.62% (lambda 500);
 * keeping the top 100 weights per book (+ and -): 25.42%; 0.85 EASE + 0.15 ALS: 25.75%.
 *
 * The inverse is computed here in plain JavaScript (Gauss-Jordan, in place, one
 * n x n Float64Array: ~700MB for 9,500 books; n^3 steps split over all CPU cores -
 * about 35 minutes on one core, a few minutes on 8).
 */

/** G = X^T X (+ lambda on the diagonal) from per-user book index lists */
function gram(userBooks, nB, lambda, G = new Float64Array(nB * nB)) {
  for (const books of userBooks) {
    for (let a = 0; a < books.length; a++) {
      const row = books[a] * nB;
      for (let b = 0; b < books.length; b++) G[row + books[b]] += 1;
    }
  }
  for (let i = 0; i < nB; i++) G[i * nB + i] += lambda;
  return G;
}

/**
 * In-place inverse of a symmetric positive definite matrix (Gauss-Jordan without
 * pivoting - safe for SPD). Inner loops run along rows, so memory is read in order.
 */
function invertSPD(A, n, onProgress) {
  const rowP = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const po = p * n;
    const piv = A[po + p];
    // row p := row p / piv, with the pivot column becoming 1/piv
    for (let j = 0; j < n; j++) rowP[j] = A[po + j] / piv;
    rowP[p] = 1 / piv;
    for (let i = 0; i < n; i++) {
      if (i === p) continue;
      const io = i * n;
      const f = A[io + p];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) A[io + j] -= f * rowP[j];
      A[io + p] = -f / piv;
    }
    for (let j = 0; j < n; j++) A[po + j] = rowP[j];
    if (onProgress && (p + 1) % 500 === 0) onProgress(p + 1, n);
  }
  return A;
}

/**
 * The same inverse, split over all CPU cores (worker_threads + a SharedArrayBuffer):
 * every core updates its own block of rows at each pivot step, with two barriers per
 * step. ~n^3 / cores steps. `A` must be a Float64Array on a SharedArrayBuffer.
 */
function invertSPDParallel(A, n, { threads = Math.min(8, require("os").cpus().length), onProgress } = {}) {
  const { Worker } = require("worker_threads");
  if (threads < 2) return Promise.resolve(invertSPD(A, n, onProgress));
  const sync = new Int32Array(new SharedArrayBuffer(4 * 4)); // [arrived, generation, progress]
  const code = `
    const { workerData: { buf, sync, n, threads, id } } = require("worker_threads");
    const A = new Float64Array(buf), S = new Int32Array(sync);
    const rowP = new Float64Array(n);
    let gen = 0;
    const barrier = () => {
      const g = gen++;
      if (Atomics.add(S, 0, 1) === threads - 1) { Atomics.store(S, 0, 0); Atomics.store(S, 1, g + 1); Atomics.notify(S, 1); }
      else while (Atomics.load(S, 1) === g) Atomics.wait(S, 1, g);
    };
    const lo = Math.floor((n * id) / threads), hi = Math.floor((n * (id + 1)) / threads);
    for (let p = 0; p < n; p++) {
      const po = p * n, piv = A[po + p];
      for (let j = 0; j < n; j++) rowP[j] = A[po + j] / piv;
      rowP[p] = 1 / piv;
      barrier();                              // everyone has read row p
      for (let i = lo; i < hi; i++) {
        if (i === p) continue;
        const io = i * n, f = A[io + p];
        if (f === 0) continue;
        for (let j = 0; j < n; j++) A[io + j] -= f * rowP[j];
        A[io + p] = -f / piv;
      }
      if (p >= lo && p < hi) for (let j = 0; j < n; j++) A[po + j] = rowP[j];
      barrier();                              // step p done everywhere
      if (id === 0 && (p + 1) % 500 === 0) Atomics.store(S, 2, p + 1);
    }`;
  return new Promise((resolve, reject) => {
    let done = 0, lastShown = 0;
    const timer = onProgress ? setInterval(() => { const p = Atomics.load(sync, 2); if (p > lastShown) { lastShown = p; onProgress(p, n); } }, 2000) : null;
    for (let id = 0; id < threads; id++) {
      const w = new Worker(code, { eval: true, workerData: { buf: A.buffer, sync: sync.buffer, n, threads, id } });
      w.on("error", (e) => { if (timer) clearInterval(timer); reject(e); });
      w.on("exit", (c) => { if (c !== 0) return; if (++done === threads) { if (timer) clearInterval(timer); resolve(A); } });
    }
  });
}

/**
 * Train EASE and keep, for every book i, its `top` strongest weights B[i][j]
 * (by absolute value - negative weights matter too).
 * @param userBooks  array of Int32Array/arrays of book indexes (0..nB-1), one per user
 * @returns { idx: Int32Array(nB*top), w: Float32Array(nB*top), top }  (row i = book i)
 */
async function trainEASE(userBooks, nB, { lambda = 500, top = 100, onProgress, threads } = {}) {
  // the matrix lives in shared memory, so every CPU core can work on it
  const P = gram(userBooks, nB, lambda, new Float64Array(new SharedArrayBuffer(nB * nB * 8)));
  await invertSPDParallel(P, nB, { onProgress, threads });
  const idx = new Int32Array(nB * top).fill(-1);
  const w = new Float32Array(nB * top);
  const diag = new Float64Array(nB);
  for (let j = 0; j < nB; j++) diag[j] = P[j * nB + j];
  const vals = new Float64Array(nB);
  const absSorted = new Float64Array(nB);
  const k = Math.min(top, nB - 1);
  for (let i = 0; i < nB; i++) {
    const io = i * nB;
    for (let j = 0; j < nB; j++) { vals[j] = j === i ? 0 : -P[io + j] / diag[j]; absSorted[j] = Math.abs(vals[j]); }
    absSorted.sort(); // native numeric sort - the `top` strongest are at the end
    const cut = absSorted[nB - k];
    let n = 0;
    for (let j = 0; j < nB && n < k; j++) if (j !== i && Math.abs(vals[j]) >= cut) { idx[i * top + n] = j; w[i * top + n] = vals[j]; n++; }
  }
  return { idx, w, top };
}

/** scores of all books for a user who read `books` (indexes) */
function easeScores(model, books, nB) {
  const s = new Float64Array(nB);
  const { idx, w, top } = model;
  for (const i of books) {
    for (let k = 0; k < top; k++) { const j = idx[i * top + k]; if (j >= 0) s[j] += w[i * top + k]; }
  }
  return s;
}

module.exports = { gram, invertSPD, invertSPDParallel, trainEASE, easeScores };
