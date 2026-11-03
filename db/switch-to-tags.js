/**
 * Switch the app's book embeddings to v5 (title + READER TAGS + description) -
 * by RENAMING columns, like db/switch-embedding.js did for mpnet.
 *
 * Measured (03/11/2026, mpnet in both):
 *   CBF/compare-embeddings.js, 200 popular books ("Similar in spirit"):
 *     readers agree@10                 30.8%  ->  38.0%
 *     same, without the series         22.9%  ->  29.8%   (+6.9; mpnet over MiniLM was +5.4)
 *     same first genre@10              46.9%  ->  54.9%
 *   hybrid/evaluate.js --validation --cold 5 (500 new users, Precision@10):
 *     CBF-kNN 3.60% -> 3.88%,  CBF-centered 3.40% -> 4.02%,  CBF-mean 2.70% -> 2.90%
 *     Hybrid-v3 (the app's model for rated books) unchanged - it uses CBF only for new books.
 *
 *   before:  embedding    = v1 (title + description)   <- the app reads this column
 *            embedding_v5 = v5 (with reader tags)
 *   after:   embedding    = v5                          <- no code change in the app
 *            embedding_v1 = v1                          kept as a backup (--rollback)
 *
 * Books without reader tags (Google books, author uploads) have the SAME text in
 * v1 and v5, so their vectors do not change, and server/book-embedding.js (new
 * uploads) stays correct as it is.
 *
 * Nothing is deleted or computed - only names change, in ONE transaction.
 *
 *   node db/switch-to-tags.js              dry run
 *   node db/switch-to-tags.js --apply      switch to v5
 *   node db/switch-to-tags.js --rollback   back to v1
 *
 * After the switch:
 *   1. node CBF/train-cbf.js        rebuild content_similarity from the new vectors
 *   2. restart the server
 *   3. hybrid/evaluate.js: add --refresh once (its cached `embedding` file is the old one)
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function columns() {
  const { rows } = await pool.query(
    `SELECT attname AS name FROM pg_attribute
     WHERE attrelid = 'books'::regclass AND attname LIKE 'embedding%' AND NOT attisdropped AND attnum > 0;`
  );
  return new Set(rows.map((r) => r.name));
}

async function main() {
  const cols = await columns();
  console.log(`Embedding columns: ${[...cols].sort().join(", ")}`);
  let steps;
  if (ROLLBACK) {
    if (!cols.has("embedding_v1") || cols.has("embedding_v5")) throw new Error("Nothing to roll back: expected embedding (v5) + embedding_v1, and no embedding_v5.");
    steps = [["embedding", "embedding_v5"], ["embedding_v1", "embedding"]];
  } else {
    if (cols.has("embedding_v1") && !cols.has("embedding_v5")) return console.log("\nAlready switched: `embedding` is v5.");
    if (!cols.has("embedding_v5")) throw new Error("No embedding_v5 column - run CBF/embed-books.js --column embedding_v5 --text v5 first.");
    if (cols.has("embedding_v1")) throw new Error("embedding_v1 already exists - check it before switching.");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM books WHERE embedding IS NOT NULL AND embedding_v5 IS NULL;`);
    if (rows[0].n) throw new Error(`${rows[0].n} books have a v1 vector but no v5 vector - run embed-books.js --column embedding_v5 --text v5 again first.`);
    steps = [["embedding", "embedding_v1"], ["embedding_v5", "embedding"]];
  }
  console.log(`\n${ROLLBACK ? "Roll back" : "Switch"}:`);
  for (const [from, to] of steps) console.log(`  ${from}  ->  ${to}`);
  if (!APPLY && !ROLLBACK) return console.log("\nDRY RUN - nothing changed. Run again with --apply to switch.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [from, to] of steps) await client.query(`ALTER TABLE books RENAME COLUMN ${from} TO ${to};`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log(`\nDone - embedding is now ${ROLLBACK ? "v1" : "v5 (with reader tags)"}.`);
  console.log("Next: node CBF/train-cbf.js (content_similarity), then restart the server.");
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
