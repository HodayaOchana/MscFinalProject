/**
 * Why a book is recommended - one short sentence in the reader's words, shown on
 * the book card instead of the model's technical reason:
 *
 *   CF ("Readers with similar taste liked it")
 *        -> "Readers who loved Harry Potter also loved this"
 *           the reader's loved book (4-5 stars) most similar BY READERS (item_similarity)
 *   new book, CBF ("Similar in content to books you liked")
 *        -> "Similar to Twilight, which you loved"
 *           the loved book most similar IN CONTENT (content_similarity)
 *   "Popular in your genres"  -> "A favorite of Fantasy readers"  (a chosen genre the book is in)
 *   "Popular with readers"    -> "Loved by many readers"
 *
 * Built AFTER the model chose the books, from the same similarity tables the model
 * uses - it explains the choice, it does not change it. When no loved book is
 * close enough (or the reader rated nothing yet), the general sentence stays.
 *
 *   const { explainRecommendations } = require("./explain");
 *   recs = await explainRecommendations(db, userId, recs, genres)   // sets reasonText (and reasonBook)
 */

const path = require("path");
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));

const LOVED = 4; // stars that count as "you loved it"

// the genre keys of a book (as in For You's shelves): 10K books by main_genres, Google books by categories
const KEYS = new Map();
for (const g of GENRES) {
  for (const v of g.goodreads) KEYS.set(`r:${v}`, [...(KEYS.get(`r:${v}`) || []), g.key]);
  for (const v of g.google) KEYS.set(`g:${v}`, [...(KEYS.get(`g:${v}`) || []), g.key]);
}
const LABEL = new Map(GENRES.map((g) => [g.key, g.label]));
const genresOf = (b) => (b.goodbooks_id ? (b.main_genres || []).map((v) => `r:${v}`) : (b.categories || []).map((v) => `g:${v}`))
  .flatMap((k) => KEYS.get(k) || []);

// "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)" -> "Harry Potter and the Sorcerer's Stone"
const shortTitle = (t) => {
  const s = String(t || "").replace(/\s*\(.*\)\s*$/, "").replace(/:.*$/, "").trim();
  return s.length > 40 ? `${s.slice(0, 38).replace(/\s+\S*$/, "")}…` : s;
};

async function explainRecommendations(db, userId, recs, chosenGenres = []) {
  if (!recs.length) return recs;
  const ids = recs.map((r) => r.id);
  const isCf = (r) => /\(CF\)/.test(r.reason || "");
  const isCbf = (r) => /\(CBF\)/.test(r.reason || "");

  // for each recommended book: the loved book that is closest to it (by readers for CF, by content for CBF)
  const closest = async (table, recIds) => {
    if (!recIds.length) return new Map();
    const { rows } = await db.query(
      `SELECT DISTINCT ON (s.neighbor_id) s.neighbor_id AS rec, b.id, b.title, b.thumbnail_url
       FROM user_ratings u
       JOIN ${table} s ON s.book_id = u.book_id AND s.neighbor_id = ANY($2::int[])
       JOIN books b ON b.id = u.book_id
       WHERE u.user_id = $1 AND u.rating >= ${LOVED}
       ORDER BY s.neighbor_id, s.similarity * u.rating DESC;`,
      [userId, recIds]
    );
    return new Map(rows.map((r) => [r.rec, { id: r.id, title: shortTitle(r.title), thumbnail_url: r.thumbnail_url }]));
  };
  const [byReaders, byContent, { rows: info }] = await Promise.all([
    closest("item_similarity", recs.filter(isCf).map((r) => r.id)),
    closest("content_similarity", recs.filter(isCbf).map((r) => r.id)),
    db.query(`SELECT id, goodbooks_id, main_genres, categories FROM books WHERE id = ANY($1::int[]);`, [ids]),
  ]);
  const keysOf = new Map(info.map((b) => [b.id, genresOf(b)]));

  return recs.map((r) => {
    let text;
    let reasonBook = null; // the reader's own loved book behind this pick - the card shows its cover
    if (isCf(r)) {
      reasonBook = byReaders.get(r.id);
      text = reasonBook ? `Readers who loved ${reasonBook.title} also loved this` : "Readers with your taste loved it";
    } else if (isCbf(r)) {
      reasonBook = byContent.get(r.id);
      text = reasonBook ? `Similar to ${reasonBook.title}, which you loved` : "Similar to books you loved";
    } else {
      const g = (keysOf.get(r.id) || []).find((k) => chosenGenres.includes(k));
      text = r.reason === "Popular in your genres" && g ? `A favorite of ${LABEL.get(g)} readers` : "Loved by many readers";
    }
    return { ...r, reasonText: text, ...(reasonBook ? { reasonBook } : {}) };
  });
}

module.exports = { explainRecommendations, shortTitle };
