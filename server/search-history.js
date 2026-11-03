/**
 * Search history routes, mounted under /api/me (signed-in users only).
 * Table: user_searches (db/create-search-table.js) - ONE row per user and search
 * text (upper/lower case and extra spaces ignored), with search_count.
 *
 *   GET    /api/me/searches                 { searches: [{ query, at, count }] }  - the last 8, newest first
 *   POST   /api/me/searches                 { query, resultsCount } -> { id, count }  (count + 1 if searched before;
 *                                         a search with 0 results is NOT saved)
 *   POST   /api/me/searches/:id/click       { bookId }  - the result opened from that search
 *   DELETE /api/me/searches?query=harry      remove one search from the list
 *   DELETE /api/me/searches                  clear the whole history
 *
 * If the table was not created yet, GET answers an empty list and POST does
 * nothing - the Search page keeps working.
 *
 * Kept for the recommender later: what was searched, how often, and the book chosen.
 */

const RECENT = 8;        // shown under the search box
const KEEP = 500;        // different searches kept per user (the oldest are deleted)
const REPEAT_SEC = 30;   // the same search again within 30 s is not counted again (double clicks)

const norm = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();
const missing = (err) => err.code === "42P01"; // table does not exist yet
const oldTable = (err) => err.code === "42P10" || err.code === "42703"; // first version of the table

module.exports = function searchHistoryRoutes(router, { db, h }) {
  const { BadRequest, wrap, checkId } = h;
  const upgradeError = () => Object.assign(new Error("search history table is from an older version - run: node db/create-search-table.js"), { status: 500 });

  router.get("/searches", wrap(async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT query, last_searched_at AS at, search_count AS count
         FROM user_searches WHERE user_id = $1
         ORDER BY last_searched_at DESC LIMIT $2;`,
        [req.user.id, RECENT]
      );
      res.json({ searches: rows });
    } catch (err) {
      if (missing(err)) return res.json({ searches: [], tableMissing: true });
      if (oldTable(err)) throw upgradeError();
      throw err;
    }
  }));

  router.post("/searches", wrap(async (req, res) => {
    const query = String(req.body.query || "").replace(/\s+/g, " ").trim();
    if (query.length < 2 || query.length > 200) throw new BadRequest("query must be 2-200 characters");
    const results = Math.max(0, Math.min(Number(req.body.resultsCount) || 0, 10000));
    // a search that found nothing tells us nothing about the reader - not saved
    if (results === 0) return res.json({ id: null, skipped: "no results" });
    try {
      // new text -> a new row; the same text again -> count + 1 (not within 30 s)
      const { rows } = await db.query(
        `INSERT INTO user_searches (user_id, query, query_norm, results_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, query_norm) DO UPDATE SET
           query = EXCLUDED.query,
           results_count = EXCLUDED.results_count,
           search_count = user_searches.search_count
             + CASE WHEN user_searches.last_searched_at > now() - make_interval(secs => $5) THEN 0 ELSE 1 END,
           last_searched_at = now()
         RETURNING id, search_count;`,
        [req.user.id, query, norm(query), results, REPEAT_SEC]
      );
      await db.query(
        `DELETE FROM user_searches WHERE user_id = $1 AND id NOT IN
           (SELECT id FROM user_searches WHERE user_id = $1 ORDER BY last_searched_at DESC LIMIT $2);`,
        [req.user.id, KEEP]
      );
      res.json({ id: Number(rows[0].id), count: rows[0].search_count });
    } catch (err) {
      if (missing(err)) return res.json({ id: null, tableMissing: true });
      if (oldTable(err)) throw upgradeError();
      throw err;
    }
  }));

  router.post("/searches/:id/click", wrap(async (req, res) => {
    const id = checkId(req.params.id);
    const bookId = checkId(req.body.bookId);
    try {
      await db.query(
        `UPDATE user_searches SET clicked_book_id = $3
         WHERE id = $1 AND user_id = $2 AND EXISTS (SELECT 1 FROM books WHERE id = $3);`,
        [id, req.user.id, bookId]
      );
      res.json({ ok: true });
    } catch (err) {
      if (missing(err)) return res.json({ ok: false, tableMissing: true });
      throw err;
    }
  }));

  router.delete("/searches", wrap(async (req, res) => {
    const one = req.query.query !== undefined ? norm(req.query.query) : null;
    try {
      const r = one
        ? await db.query(`DELETE FROM user_searches WHERE user_id = $1 AND query_norm = $2;`, [req.user.id, one])
        : await db.query(`DELETE FROM user_searches WHERE user_id = $1;`, [req.user.id]);
      res.json({ deleted: r.rowCount });
    } catch (err) {
      if (missing(err)) return res.json({ deleted: 0, tableMissing: true });
      throw err;
    }
  }));
};
