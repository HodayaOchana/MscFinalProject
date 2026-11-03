/**
 * Admin script for author accounts - for demos and for fixing things by hand.
 * (Normally an author is confirmed by their PUBLISHER through the emailed link -
 * see server/author-verification.js.)
 *
 *   node db/make-author.js --email reader@mail.com --find "Mockingjay"          show matching books (nothing changes)
 *   node db/make-author.js --email reader@mail.com --verify "Suzanne Collins"   make them an author with this VERIFIED
 *                                                                              name (as if the publisher confirmed it)
 *   node db/make-author.js --email reader@mail.com --remove                     back to a regular reader: removes the
 *                                                                              book links and the verified names
 *
 * After --verify the author links their books in the app ("Add a book that's
 * already here"): books with the verified name are linked at once.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EMAIL = arg("--email");
const FIND = arg("--find");
const VERIFY = (arg("--verify") || "").trim();
const REMOVE = process.argv.includes("--remove");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  if (!EMAIL) throw new Error('usage: --email <user email> and one of: --find "title" | --verify "Pen Name" | --remove');
  const { rows: u } = await pool.query(
    `SELECT u.id, u.user_type, a.name FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE lower(a.email) = lower($1);`,
    [EMAIL]
  );
  if (!u[0]) throw new Error(`no app user with email ${EMAIL} (they must sign in once first)`);
  const user = u[0];
  console.log(`User ${user.id} (${user.name}) - now: ${user.user_type}`);

  if (FIND) {
    const { rows } = await pool.query(
      `SELECT id, title, authors[1] AS author FROM books WHERE title ILIKE '%' || $1 || '%' ORDER BY goodbooks_id NULLS LAST LIMIT 15;`,
      [FIND]
    );
    rows.forEach((b) => console.log(`  ${String(b.id).padStart(6)}  ${b.title} - ${b.author || "?"}`));
    console.log("\nNothing changed.");
    return;
  }

  if (user.user_type === "librarian") throw new Error("this is a librarian account - not changed");

  if (VERIFY) {
    if (VERIFY.length > 120) throw new Error("the name: up to 120 characters");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET user_type = 'author' WHERE id = $1;`, [user.id]);
      await client.query(
        `INSERT INTO author_profiles (user_id, pen_name, verified_names) VALUES ($1, $2, ARRAY[$2])
         ON CONFLICT (user_id) DO UPDATE SET verified_names =
           (SELECT array_agg(DISTINCT x) FROM unnest(author_profiles.verified_names || ARRAY[$2]) AS x),
           updated_at = now();`,
        [user.id, VERIFY]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const { rows: n } = await pool.query(
      `SELECT count(*)::int AS n FROM books WHERE EXISTS (SELECT 1 FROM unnest(authors) a WHERE lower(a) = lower($1));`, [VERIFY]
    );
    console.log(`Done: an author, verified as "${VERIFY}". ${n[0].n} catalog book(s) carry this name - they can link them in the app.`);
    return;
  }

  if (REMOVE) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM author_books WHERE user_id = $1;`, [user.id]);
      await client.query(`UPDATE author_profiles SET verified_names = '{}' WHERE user_id = $1;`, [user.id]);
      await client.query(`UPDATE users SET user_type = 'reader' WHERE id = $1;`, [user.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    console.log("Done: a regular reader again - book links and verified names removed (books they uploaded stay in the catalog).");
    return;
  }

  throw new Error('give one of: --find "title" | --verify "Pen Name" | --remove');
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
