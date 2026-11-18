/**
 * Simpler verification of publishers - PROOF OF CONTROL instead of documents (server/publishers.js).
 *
 * Only ADDS columns (nothing is deleted - old documents stay readable on the admin page):
 *   publishers          + social_url    the publisher's official page on a social network
 *   publisher_requests  + sub_social    the page the publisher gave in its form
 *                       + proof_code    the code it puts on that page (BB-XXXXXX)
 *
 * Needs db/create-publishers-tables.js first.
 * Safe to run again.   Run:  node db/add-verification-proof.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
ALTER TABLE publishers
  ADD COLUMN IF NOT EXISTS social_url text CHECK (social_url IS NULL OR length(social_url) <= 300);
ALTER TABLE publisher_requests
  ADD COLUMN IF NOT EXISTS sub_social text CHECK (sub_social IS NULL OR length(sub_social) <= 300),
  ADD COLUMN IF NOT EXISTS proof_code text CHECK (proof_code IS NULL OR length(proof_code) <= 20);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows } = await pool.query(
    `SELECT to_regclass('public.publishers') AS p, to_regclass('public.publisher_requests') AS pr;`
  );
  if (!rows[0].p || !rows[0].pr) throw new Error("publishers tables not found - run node db/create-publishers-tables.js first");
  await pool.query(SQL);
  console.log("Ready: publishers.social_url, publisher_requests.sub_social / proof_code.");
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
