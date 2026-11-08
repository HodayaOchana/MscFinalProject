/**
 * Book page views, mounted under /api/me (signed-in users only).
 * Table: user_book_views (db/create-book-views-table.js) - one counter row per user and book.
 *
 *   POST /api/me/book-views   { bookId }   - the book page sends this after 8 seconds open
 *
 * A visit counts only 30 minutes after the last counted one; only the 200 most recent
 * books per user are kept. If the table is missing, nothing happens (the page works as before).
 */

const REVISIT_MIN = 30;  // a new visit only after 30 minutes
const KEEP = 200;        // books kept per user

module.exports = function bookViewRoutes(router, { db, h }) {
  const { wrap, checkId } = h;

  router.post("/book-views", wrap(async (req, res) => {
    const bookId = checkId(req.body.bookId);
    try {
      const { rows } = await db.query(
        `INSERT INTO user_book_views (user_id, book_id)
         SELECT $1, id FROM books WHERE id = $2
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           views = user_book_views.views + 1,
           last_viewed_at = now()
         WHERE user_book_views.last_viewed_at < now() - make_interval(mins => $3)
         RETURNING views;`,
        [req.user.id, bookId, REVISIT_MIN]
      );
      if (rows[0]?.views === 1) {
        // a new book for this user: keep only the most recent KEEP
        await db.query(
          `DELETE FROM user_book_views WHERE user_id = $1 AND book_id NOT IN
             (SELECT book_id FROM user_book_views WHERE user_id = $1 ORDER BY last_viewed_at DESC LIMIT $2);`,
          [req.user.id, KEEP]
        );
      }
      res.json({ counted: rows.length > 0, views: rows[0]?.views ?? null });
    } catch (err) {
      if (err.code === "42P01") return res.json({ counted: false, tableMissing: true });
      throw err;
    }
  }));
};
