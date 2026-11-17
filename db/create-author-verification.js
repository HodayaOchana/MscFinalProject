/**
 * Author verification by the PUBLISHER, book claims, and books uploaded by authors.
 *
 * How an author is verified (the way Amazon Author Central and Spotify do it:
 * someone who already knows the author - the publisher / distributor - confirms):
 *   1. On the Account page the user asks to be an author: pen name, the books,
 *      and the publisher's contact email.
 *   2. BookBridge emails the publisher a one-time link ("Is <pen name> your author?").
 *   3. The publisher clicks Confirm -> the user is an author, and the pen name
 *      becomes a VERIFIED name (author_profiles.verified_names - locked, the
 *      author cannot edit it).
 *
 * Then the author:
 *   - claims existing books from the catalog: a book whose author name equals a
 *     verified name is linked at once; any other book is a claim for the team
 *     (book_claims, decided on the admin page);
 *   - uploads new books (author_uploads): they go live at once, the team can remove them.
 *
 * Changes (only the project's own tables - books is NOT changed):
 *   author_requests  + publisher_name, publisher_email, token_hash, token_expires_at,
 *                      email_sent_at, publisher_decision, publisher_decided_at
 *   author_profiles  + verified_names text[]   (filled for authors approved before)
 *   book_claims      new
 *   author_uploads   new
 *
 * Safe to run again.  Run:  node db/create-author-verification.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS publisher_name       text CHECK (publisher_name IS NULL OR length(publisher_name) <= 200);
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS publisher_email      text CHECK (publisher_email IS NULL OR length(publisher_email) <= 254);
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS token_hash           text;          -- sha256 of the link token; NULL once used
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS token_expires_at     timestamptz;
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS email_sent_at        timestamptz;
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS publisher_decision   text CHECK (publisher_decision IS NULL OR publisher_decision IN ('confirmed', 'declined'));
ALTER TABLE author_requests ADD COLUMN IF NOT EXISTS publisher_decided_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS author_requests_token_idx ON author_requests (token_hash) WHERE token_hash IS NOT NULL;

ALTER TABLE author_profiles ADD COLUMN IF NOT EXISTS verified_names text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS book_claims (
  id          bigserial PRIMARY KEY,
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     int  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  message     text CHECK (message IS NULL OR length(message) <= 1000),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS book_claims_one_pending ON book_claims (user_id, book_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS book_claims_status_idx ON book_claims (status, created_at);

CREATE TABLE IF NOT EXISTS author_uploads (
  book_id     int PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS author_uploads_user_idx ON author_uploads (user_id, created_at DESC);
`;

// authors approved before this change were checked by the team: their pen name counts as verified
const BACKFILL = `
UPDATE author_profiles p SET verified_names = ARRAY[p.pen_name]
WHERE cardinality(p.verified_names) = 0
  AND EXISTS (SELECT 1 FROM author_requests r WHERE r.user_id = p.user_id AND r.status = 'approved');
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows } = await pool.query(`SELECT to_regclass('public.author_requests') AS r, to_regclass('public.author_profiles') AS p;`);
  if (!rows[0].r) throw new Error("author_requests not found - run db/create-author-requests-table.js first");
  if (!rows[0].p) throw new Error("author_profiles not found - run db/create-author-profiles-table.js first");
  await pool.query(SQL);
  const { rowCount } = await pool.query(BACKFILL);
  console.log("Ready: publisher verification columns, verified_names, book_claims, author_uploads.");
  console.log(`Verified names filled for ${rowCount} author(s) approved before.`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
