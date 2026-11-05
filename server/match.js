/**
 * "92% match" on a book card - the proposal (section 3.3): book cards show the
 * recommendation engine's score.
 *
 * The engine's scores have no fixed scale (hybrid: CF + genre popularity; books
 * without ratings: CBF content similarity; the chatbot's search: cosine
 * similarity to the description), so the percent is RELATIVE: the book's score
 * compared with the best book of the same kind in the same list -
 *   match = 99 * score / best score        (the top pick is 99%, never "100%")
 * Books without ratings (isNew - only CBF judges them) are compared with each
 * other, not with the rated books, because their scores come from another model.
 * A score of 0 or less (no evidence for the book) gets no percent.
 *
 *   const { addMatch } = require("./match");
 *   addMatch(recommendations)                       // uses b.score
 *   addMatch(books, (b) => b.similarity)            // any other score
 */

function addMatch(books, scoreOf = (b) => b.score) {
  const best = new Map(); // kind -> best score
  const kind = (b) => (b.isNew ? "new" : "rated");
  for (const b of books) {
    const s = Number(scoreOf(b));
    if (s > (best.get(kind(b)) ?? 0)) best.set(kind(b), s);
  }
  return books.map((b) => {
    const s = Number(scoreOf(b));
    const top = best.get(kind(b));
    return s > 0 && top ? { ...b, match: Math.max(1, Math.round((99 * s) / top)) } : b;
  });
}

module.exports = { addMatch };
