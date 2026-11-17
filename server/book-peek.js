/**
 * "Peek" data for the floating card shown when hovering a book (For You shelves,
 * "Similar in spirit", search results):
 *   blurb       - the start of the description (~260 characters, cut at a word)
 *   avgRating   - the average of ALL ratings of the book: goodbooks dataset + BookBridge users
 *   ratingCount - how many ratings that average is based on
 *
 * The dataset never changes, so its sums are read ONCE per server run (one pass,
 * a few seconds, ~10k books kept in memory). Per request only user_ratings (small)
 * is read. Averaging millions of dataset rows on every page load made pages hang.
 *
 *   const { addPeek, warmPeek } = require("./book-peek");
 *   warmPeek(db);                         // at server start
 *   const books2 = await addPeek(db, books);   // adds the three fields to each book
 */

// "A long description..." -> about 260 characters, cut at a word, with "…"
function shorten(text, max = 260) {
  const t = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t || null;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[\s,;:.\-–]+$/, "")}…`;
}

let datasetSums = null; // Promise<Map<book_id, { s, n }>>
function warmPeek(db) {
  if (!datasetSums) {
    const t = Date.now();
    datasetSums = db
      .query(`SELECT book_id, sum(rating)::int AS s, count(*)::int AS n FROM dataset_ratings GROUP BY book_id;`)
      .then(({ rows }) => {
        console.log(`[peek] dataset ratings summed for ${rows.length} books in ${Date.now() - t} ms`);
        return new Map(rows.map((r) => [r.book_id, r]));
      })
      .catch((err) => {
        console.warn("[peek] could not sum dataset ratings:", err.message);
        datasetSums = null; // try again on the next request
        return new Map();
      });
  }
  return datasetSums;
}

/** Map<bookId, { blurb, avgRating, ratingCount }> */
async function peekInfo(db, ids) {
  ids = [...new Set(ids)];
  if (!ids.length) return new Map();
  const [sums, { rows: books }, { rows: mine }] = await Promise.all([
    warmPeek(db),
    db.query(`SELECT id, left(description, 400) AS d FROM books WHERE id = ANY($1::int[]);`, [ids]),
    db.query(`SELECT book_id, sum(rating)::int AS s, count(*)::int AS n FROM user_ratings WHERE book_id = ANY($1::int[]) GROUP BY book_id;`, [ids]),
  ]);
  const users = new Map(mine.map((r) => [r.book_id, r]));
  return new Map(books.map((b) => {
    const d = sums.get(b.id), u = users.get(b.id);
    const n = (d?.n || 0) + (u?.n || 0);
    const avg = n ? Math.round((((d?.s || 0) + (u?.s || 0)) / n) * 100) / 100 : null;
    return [b.id, { blurb: shorten(b.d), avgRating: avg, ratingCount: n }];
  }));
}

/** The same books, each with blurb / avgRating / ratingCount added. */
async function addPeek(db, books) {
  const info = await peekInfo(db, books.map((b) => b.id));
  return books.map((b) => ({ ...b, ...(info.get(b.id) || {}) }));
}

module.exports = { addPeek, peekInfo, warmPeek, shorten };
