/**
 * More for the readers around a book (server/social-routes.js):
 *
 *   spoiler              - book_reviews / book_posts: the writer marked it as a spoiler; the
 *                          website blurs it until the reader chooses to see it
 *   alias                - book_reviews / book_posts: shown instead of the writer's name (a pen
 *                          name, or "Anonymous reader"). The row still belongs to the user.
 *   book_review_helpful  - "Helpful" on a review: one per reader per review (not on your own).
 *                          A review is (user_id, book_id) - book_reviews' own key.
 *   book_post_reactions  - quick reactions on a discussion message (a few emoji), one of each
 *                          per reader per message
 *   book_reports         - a reader reported a review or a message. status: open (waiting for
 *                          the team) | hidden (the team hid it) | dismissed (the team kept it)
 *   hidden               - book_reviews / book_posts: hidden from other readers - by the team,
 *                          or on its own after 3 readers reported it (until the team decides)
 *
 * Deleting a review, a message or a user deletes what hangs on it (ON DELETE CASCADE).
 *
 * Adds the spoiler and alias columns (existing rows stay as they are) and creates
 * the new tables. Safe to run again.   Run:  node db/create-community-extras.js
 * (after db/create-social-tables.js)
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
ALTER TABLE book_reviews ADD COLUMN IF NOT EXISTS spoiler boolean NOT NULL DEFAULT false;
ALTER TABLE book_posts   ADD COLUMN IF NOT EXISTS spoiler boolean NOT NULL DEFAULT false;
ALTER TABLE book_reviews ADD COLUMN IF NOT EXISTS alias text CHECK (alias IS NULL OR length(alias) BETWEEN 2 AND 30);
ALTER TABLE book_posts   ADD COLUMN IF NOT EXISTS alias text CHECK (alias IS NULL OR length(alias) BETWEEN 2 AND 30);
ALTER TABLE book_reviews ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE book_posts   ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS book_review_helpful (
  review_user_id int NOT NULL,
  book_id        int NOT NULL,
  user_id        int NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- who found it helpful
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_user_id, book_id, user_id),
  FOREIGN KEY (review_user_id, book_id) REFERENCES book_reviews (user_id, book_id) ON DELETE CASCADE,
  CHECK (review_user_id <> user_id)
);

CREATE TABLE IF NOT EXISTS book_post_reactions (
  post_id    bigint NOT NULL REFERENCES book_posts(id) ON DELETE CASCADE,
  user_id    int    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text   NOT NULL CHECK (emoji IN ('❤️', '😂', '😢', '🤯')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS book_reports (
  id             bigserial PRIMARY KEY,
  reporter_id    int    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id        int    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind           text   NOT NULL CHECK (kind IN ('review', 'post')),
  review_user_id int,                                                     -- kind = review
  post_id        bigint REFERENCES book_posts(id) ON DELETE CASCADE,      -- kind = post
  reason         text   NOT NULL CHECK (reason IN ('spoiler', 'offensive', 'spam', 'other')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'review') = (review_user_id IS NOT NULL) AND (kind = 'post') = (post_id IS NOT NULL))
);
ALTER TABLE book_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed'));
ALTER TABLE book_reports ADD COLUMN IF NOT EXISTS decided_at timestamptz;
CREATE INDEX IF NOT EXISTS book_reports_open_idx ON book_reports (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS book_reports_once ON book_reports (reporter_id, kind, coalesce(review_user_id, 0), book_id, coalesce(post_id, 0));
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows } = await pool.query(`SELECT to_regclass('public.book_posts') AS t;`);
  if (!rows[0].t) throw new Error("book_posts not found - run db/create-social-tables.js first");
  await pool.query(SQL);
  console.log("Ready: spoiler + alias + hidden columns, book_review_helpful, book_post_reactions, book_reports.");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
