/**
 * Experiment (step 1 of the improvement plan, 02/11/2026): does goodbooks
 * to_read.csv ("want to read", 912,705 rows) help the ALS model?
 *
 * Reads the goodbooks FILES directly (no database), same method as
 * evaluate.js --validation: 2,000 test users with >= 20 ratings, per user
 * [20% test | 20% validation | rest train], measured on VALIDATION, relevant =
 * hidden books rated 4-5. ALS 128 factors, alpha 10, lambda 0.1, 10 iterations.
 * to_read rows enter ALS as a weak "rating" (value v -> confidence 1 + 10 * v / 5).
 * Every variant hides the user's to_read books from the recommendations (as the
 * app hides TBR books), so the comparison is fair.
 *
 * Run (from the project folder, files from github.com/zygmuntz/goodbooks-10k):
 *   node CF/experiment-to-read.js data/goodbooks/ratings.csv data/goodbooks/to_read.csv --values 0,1,2.5
 *   ... --cold 5      new users (5 known ratings)
 *   ... --seed 7      another ALS random start (checks the result is not luck)
 *   ... --test        measure on the TEST part (once, for the report)
 *
 * RESULTS: see CF/retrain.js (TO_READ_VALUE) and the progress report.
 */
const fs = require("fs");
const path = require("path");
const { trainALS } = require(path.join(__dirname, "als"));

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const N_USERS = Number(arg("--users", 2000)), K = 10, HOLD = 0.2, MIN = 20, LIKED = 4;
const VALUES = arg("--values", "0,1,2.5").split(",").map(Number); // 0 = no to_read (baseline)
const COLD = Number(arg("--cold", 0));
const TEST = process.argv.includes("--test");

function seededRandom(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const rand = seededRandom(42);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const readCsv = (f) => fs.readFileSync(f, "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
const ratings = readCsv(process.argv[2]);
const toRead = readCsv(process.argv[3]);
let nU = 0, nB = 0;
for (const [u, b] of ratings) { nU = Math.max(nU, u + 1); nB = Math.max(nB, b + 1); }
for (const [u, b] of toRead) { nU = Math.max(nU, u + 1); nB = Math.max(nB, b + 1); }

const byUser = new Map();
for (const [u, b, r] of ratings) { if (!byUser.has(u)) byUser.set(u, []); byUser.get(u).push([b, r]); }
const tbr = new Map();
for (const [u, b] of toRead) { if (!tbr.has(u)) tbr.set(u, new Set()); tbr.get(u).add(b); }
const rated = new Set(ratings.map(([u, b]) => u * 20000 + b));
const overlap = toRead.filter(([u, b]) => rated.has(u * 20000 + b)).length;
console.log(`ratings ${ratings.length}, to_read ${toRead.length} (also rated by the same user: ${overlap})`);

const eligible = [...byUser.keys()].filter((u) => byUser.get(u).length >= MIN).sort((a, b) => a - b);
const testUsers = shuffle(eligible).slice(0, N_USERS);
const hidden = new Map(), hiddenAll = new Set();
for (const u of testUsers) {
  const list = shuffle([...byUser.get(u)]);
  const n = Math.max(1, Math.round(list.length * HOLD));
  const testPart = list.slice(0, n), valPart = list.slice(n, 2 * n), rest = list.slice(2 * n);
  for (const [b] of testPart) hiddenAll.add(u * 20000 + b);
  if (!TEST) for (const [b] of valPart) hiddenAll.add(u * 20000 + b);
  if (COLD) { for (const [b] of valPart) hiddenAll.add(u * 20000 + b); for (const [b] of rest.slice(COLD)) hiddenAll.add(u * 20000 + b); }
  const rel = new Set((TEST ? testPart : valPart).filter(([, r]) => r >= LIKED).map(([b]) => b));
  if (rel.size) hidden.set(u, rel);
}
const train = ratings.filter(([u, b]) => !hiddenAll.has(u * 20000 + b));
const tbrRows = toRead.filter(([u, b]) => !rated.has(u * 20000 + b));
console.log(`test users ${hidden.size}, train ratings ${train.length}, to_read used ${tbrRows.length}, measured on ${TEST ? "TEST" : "VALIDATION"}${COLD ? `, cold ${COLD}` : ""}`);

for (const v of VALUES) {
  const rows = v ? train.concat(tbrRows.map(([u, b]) => [u, b, v])) : train;
  const t = Date.now();
  const { X, Y, f } = trainALS(Int32Array.from(rows, (r) => r[0]), Int32Array.from(rows, (r) => r[1]), Float32Array.from(rows, (r) => r[2]), nU, nB, { seed: Number(arg("--seed", 42)) });
  const known = new Map();
  for (const [u, b] of train) if (hidden.has(u)) { if (!known.has(u)) known.set(u, new Set()); known.get(u).add(b); }
  let P = 0, R = 0, H = 0, N = 0, n = 0;
  const seen = new Set();
  const scores = new Float64Array(nB);
  for (const [u, rel] of hidden) {
    const excl = known.get(u) || new Set();
    const tb = tbr.get(u) || new Set();
    for (let b = 0; b < nB; b++) {
      if (excl.has(b) || tb.has(b)) { scores[b] = -Infinity; continue; }
      let s = 0; for (let a = 0; a < f; a++) s += X[u * f + a] * Y[b * f + a];
      scores[b] = s;
    }
    const top = [...scores.keys()].filter((b) => scores[b] > -Infinity).sort((a, b) => scores[b] - scores[a]).slice(0, K);
    let hits = 0, dcg = 0, idcg = 0;
    top.forEach((b, i) => { seen.add(b); if (rel.has(b)) { hits++; dcg += 1 / Math.log2(i + 2); } });
    for (let i = 0; i < Math.min(rel.size, K); i++) idcg += 1 / Math.log2(i + 2);
    P += hits / K; R += hits / rel.size; H += hits ? 1 : 0; N += dcg / idcg; n++;
  }
  const pc = (x) => (100 * x / n).toFixed(2);
  console.log(`${v ? `ALS + to_read as ${v}★` : "ALS ratings only"}: P@10 ${pc(P)}  R@10 ${pc(R)}  Hit ${pc(H)}  NDCG ${pc(N)}  coverage ${(100 * seen.size / 10000).toFixed(1)}%  (${Math.round((Date.now() - t) / 1000)}s)`);
}
