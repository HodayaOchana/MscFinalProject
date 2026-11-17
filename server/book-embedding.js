/**
 * Content features for ONE new book (a book an author uploads), so CBF can
 * recommend it at once - before anyone has rated it (the proposal's cold start
 * for new books).
 *
 *   1. embedding  - the SAME model and text as CBF/embed-books.js:
 *                   Xenova/all-mpnet-base-v2, text v1 = "title. description[:1000]",
 *                   mean pooling, normalized (768 numbers)
 *   2. neighbours - the SAME rule as CBF/train-cbf.js: cosine of CENTERED
 *                   embeddings (the average embedding of all English books is
 *                   subtracted), top 50, only similarity > 0. Saved in BOTH
 *                   directions in content_similarity:
 *                     (new book -> its neighbours)  used when someone rates the new book
 *                     (neighbour -> new book)       makes the new book a candidate for
 *                                                   everyone who rated a neighbour
 *
 * The model is loaded on the first upload (a few seconds; the very first time
 * it is downloaded to the local cache, ~420 MB - already there if you ran
 * embed-books.js on this computer).
 */

const MODEL = "Xenova/all-mpnet-base-v2";
const DIM = 768;
const TOP_K = 50;

let extractorPromise = null;
function extractor() {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers")
      .then(({ pipeline }) => pipeline("feature-extraction", MODEL))
      .catch((err) => { extractorPromise = null; throw err; });
  }
  return extractorPromise;
}

/** text v1 of CBF/embed-books.js */
const embeddingText = (title, description) => {
  const desc = description ? String(description).slice(0, 1000) : "";
  return desc ? `${title}. ${desc}` : String(title);
};

/** -> number[768] (normalized) */
async function embedBook(title, description, { embed } = {}) {
  const text = embeddingText(title, description);
  if (embed) return embed(text); // tests pass their own
  const out = await (await extractor())(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

const toVector = (arr) => `[${arr.join(",")}]`;

// the average embedding of all English books - changes very little when one book is
// added, so it is computed once per server start
let meanPromise = null;
function meanEmbedding(db) {
  if (!meanPromise) {
    meanPromise = db
      .query(`SELECT avg(embedding)::text AS m FROM books WHERE embedding IS NOT NULL AND language = 'en';`)
      .then((r) => r.rows[0].m)
      .catch((err) => { meanPromise = null; throw err; });
  }
  return meanPromise;
}

/**
 * Saves the neighbours of book `bookId` (its embedding must be saved already).
 * `client` = a db client inside the caller's transaction. Returns how many neighbours.
 */
async function saveNeighbours(client, db, bookId) {
  const mean = await meanEmbedding(db);
  if (!mean) return 0;
  const { rows } = await client.query(
    `WITH m AS (SELECT $2::vector AS v),
          q AS (SELECT b.embedding - m.v AS v FROM books b, m WHERE b.id = $1)
     SELECT o.id, 1 - ((o.embedding - m.v) <=> q.v) AS sim
     FROM books o, m, q
     WHERE o.embedding IS NOT NULL AND o.language = 'en' AND o.id <> $1
     ORDER BY (o.embedding - m.v) <=> q.v
     LIMIT ${TOP_K};`,
    [bookId, mean]
  );
  const keep = rows.filter((r) => r.sim > 0);
  if (!keep.length) return 0;
  const ids = keep.map((r) => r.id);
  const sims = keep.map((r) => r.sim);
  await client.query(
    `INSERT INTO content_similarity (book_id, neighbor_id, similarity)
     SELECT $1, n, s FROM unnest($2::int[], $3::real[]) AS t(n, s)
     UNION ALL
     SELECT n, $1, s FROM unnest($2::int[], $3::real[]) AS t(n, s)
     ON CONFLICT (book_id, neighbor_id) DO UPDATE SET similarity = EXCLUDED.similarity;`,
    [bookId, ids, sims]
  );
  return keep.length;
}

module.exports = { embedBook, embeddingText, saveNeighbours, toVector, extractor, DIM, MODEL, resetForTests: () => { meanPromise = null; } };
