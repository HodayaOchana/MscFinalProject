/**
 * Search history - what each user searched for on the Search page.
 *
 *   user_searches - ONE row per user and search text. The text is compared
 *                   ignoring upper/lower case and extra spaces ("Harry  Potter"
 *                   = "harry potter"), and search_count counts how many times
 *                   the user searched it.
 *
 *   query            the text as last typed
 *   query_norm       lower case, single spaces - what "the same search" means
 *   search_count     how many times it was searched (again within 30 s = not counted, a double click)
 *   results_count    how many results the last search found
 *   clicked_book_id  the result opened the last time
 *   result_book_ids  the top 3 results shown the last time (a search with no click still
 *                    says a little about taste - CF/signal-weights.js)
 *   created_at       first time searched;  last_searched_at  last time
 *
 * Used now for "Recent searches" under the search box. Kept for the recommender
 * later: what people look for, how often, and which book they chose for it.
 * The user can remove one search or clear them all; deleting the account
 * deletes them too (ON DELETE CASCADE).
 *
 * Safe to run again. If the table exists from the first version (one row per
 * search), the rows are merged into one row per text, with search_count = how
 * many there were. Does not touch any other table.
 *
 * Run:  node db/create-search-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CREATE = `
CREATE TABLE IF NOT EXISTS user_searches (
  id                bigserial PRIMARY KEY,
  user_id           int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query             text NOT NULL CHECK (length(query) BETWEEN 2 AND 200),
  query_norm        text NOT NULL,
  search_count      int  NOT NULL DEFAULT 1,
  results_count     int  NOT NULL DEFAULT 0,
  clicked_book_id   int  REFERENCES books(id) ON DELETE SET NULL,
  result_book_ids   int[],                     -- the top 3 results shown the last time
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_searched_at  timestamptz NOT NULL DEFAULT now()
);
-- from the first version (one row per search): add the new columns
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS search_count int NOT NULL DEFAULT 1;
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS last_searched_at timestamptz;
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS result_book_ids int[];
`;

// one row per (user, text): keep the newest row, sum the counts, earliest first / latest last time
const MERGE = `
WITH g AS (
  SELECT user_id, query_norm,
         (array_agg(id ORDER BY coalesce(last_searched_at, created_at) DESC, id DESC))[1] AS keep,
         sum(search_count)::int AS n,
         min(created_at) AS first,
         max(coalesce(last_searched_at, created_at)) AS last,
         (array_agg(clicked_book_id ORDER BY coalesce(last_searched_at, created_at) DESC)
            FILTER (WHERE clicked_book_id IS NOT NULL))[1] AS clicked
  FROM user_searches
  GROUP BY user_id, query_norm
  HAVING count(*) > 1 OR bool_or(last_searched_at IS NULL)
), kept AS (
  UPDATE user_searches s
  SET search_count = g.n, created_at = g.first, last_searched_at = g.last,
      clicked_book_id = coalesce(g.clicked, s.clicked_book_id)
  FROM g WHERE s.id = g.keep
  RETURNING s.id, s.user_id, s.query_norm
)
DELETE FROM user_searches s USING kept
WHERE s.user_id = kept.user_id AND s.query_norm = kept.query_norm AND s.id <> kept.id;
`;

const FINISH = `
ALTER TABLE user_searches ALTER COLUMN last_searched_at SET DEFAULT now();
ALTER TABLE user_searches ALTER COLUMN last_searched_at SET NOT NULL;
DROP INDEX IF EXISTS user_searches_user_idx;
DROP INDEX IF EXISTS user_searches_norm_idx;
CREATE UNIQUE INDEX IF NOT EXISTS user_searches_user_norm_key ON user_searches (user_id, query_norm);
CREATE INDEX IF NOT EXISTS user_searches_recent_idx ON user_searches (user_id, last_searched_at DESC);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(CREATE);
    const merged = await client.query(MERGE);
    await client.query(FINISH);
    await client.query("COMMIT");
    const { rows } = await client.query(`SELECT count(*)::int AS n, coalesce(sum(search_count), 0)::int AS s FROM user_searches;`);
    console.log(`Table ready: user_searches - ${rows[0].n} different searches, ${rows[0].s} searches in all`
      + (merged.rowCount ? ` (merged ${merged.rowCount} repeated rows)` : ""));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
