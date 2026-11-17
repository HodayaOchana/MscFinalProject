/**
 * Profile pictures - one small picture per user (shown on the Account page).
 *
 *   user_avatars - user_id (deleting the account deletes the picture), the image itself
 *                  (JPEG, 256x256, ~20-40 KB - the website shrinks it before sending),
 *                  and when it was changed.
 *
 * Kept in our own database (not in Neon Auth's session, which travels in a cookie and must stay small).
 * Only the user sees their picture for now (GET /api/me/avatar, signed in).   See server/avatar.js.
 *
 * Only creates this table. Safe to run again.   Run:  node db/create-avatar-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id     int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image       bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  await pool.query(SQL);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM user_avatars;`);
  console.log(`Table ready: user_avatars (${rows[0].n} rows)`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
