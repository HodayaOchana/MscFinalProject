/**
 * Covers that authors upload for THEIR uploaded books (a picture file instead of a link).
 *
 *   book_covers - book_id (deleting the book deletes the cover), the image (JPEG, about
 *                 400 px wide, ~30-70 KB - the website shrinks it first), when it changed.
 * The book's thumbnail_url then points to GET /api/covers/<id>, so every page shows it as usual.
 * Only for books in author_uploads; catalog books keep their own covers. See server/book-covers.js.
 *
 * Only creates this table. Safe to run again.   Run:  node db/create-book-covers-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS book_covers (
  book_id     int PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image       bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  await pool.query(SQL);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_covers;`);
  console.log(`Table ready: book_covers (${rows[0].n} rows)`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
