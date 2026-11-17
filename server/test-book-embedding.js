/**
 * Checks that the server embeds a new book EXACTLY like CBF/embed-books.js did
 * for the catalog (same model, same text) - so an uploaded book sits in the same
 * space as all the others.
 *
 * Takes a few books that already have an embedding, embeds them again with
 * server/book-embedding.js, and compares: the cosine must be ~1.000.
 * Only READS.  Run:  node server/test-book-embedding.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { embedBook } = require("./book-embedding");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const { rows } = await pool.query(
    // books WITHOUT reader tags: their stored text is "title. description" - the same
    // text the server builds for an uploaded book (v5 = v1 when there are no tags)
    `SELECT id, title, description, embedding::text AS e FROM books b
     WHERE embedding IS NOT NULL AND description IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM book_reader_tags t WHERE t.book_id = b.id)   -- (db/load-reader-tags.js)
     ORDER BY id LIMIT 3;`
  );
  if (!rows.length) throw new Error("no book with an embedding");
  console.log("Loading the model (first time: download ~420 MB)...");
  let worst = 1;
  for (const b of rows) {
    const mine = await embedBook(b.title, b.description);
    const stored = JSON.parse(b.e);
    const cos = mine.reduce((s, x, i) => s + x * stored[i], 0); // both are normalized
    worst = Math.min(worst, cos);
    console.log(`  ${String(b.id).padStart(6)}  cosine ${cos.toFixed(5)}  ${b.title.slice(0, 50)}`);
  }
  if (worst > 0.999) console.log("\nOK - the server embeds books exactly like embed-books.js.");
  else { console.log("\nMISMATCH - the server text or model differs from embed-books.js."); process.exitCode = 1; }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
