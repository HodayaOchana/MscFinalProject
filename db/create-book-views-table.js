/**
 * Book page views - which books a user keeps coming back to.
 *
 *   user_book_views - ONE row per user and book (a counter, not a log):
 *     views           how many times they opened the book page (counted visits only)
 *     first_viewed_at / last_viewed_at
 *
 * What counts as a visit (server/book-views.js), so the table holds no junk:
 *   - the page stayed open for at least 8 seconds (a quick pass-through is not interest)
 *   - a new visit only 30 minutes after the last counted one (refresh / Back are not visits)
 *   - only the 200 most recent books per user are kept
 *
 * Used for the For You shelf "Because you looked at <book>": a book opened at least
 * twice (or opened from a search) that the user has not rated. Deleting the account
 * deletes the rows (ON DELETE CASCADE).
 *
 * Safe to run again. Creates only this table.   Run:  node db/create-book-views-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS user_book_views (
  user_id          int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id          int NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  views            int NOT NULL DEFAULT 1,
  first_viewed_at  timestamptz NOT NULL DEFAULT now(),
  last_viewed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS user_book_views_recent_idx ON user_book_views (user_id, last_viewed_at DESC);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  await pool.query(SQL);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM user_book_views;`);
  console.log(`Table ready: user_book_views (${rows[0].n} rows)`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
