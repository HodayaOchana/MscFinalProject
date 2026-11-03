/**
 * Daily re-training of the ALS model - with the BookBridge users' own data.
 *
 * What it trains on:
 *   1. goodbooks-10k ratings        data/goodbooks/ratings.csv
 *   2. goodbooks "want to read"      data/goodbooks/to_read.csv   (weak signal, value 1 - measured best)
 *      Both are public on GitHub (github.com/zygmuntz/goodbooks-10k): a missing file is
 *      downloaded once, so the whole team can run this; they are never re-read from
 *      Neon (6M rows every day would use up the monthly transfer).
 *   3. BookBridge users (from the database) - weights in CF/signal-weights.js:
 *        rating = its stars;  finished = 4;  on the TBR = 1;
 *        search -> opened a result = 3.5 (+0.5 per repeat of the same search, max 5);
 *        search, nothing opened = 0.5 for each of its top 3 results (+0.25 per repeat, max 1.5);
 *        "Not for me" = never a positive signal: removed
 *   (ALS sees every value as "the user read / wants this book", with confidence
 *    c = 1 + alpha * value / 5 - a 5-star rating counts far more than a TBR mark.)
 *
 * The usual way to keep a model like this fresh (batch re-training):
 *   - only re-train when there is ENOUGH NEW DATA (else "skipped")
 *   - CHECK the new model before using it: a fixed "probe" group of 500 goodbooks
 *     readers whose liked books (20%) are NEVER trained on. The new model must find
 *     about as many of them as the current one (Precision@10), else it is "rejected"
 *     and the current model stays.
 *   - PUBLISH in one transaction (the site never sees half a model); the previous
 *     model is kept in als_item_factors_prev / als_model_prev (rollback: --rollback)
 *   - every run is LOGGED in model_runs (when, what data, the probe score, decision)
 *   A new user's recommendations do not wait for this: their vector is computed
 *   live from their ratings (fold-in). The daily run makes the BOOK vectors learn
 *   from all BookBridge users - so everyone's recommendations improve.
 *
 * Run:
 *   node CF/retrain.js                 re-train if there is new data, check, publish
 *   node CF/retrain.js --force         re-train even without new data
 *   node CF/retrain.js --dry-run       train and check, but do not publish
 *   node CF/retrain.js --rollback      put the previous model back
 *   options: --min-new 10  --to-read 1 (0 = off)  --tolerance 0.03  --dir data/goodbooks
 *
 * EASE (since 03/11/2026): trained in the same run on the same data (strong signals only),
 * published to ease_similarity (100 weights per book); the probe check measures the site's
 * CF (0.85 EASE + 0.15 ALS). Takes extra minutes and ~1GB of memory. --no-ease: ALS only.
 *
 * Changes only: als_item_factors, als_model, ease_similarity (+ their _prev copies) and model_runs.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { DEFAULTS, trainALS, gram, toVectorLiteral } = require(path.join(__dirname, "als"));
const { SIGNALS, searchSignals } = require(path.join(__dirname, "signal-weights"));
const { trainEASE, easeScores } = require(path.join(__dirname, "ease"));
// EASE (CF/ease.js) - the main CF part of the site since 03/11/2026: CF = 0.85 EASE + 0.15 ALS
// (hybrid/evaluate.js, test set: 29.50% -> 35.22%). --no-ease trains ALS only.
const EASE_ON = !process.argv.includes("--no-ease");
const EASE_LAMBDA = 500, EASE_TOP = 100, EASE_WEIGHT = 0.85;

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const DIR = arg("--dir", path.join(__dirname, "..", "data", "goodbooks"));
const MIN_NEW = Number(arg("--min-new", 10));       // new BookBridge signals needed to re-train
const TO_READ_VALUE = Number(arg("--to-read", SIGNALS.tbr)); // goodbooks to_read weight (0 = not used): 1 measured best
const GOODBOOKS_URL = "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master";
const TOLERANCE = Number(arg("--tolerance", 0.03)); // the new model may be at most 3% (relative) below the current
const PROBE_USERS = 500, PROBE_MIN = 20, PROBE_HOLD = 0.2, LIKED = 4, K = 10, SEED = 7;
const OPTS = { factors: DEFAULTS.factors, alpha: DEFAULTS.alpha, reg: DEFAULTS.reg, iters: DEFAULTS.iters };
const BATCH = 500;
const APP_USER = 10_000_000; // BookBridge user ids are moved above the goodbooks ids (never collide)

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on("error", (err) => console.warn(`(database connection closed: ${err.message} - ignored)`));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Training takes minutes with no database work; meanwhile Neon may close idle
// connections (or put the database to sleep) - "terminating connection due to
// administrator command". The next query then fails once: try again on a fresh connection.
const CONNECTION_LOST = new Set(["57P01", "57P02", "57P03", "08006", "08003", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);
async function retry(what, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      const lost = CONNECTION_LOST.has(err.code) || /terminat|Connection terminated|ECONNRESET/i.test(err.message);
      if (!lost || i >= tries) throw err;
      log(`(database connection lost during ${what} - reconnecting, try ${i + 1}/${tries})`);
      await new Promise((r) => setTimeout(r, 2000 * i)); // Neon wakes up in a few seconds
    }
  }
}

// goodbooks-10k is public on GitHub: a missing file is downloaded once into --dir
// (so anyone on the team can run this; nothing heavy is read from Neon)
async function ensureFile(file) {
  if (fs.existsSync(file)) return;
  const url = `${GOODBOOKS_URL}/${path.basename(file)}`;
  log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status}) - put the file in ${path.dirname(file)} by hand`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function readCsv(file, onRow) {
  await ensureFile(file);
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let head = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.replace(/^﻿/, "").split(",");
    if (!head) { head = parts; continue; }
    onRow(Object.fromEntries(head.map((h, i) => [h, parts[i]])));
  }
}

const tableExists = async (name) => (await pool.query(`SELECT to_regclass($1) AS t;`, [name])).rows[0].t !== null;

// BookBridge users' signals -> [user, book, value]
async function platformRows() {
  const value = new Map(); // "user|book" -> value (the strongest signal wins)
  const strong = new Set(); // read / chose the book: a rating, "finished", a search result opened - EASE learns from these
  const put = (u, b, v, isStrong = false) => { const k = `${u}|${b}`; if (!(value.get(k) >= v)) value.set(k, v); if (isStrong) strong.add(k); };
  const { rows: ratings } = await pool.query(`SELECT user_id, book_id, rating FROM user_ratings;`);
  for (const r of ratings) put(r.user_id, r.book_id, r.rating, true);
  const { rows: events } = await pool.query(
    `SELECT user_id, book_id,
            bool_or(type = 'finished') AS finished,
            bool_or(type = 'dismissed') AS dismissed,
            (array_agg(type ORDER BY created_at DESC) FILTER (WHERE type IN ('saved', 'unsaved')))[1] = 'saved' AS on_tbr
     FROM user_events GROUP BY user_id, book_id;`
  );
  const dismissed = new Set();
  for (const e of events) {
    if (e.dismissed) { dismissed.add(`${e.user_id}|${e.book_id}`); continue; }
    if (e.finished) put(e.user_id, e.book_id, SIGNALS.finished, true);
    if (e.on_tbr) put(e.user_id, e.book_id, SIGNALS.tbr);
  }
  if (await tableExists("user_searches")) {
    // searches: a result opened = strong, the top results of a search with no click = weak,
    // more for a search repeated (CF/signal-weights.js)
    const hasTop = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'user_searches' AND column_name = 'result_book_ids';`)).rowCount > 0;
    const { rows: searches } = await pool.query(
      `SELECT user_id, clicked_book_id, search_count${hasTop ? ", result_book_ids" : ""} FROM user_searches;`);
    for (const row of searches) for (const sig of searchSignals(row)) put(row.user_id, sig.bookId, sig.value, sig.value >= SIGNALS.searchClick);
  }
  const out = [];
  for (const [k, v] of value) {
    if (dismissed.has(k)) continue; // "Not for me" is never a positive signal
    const [u, b] = k.split("|").map(Number);
    out.push([APP_USER + u, b, v, strong.has(k) ? 1 : 0]);
  }
  return out;
}

// how much BookBridge data there is now - to decide if a re-train is worth it
async function platformStamp() {
  const q = async (sql) => (await pool.query(sql)).rows[0];
  const r = await q(`SELECT count(*)::int AS n, max(updated_at) AS t FROM user_ratings;`);
  const e = await q(`SELECT count(*)::int AS n, max(created_at) AS t FROM user_events;`);
  const s = (await tableExists("user_searches"))
    ? await q(`SELECT coalesce(sum(search_count), 0)::int + count(clicked_book_id)::int AS n FROM user_searches;`) : { n: 0 };
  return { signals: r.n + e.n + s.n, ratings: r.n, events: e.n, searches: s.n };
}

async function ensureRunsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS model_runs (
      id               serial PRIMARY KEY,
      started_at       timestamptz NOT NULL DEFAULT now(),
      finished_at      timestamptz,
      status           text NOT NULL,            -- published | skipped | rejected | dry-run | failed | rolled-back
      reason           text,
      platform_signals int,                      -- BookBridge ratings + events + search clicks at the time
      train_rows       int,
      train_users      int,
      probe_precision  real,                     -- Precision@10 on the probe readers (%)
      probe_ndcg       real,
      settings         jsonb
    );`);
}

async function lastPublished() {
  // the model the site uses now: the last publish, or the one a rollback brought back
  return (await pool.query(`SELECT * FROM model_runs WHERE status IN ('published', 'rolled-back') ORDER BY id DESC LIMIT 1;`)).rows[0] || null;
}

async function publish(bookIds, Y, f, users, ease) {
  const YtY = gram(Y, bookIds.length, f);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // keep the current model as the previous one (for --rollback)
    for (const t of ["als_item_factors", "als_model", ...(ease ? ["ease_similarity"] : [])]) {
      await client.query(`DROP TABLE IF EXISTS ${t}_prev;`);
      if ((await client.query(`SELECT to_regclass($1) AS t;`, [t])).rows[0].t) await client.query(`CREATE TABLE ${t}_prev AS TABLE ${t};`);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS als_item_factors (
        book_id INT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        factors vector(${f}) NOT NULL
      );`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS als_model (
        id INT PRIMARY KEY DEFAULT 1, factors INT NOT NULL, alpha REAL NOT NULL, reg REAL NOT NULL,
        iterations INT NOT NULL, users INT NOT NULL, yty DOUBLE PRECISION[] NOT NULL,
        trained_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
    await client.query(`DELETE FROM als_item_factors;`);
    await client.query(`DELETE FROM als_model;`);
    for (let s = 0; s < bookIds.length; s += BATCH) {
      const ids = bookIds.slice(s, s + BATCH);
      const vecs = ids.map((_, k) => toVectorLiteral(Y.subarray((s + k) * f, (s + k + 1) * f)));
      await client.query(`INSERT INTO als_item_factors (book_id, factors) SELECT id, v::vector FROM unnest($1::int[], $2::text[]) AS t(id, v);`, [ids, vecs]);
    }
    await client.query(`INSERT INTO als_model (factors, alpha, reg, iterations, users, yty) VALUES ($1, $2, $3, $4, $5, $6);`,
      [f, OPTS.alpha, OPTS.reg, OPTS.iters, users, Array.from(YtY)]);
    if (ease) {
      // EASE: for every book its strongest weights (+ and -): score(j) = sum over the user's books of weight
      await client.query(`
        CREATE TABLE IF NOT EXISTS ease_similarity (
          book_id     INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          neighbor_id INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          weight      REAL NOT NULL,
          PRIMARY KEY (book_id, neighbor_id)
        );`);
      await client.query(`DELETE FROM ease_similarity;`);
      const { idx, w, top } = ease;
      let a = [], b = [], c = [];
      const flush = async () => {
        if (!a.length) return;
        await client.query(`INSERT INTO ease_similarity (book_id, neighbor_id, weight) SELECT * FROM unnest($1::int[], $2::int[], $3::real[]);`, [a, b, c]);
        a = []; b = []; c = [];
      };
      for (let i = 0; i < bookIds.length; i++) {
        for (let k = 0; k < top; k++) {
          const j = idx[i * top + k];
          if (j < 0 || w[i * top + k] === 0) continue;
          a.push(bookIds[i]); b.push(bookIds[j]); c.push(w[i * top + k]);
        }
        if (a.length >= 20000) await flush();
      }
      await flush();
    }
    await client.query("COMMIT"); // the site sees the whole new model at once
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rollback() {
  for (const t of ["als_item_factors", "als_model"]) if (!(await tableExists(`${t}_prev`))) throw new Error(`no previous model (${t}_prev) to go back to`);
  // EASE: back to the previous weights - or, if the previous model had no EASE, remove it (the site then uses ALS + item-item)
  const easeTables = (await tableExists("ease_similarity")) ? ((await tableExists("ease_similarity_prev")) ? ["ease_similarity"] : "drop") : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of ["als_item_factors", "als_model", ...(Array.isArray(easeTables) ? easeTables : [])]) {
      await client.query(`DELETE FROM ${t};`);
      await client.query(`INSERT INTO ${t} SELECT * FROM ${t}_prev;`);
    }
    if (easeTables === "drop") await client.query(`DROP TABLE ease_similarity;`);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  // the restored model = the publish before the last one: copy its numbers, so the next check compares with it
  const { rows: [restored] } = await pool.query(
    `SELECT platform_signals, train_rows, train_users, probe_precision, probe_ndcg, settings FROM model_runs
     WHERE status IN ('published', 'rolled-back') ORDER BY id DESC OFFSET 1 LIMIT 1;`);
  await pool.query(
    `INSERT INTO model_runs (status, reason, platform_signals, train_rows, train_users, probe_precision, probe_ndcg, settings, finished_at)
     VALUES ('rolled-back', 'previous model restored by hand', $1, $2, $3, $4, $5, $6, now());`,
    [restored?.platform_signals ?? null, restored?.train_rows ?? null, restored?.train_users ?? null,
     restored?.probe_precision ?? null, restored?.probe_ndcg ?? null, restored?.settings ?? null]);
  log("The previous model is back. (Restart the server, or wait up to 10 minutes for it to reload.)");
}

function seededRandom(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  await ensureRunsTable();
  // a run that died half-way (e.g. the computer went to sleep) stays "running" - close it
  await pool.query(`UPDATE model_runs SET status = 'failed', reason = coalesce(reason, 'stopped before the end'), finished_at = now()
                    WHERE status = 'running' AND started_at < now() - interval '3 hours';`);
  if (has("--rollback")) return rollback();

  // 1. Is there enough new BookBridge data?
  const stamp = await platformStamp();
  const prev = await lastPublished();
  const fresh = stamp.signals - (prev?.platform_signals ?? -Infinity);
  if (prev && fresh < MIN_NEW && !has("--force")) {
    const reason = `only ${Math.max(0, fresh)} new BookBridge signals since the last model (need ${MIN_NEW})`;
    await pool.query(`INSERT INTO model_runs (status, reason, platform_signals, finished_at) VALUES ('skipped', $1, $2, now());`, [reason, stamp.signals]);
    log(`Skipped: ${reason}.`);
    return;
  }
  const { rows: [run] } = await pool.query(`INSERT INTO model_runs (status, platform_signals, settings) VALUES ('running', $1, $2) RETURNING id;`,
    [stamp.signals, { ...OPTS, toRead: TO_READ_VALUE, signals: SIGNALS, minNew: MIN_NEW, tolerance: TOLERANCE, ease: EASE_ON ? { lambda: EASE_LAMBDA, top: EASE_TOP, weight: EASE_WEIGHT } : null }]);
  const finish = (status, extra = {}) => retry("saving the run log", () => pool.query(
    `UPDATE model_runs SET status = $2, reason = $3, train_rows = $4, train_users = $5, probe_precision = $6, probe_ndcg = $7, finished_at = now() WHERE id = $1;`,
    [run.id, status, extra.reason || null, extra.rows ?? null, extra.users ?? null, extra.p ?? null, extra.ndcg ?? null]));

  try {
    // 2. The data. goodbooks book_id -> our books.id (books not in our table are skipped, as in load-ratings.js)
    const { rows: map } = await pool.query(`SELECT id, goodbooks_id FROM books WHERE goodbooks_id IS NOT NULL;`);
    const ourId = new Map(map.map((r) => [Number(r.goodbooks_id), r.id]));
    const rows = [];
    let skipped = 0;
    log("Reading goodbooks ratings from the file...");
    await readCsv(path.join(DIR, "ratings.csv"), (r) => {
      const b = ourId.get(Number(r.book_id));
      if (b) rows.push([Number(r.user_id), b, Number(r.rating), 1]); else skipped++;
    });
    const nDataset = rows.length;
    if (TO_READ_VALUE > 0) {
      const rated = new Set(rows.map(([u, b]) => u * 1e6 + b));
      await readCsv(path.join(DIR, "to_read.csv"), (r) => {
        const u = Number(r.user_id), b = ourId.get(Number(r.book_id));
        if (b && !rated.has(u * 1e6 + b)) rows.push([u, b, TO_READ_VALUE, 0]);
      });
    }
    const nToRead = rows.length - nDataset;
    const app = await platformRows();
    rows.push(...app);
    log(`goodbooks ratings ${nDataset.toLocaleString()} (${skipped.toLocaleString()} of books not in our table skipped), to_read ${nToRead.toLocaleString()}, BookBridge signals ${app.length.toLocaleString()}`);

    // 3. The probe readers: 500 goodbooks readers; 20% of their ratings are NEVER trained on
    const rand = seededRandom(SEED);
    const byUser = new Map();
    for (let i = 0; i < nDataset; i++) { const u = rows[i][0]; if (!byUser.has(u)) byUser.set(u, []); byUser.get(u).push(i); }
    const eligible = [...byUser.keys()].filter((u) => byUser.get(u).length >= PROBE_MIN).sort((a, b) => a - b);
    for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
    const probes = new Map(); // user -> Set of hidden liked books
    const hide = new Set();   // row indexes left out
    for (const u of eligible.slice(0, PROBE_USERS)) {
      const idx = [...byUser.get(u)].sort((a, b) => rows[a][1] - rows[b][1]);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const hidden = idx.slice(0, Math.max(1, Math.round(idx.length * PROBE_HOLD)));
      hidden.forEach((i) => hide.add(i));
      const liked = new Set(hidden.filter((i) => rows[i][2] >= LIKED).map((i) => rows[i][1]));
      if (liked.size) probes.set(u, liked);
    }
    const train = rows.filter((_, i) => !hide.has(i));

    // 4. Train
    const userIds = [...new Set(train.map((r) => r[0]))];
    const bookIds = [...new Set(train.map((r) => r[1]))];
    const uIndex = new Map(userIds.map((id, i) => [id, i]));
    const bIndex = new Map(bookIds.map((id, i) => [id, i]));
    log(`Training ALS on ${train.length.toLocaleString()} rows: ${userIds.length.toLocaleString()} readers, ${bookIds.length.toLocaleString()} books...`);
    const { X, Y, f } = trainALS(Int32Array.from(train, (r) => uIndex.get(r[0])), Int32Array.from(train, (r) => bIndex.get(r[1])),
      Float32Array.from(train, (r) => r[2]), userIds.length, bookIds.length,
      { ...OPTS, onIteration: (it, ms) => log(`  iteration ${it}/${OPTS.iters} (${Math.round(ms / 1000)}s)`) });

    // 4b. EASE - learns from what readers READ or CHOSE (ratings, finished, a search result
    // opened); weak signals (TBR, want-to-read) only go to ALS. The inverse takes minutes.
    let ease = null;
    if (EASE_ON) {
      const lists = Array.from({ length: userIds.length }, () => []);
      for (const r of train) if (r[3]) lists[uIndex.get(r[0])].push(bIndex.get(r[1]));
      const t1 = Date.now();
      log(`Training EASE on ${bookIds.length.toLocaleString()} books (lambda ${EASE_LAMBDA}, top ${EASE_TOP} per book)...`);
      ease = await trainEASE(lists.map((l) => Int32Array.from(l)), bookIds.length, {
        lambda: EASE_LAMBDA, top: EASE_TOP,
        onProgress: (p, n) => log(`  inverse ${p}/${n} (${Math.round((Date.now() - t1) / 1000)}s)`),
      });
      log(`  EASE done in ${Math.round((Date.now() - t1) / 1000)}s`);
    }

    // 5. Check on the probe readers
    const known = new Map(), knownStrong = new Map();
    for (const r of train) {
      const [u, b] = r;
      if (!probes.has(u)) continue;
      if (!known.has(u)) { known.set(u, new Set()); knownStrong.set(u, []); }
      known.get(u).add(bIndex.get(b));
      if (r[3]) knownStrong.get(u).push(bIndex.get(b));
    }
    let P = 0, N = 0, n = 0;
    const scores = new Float64Array(bookIds.length);
    for (const [u, liked] of probes) {
      const ui = uIndex.get(u);
      if (ui === undefined) continue;
      const excl = known.get(u) || new Set();
      for (let b = 0; b < bookIds.length; b++) {
        if (excl.has(b)) { scores[b] = -Infinity; continue; }
        let s = 0; for (let a = 0; a < f; a++) s += X[ui * f + a] * Y[b * f + a];
        scores[b] = s;
      }
      if (ease) {
        // the site's CF: EASE_WEIGHT * EASE + (1 - EASE_WEIGHT) * ALS, each divided by its best score
        const es = easeScores(ease, knownStrong.get(u) || [], bookIds.length);
        let mA = 0, mE = 0;
        for (let b = 0; b < bookIds.length; b++) if (scores[b] > -Infinity) { if (scores[b] > mA) mA = scores[b]; if (es[b] > mE) mE = es[b]; }
        for (let b = 0; b < bookIds.length; b++) if (scores[b] > -Infinity) {
          scores[b] = EASE_WEIGHT * (mE > 0 ? Math.max(0, es[b]) / mE : 0) + (1 - EASE_WEIGHT) * (mA > 0 ? Math.max(0, scores[b]) / mA : 0);
        }
      }
      const top = [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, K);
      let hits = 0, dcg = 0, idcg = 0;
      top.forEach((b, i) => { if (liked.has(bookIds[b])) { hits++; dcg += 1 / Math.log2(i + 2); } });
      for (let i = 0; i < Math.min(liked.size, K); i++) idcg += 1 / Math.log2(i + 2);
      P += hits / K; N += dcg / idcg; n++;
    }
    const p = Math.round((10000 * P) / n) / 100, ndcg = Math.round((10000 * N) / n) / 100;
    const base = prev?.probe_precision ?? null;
    log(`Probe readers (${n}, ${ease ? "EASE + ALS" : "ALS"}): Precision@10 ${p}%, NDCG@10 ${ndcg}%` + (base !== null ? ` - current model ${base}%` : " - no current model to compare"));
    const extra = { rows: train.length, users: userIds.length, p, ndcg };

    if (base !== null && p < base * (1 - TOLERANCE)) {
      await finish("rejected", { ...extra, reason: `probe precision ${p}% < current ${base}% - ${Math.round(TOLERANCE * 100)}%` });
      log("Rejected - the current model stays.");
      return;
    }
    if (has("--dry-run")) { await finish("dry-run", { ...extra, reason: "not published (--dry-run)" }); log("Dry run - not published."); return; }

    // 6. Publish (the probe readers' hidden 20% stay out - a tiny part of the data, and it keeps the check honest)
    log("Publishing...");
    await retry("publishing", () => publish(bookIds, Y, f, userIds.length, ease)); // one transaction: a retry starts clean
    await finish("published", { ...extra, reason: `${app.length} BookBridge signals in training` });
    log(`Published ${bookIds.length.toLocaleString()} book vectors${ease ? ` and ${(bookIds.length * EASE_TOP).toLocaleString()} EASE weights` : ""}. The site uses them within 10 minutes (or restart the server).`);
  } catch (err) {
    await finish("failed", { reason: String(err.message).slice(0, 500) }).catch(() => {});
    throw err;
  }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
