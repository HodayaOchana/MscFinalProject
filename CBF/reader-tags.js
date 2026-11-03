/**
 * Reader tags from goodbooks-10k (book_tags.csv + tags.csv): the "shelves"
 * Goodreads readers put books on - "dystopian", "vampires", "coming-of-age",
 * "made-me-cry"... Much more specific than a genre.
 *
 * Most shelves are NOT about the book ("to-read", "owned", "kindle",
 * "read-in-2015", "favorites"), so they are removed:
 *   - shelves on more than half of all books (to-read, fiction, owned...)
 *   - shelf names that describe the reader, not the book (NOISE below)
 *   - the book's own author / title words ("j-k-rowling", "harry-potter")
 * Then near-duplicates are merged (dystopia = dystopian, ya = young adult,
 * childrens = children-s = children) and the top TOP tags per book are kept
 * (each used by at least MIN_COUNT readers for that book).
 *
 * Used by db/load-reader-tags.js (saves them) and CBF/embed-books.js --text v5.
 */

const TOP = 10;
const MIN_COUNT = 5;
const MAX_SHARE = 0.5; // a shelf on more than half of the books says nothing about any of them

const NOISE = new RegExp([
  "^to-", "read", "own", "kindle", "e-?books?", "audio", "librar", "default", "wish", "^my-?", "favo", "^faves?$",
  "buy", "bought", "borrow", "shelf", "^\\d", "\\d{4}", "club", "dnf", "abandon", "tbr", "^series$", "^novels?$",
  "^books?$", "^fiction$", "^adult$", "^general", "^other", "maybe", "later", "^on-", "^have", "^from-", "gift",
  "loan", "need", "want", "^i-", "^not-", "finished", "^re-", "^the-", "-books?$", "^got", "nook", "^best",
  "^top-", "^all-", "^must", "stars?$", "paperback", "hardcover", "signed", "physical", "print", "calibre",
  "^english", "^literature$", "^fiction-", "^novel-", "^default", "^unread", "^skimmed", "^school-", "^memorable",
].join("|"));

// merge spelling variants into one word
const SAME = new Map([
  ["ya", "young adult"], ["young adult fiction", "young adult"], ["ya fiction", "young adult"], ["teen", "young adult"],
  ["childrens", "children"], ["children s", "children"], ["children s books", "children"], ["kids", "children"],
  ["classic", "classics"], ["dystopia", "dystopian"], ["vampire", "vampires"], ["sci fi", "science fiction"],
  ["scifi", "science fiction"], ["non fiction", "nonfiction"], ["historical", "historical fiction"],
  ["graphic novel", "graphic novels"], ["comic", "comics"], ["humour", "humor"], ["funny", "humor"],
  ["mysteries", "mystery"], ["thrillers", "thriller"], ["memoirs", "memoir"], ["biographies", "biography"],
]);

const clean = (name) => String(name || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => clean(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 1);

/**
 * @param tagNames  Map tag_id -> tag_name           (tags.csv)
 * @param rows      [{ book, tag, count }]           (book_tags.csv; book = any book key)
 * @param bookInfo  Map book -> { title, authors }   (to drop the book's own author/title words)
 * @param nBooks    number of books (for MAX_SHARE)
 * @returns Map book -> [{ tag, count }] (cleaned, merged, best first, at most TOP)
 */
function readerTags(tagNames, rows, bookInfo, nBooks) {
  const booksPerTag = new Map();
  for (const r of rows) booksPerTag.set(r.tag, (booksPerTag.get(r.tag) || 0) + 1);
  const keep = (id) => {
    const name = tagNames.get(id);
    return name && name.length > 2 && !NOISE.test(name) && (booksPerTag.get(id) || 0) <= nBooks * MAX_SHARE && /[a-z]/.test(name);
  };
  const byBook = new Map();
  for (const r of rows) {
    if (r.count < MIN_COUNT || !keep(r.tag)) continue;
    let name = clean(tagNames.get(r.tag));
    name = SAME.get(name) || name;
    const info = bookInfo.get(r.book);
    if (info) {
      // "harry potter", "j k rowling": the title / author, not a description
      // (author words both ways: "J.K. Rowling" -> "j k rowling" and "jk rowling")
      const authorWords = (info.authors || []).flatMap((a) => [...words(a), ...words(String(a).replace(/[^A-Za-z\s]/g, ""))]);
      const own = new Set([...words(info.title), ...authorWords]);
      const w = words(name);
      if (w.length && w.every((x) => own.has(x) || x.length < 2)) continue;
    }
    if (!byBook.has(r.book)) byBook.set(r.book, new Map());
    const m = byBook.get(r.book);
    m.set(name, (m.get(name) || 0) + r.count); // merged variants add up
  }
  const out = new Map();
  for (const [book, m] of byBook) {
    out.set(book, [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, TOP));
  }
  return out;
}

module.exports = { readerTags, TOP, MIN_COUNT, MAX_SHARE };
