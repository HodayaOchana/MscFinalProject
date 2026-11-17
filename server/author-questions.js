/**
 * Readers' questions to an author, mounted under /api/me (signed-in users).
 * A question = a discussion message on one of the author's books (author_books) that starts with
 * "Question for the author:" (the "Ask the author" button on the book page writes it so).
 * It counts as answered once the author replied to it.
 *
 *   GET /api/me/author/questions   { questions: [{ id, bookId, bookTitle, body, from, createdAt, answered }], open }
 *     newest first, the last 50; `open` = how many are not answered yet (the badge on the Account page)
 * Not an author / no social tables yet -> an empty list.
 */

module.exports = function authorQuestionRoutes(router, { db, h }) {
  const { wrap } = h;

  router.get("/author/questions", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT p.id, p.book_id, b.title AS book_title, p.body, p.created_at, p.alias, a.name,
              EXISTS (SELECT 1 FROM book_posts r WHERE r.parent_id = p.id AND r.user_id = $1) AS answered
       FROM book_posts p
       JOIN author_books ab ON ab.book_id = p.book_id AND ab.user_id = $1
       JOIN books b ON b.id = p.book_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN neon_auth."user" a ON a.id = u.auth_user_id
       WHERE p.parent_id IS NULL AND p.user_id <> $1 AND NOT coalesce(p.hidden, false)
         AND p.body ILIKE 'Question for the author:%'
       ORDER BY p.created_at DESC LIMIT 50;`,
      [req.user.id]
    ).catch((err) => (["42P01", "42703"].includes(err.code) ? { rows: [] } : Promise.reject(err)));
    const first = (n) => { const [f, l] = String(n || "A reader").trim().split(/\s+/); return l ? `${f} ${l[0]}.` : f; };
    const questions = rows.map((r) => ({
      id: Number(r.id), bookId: r.book_id, bookTitle: r.book_title,
      body: r.body.replace(/^Question for the author:\s*/i, ""),
      from: r.alias || first(r.name), createdAt: r.created_at, answered: r.answered,
    }));
    res.json({ questions, open: questions.filter((q) => !q.answered).length });
  }));
};
