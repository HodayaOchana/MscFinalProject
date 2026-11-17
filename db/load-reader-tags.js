/**
 * Loads the goodbooks-10k READER TAGS (the shelves Goodreads readers put books
 * on: "dystopian", "vampires", "coming of age"...) into a NEW table:
 *
 *   book_reader_tags (book_id, tag, count)   - up to 10 cleaned tags per book
 *
 * The cleaning (CBF/reader-tags.js) removes shelves that are not about the book
 * ("to-read", "owned", "kindle", "read-in-2015"), the book's own author/title
 * words, and merges spelling variants. Books are matched through books.csv:
 * goodreads_book_id -> goodbooks book_id -> books.goodbooks_id.
 *
 * Used by CBF/embed-books.js --text v5 (title + description + reader tags).
 *
 * Books: data/books_enriched.csv - the file the books table was built from - when it is
 * there; otherwise goodbooks books.csv. Tags: tags.csv, book_tags.csv. Taken from
 * data/goodbooks/ (or --dir <folder>), else from data/, else downloaded once from
 * the public goodbooks GitHub (github.com/zygmuntz/goodbooks-10k) - plain CSV text.
 *
 * Default is a DRY RUN (prints examples, changes nothing).
 * --apply creates the table if needed and replaces ITS rows only.
 * No other table is changed.
 *
 * Run:
 *   node db/load-reader-tags.js                 dry run
 *   node db/load-reader-tags.js --apply         save
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { readerTags } = require(path.join(__dirname, "..", "CBF", "reader-tags"));

const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : path.join(__dirname, "..", "data", "goodbooks");
const GOODBOOKS_URL = "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master";

// The file from --dir; else the same file in data/ (where the first goodbooks files were
// kept); else downloaded once from the public goodbooks GitHub into --dir.
async function findFile(name) {
  const here = path.join(DIR, name);
  if (fs.existsSync(here)) return here;
  const old = path.join(__dirname, "..", "data", name);
  if (dirArg < 0 && fs.existsSync(old)) return old;
  console.log(`Downloading ${GOODBOOKS_URL}/${name} ...`);
  const res = await fetch(`${GOODBOOKS_URL}/${name}`);
  if (!res.ok) throw new Error(`Could not download ${name} (${res.status}) - put it in ${DIR} by hand`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(here, Buffer.from(await res.arrayBuffer()));
  return here;
}
const APPLY = process.argv.includes("--apply");

// CSV with quoted fields (books.csv titles contain commas)
function parseCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file} (download it from github.com/zygmuntz/goodbooks-10k)`);
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  // The books file: books_enriched.csv - the SAME file our books table was built from
  // (build-books.js) - if it is in data/; else goodbooks books.csv (GitHub or Kaggle version)
  const enriched = [path.join(DIR, "books_enriched.csv"), path.join(__dirname, "..", "data", "books_enriched.csv")].find((f) => fs.existsSync(f));
  const books = parseCsv(enriched || (await findFile("books.csv")));
  if (enriched) console.log(`Books file: ${enriched} (the file the books table was built from)`);
  const tagNames = new Map(parseCsv(await findFile("tags.csv")).map((t) => [t.tag_id, t.tag_name]));
  const rows = parseCsv(await findFile("book_tags.csv")).map((r) => ({ book: r.goodreads_book_id, tag: r.tag_id, count: Number(r.count) }));
  // Two versions of books.csv exist:
  //   GitHub: book_id (1..10000, as in ratings.csv) + goodreads_book_id
  //   Kaggle: id      (1..10000, as in ratings.csv) + book_id = the Goodreads id
  const kaggle = books.length && books[0].goodreads_book_id === undefined && books[0].id !== undefined;
  const goodreadsOf = (b) => (kaggle ? b.book_id : b.goodreads_book_id);
  const goodbooksOf = (b) => Number(kaggle ? b.id : b.book_id);
  if (!books.length || goodreadsOf(books[0]) === undefined) throw new Error("books.csv has unexpected columns - delete it and run again to download the GitHub version");
  console.log(`${enriched ? "books_enriched.csv" : `books.csv (${kaggle ? "Kaggle" : "GitHub"} version)`}: ${books.length} books`);
  // authors: "Suzanne Collins, X" (books.csv) or "['Suzanne Collins', 'X']" (books_enriched.csv)
  const authorsOf = (a) => String(a || "").replace(/[[\]'"]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  const info = new Map(books.map((b) => [goodreadsOf(b), { title: b.title, authors: authorsOf(b.authors) }]));
  const goodbooksId = new Map(books.map((b) => [goodreadsOf(b), goodbooksOf(b)]));
  const tags = readerTags(tagNames, rows, info, books.length);

  // goodbooks book_id -> our books.id
  const { rows: ours } = await pool.query(`SELECT id, goodbooks_id, title FROM books WHERE goodbooks_id IS NOT NULL;`);
  const ourId = new Map(ours.map((r) => [Number(r.goodbooks_id), r.id]));

  // Check that books.csv and our books table mean the SAME book by the same number:
  // compare the start of the titles (our titles were cleaned, so only a loose check)
  const key = (t) => String(t || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "").slice(0, 12);
  const csvTitle = new Map(books.map((b) => [goodbooksOf(b), b.title]));
  let same = 0, checked = 0;
  const differ = [];
  for (const r of ours) {
    const t = csvTitle.get(Number(r.goodbooks_id));
    if (t === undefined) continue;
    checked++;
    if (key(t) === key(r.title) || key(t).startsWith(key(r.title)) || key(r.title).startsWith(key(t))) same++;
    else if (differ.length < 5) differ.push(`#${r.goodbooks_id}: "${t}" vs ours "${r.title}"`);
  }
  console.log(`Check: ${same} of ${checked} books have the same title in books.csv and in our table (${checked ? Math.round((100 * same) / checked) : 0}%).`);
  differ.forEach((d) => console.log(`  differs ${d}`));
  if (checked && same / checked < 0.9) throw new Error("books.csv numbers do not match our books table - nothing saved (wrong books.csv?)");
  const out = [];
  let matched = 0;
  for (const [gr, list] of tags) {
    const id = ourId.get(goodbooksId.get(gr));
    if (!id) continue;
    matched++;
    for (const t of list) out.push([id, t.tag, t.count]);
  }
  console.log(`Books with tags: ${tags.size} of ${books.length} in goodbooks; ${matched} of them are in our books table. Tags to save: ${out.length}.`);
  for (const gr of [...tags.keys()].slice(0, 5)) console.log(`  ${info.get(gr)?.title}: ${tags.get(gr).map((t) => t.tag).join(", ")}`);

  if (!APPLY) { console.log("\nDry run - nothing saved. Add --apply to save."); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS book_reader_tags (
        book_id int  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        tag     text NOT NULL,
        count   int  NOT NULL,           -- how many readers put the book on this shelf
        PRIMARY KEY (book_id, tag)
      );`);
    await client.query(`DELETE FROM book_reader_tags;`); // only this table
    for (let i = 0; i < out.length; i += 5000) {
      const part = out.slice(i, i + 5000);
      await client.query(
        `INSERT INTO book_reader_tags (book_id, tag, count)
         SELECT * FROM unnest($1::int[], $2::text[], $3::int[]);`,
        [part.map((r) => r[0]), part.map((r) => r[1]), part.map((r) => r[2])]
      );
    }
    await client.query("COMMIT");
    console.log(`\nSaved ${out.length} tags into book_reader_tags.`);
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
