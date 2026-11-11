/**
 * Moves the publishers from PUBLISHER_EMAILS in .env ("Name|email,Name|email") into the publishers
 * table - from now on the list lives ONLY in the table (added / removed on /admin/publishers), and
 * every publisher's key is its id.
 * They get source = 'env': a name and an email, no document (they were added before the checks).
 * A name that is on the list already is skipped, so it is safe to run again.
 * After it runs, you can delete the PUBLISHER_EMAILS line from .env.
 *
 * Needs: node db/create-publishers-tables.js first.
 * Run:   node db/import-env-publishers.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const entries = (process.env.PUBLISHER_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!entries.length) return console.log("PUBLISHER_EMAILS is empty in .env - nothing to move.");
  for (const entry of entries) {
    const [a, b] = entry.split("|").map((x) => x.trim());
    const email = (b ?? a ?? "").toLowerCase();
    if (!EMAIL_RE.test(email)) { console.log(`  skipped (not an email): ${entry}`); continue; }
    const name = (b === undefined ? email.split("@")[1] : a).slice(0, 200);
    const { rows } = await pool.query(
      `INSERT INTO publishers (name, contact_email, website_domain, source, notes)
       SELECT $1::text, $2::text, $3::text, 'env', 'Moved from PUBLISHER_EMAILS in .env'
       WHERE NOT EXISTS (SELECT 1 FROM publishers WHERE active AND lower(name) = lower($1::text))
       RETURNING id;`,
      [name, email, email.split("@")[1]]
    );
    console.log(rows.length ? `  added   #${rows[0].id}  ${name} <${email}>` : `  on the list already: ${name}`);
  }
  console.log("Done. The server reads the list from the table now - restart it. You can delete PUBLISHER_EMAILS from .env.");
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
