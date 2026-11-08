/**
 * Admin pages' API - for the project team only (ADMIN_EMAILS in .env, see server/mailer.js).
 * The signed-in user's email (in Neon Auth) must be on that list; anyone else gets 403.
 *
 *   GET  /api/admin/summary                              { admin, pendingBookClaims, ... } - for the bell in the header
 *                                                        (any signed-in user may ask: non-admins just get { admin: false })
 *   GET  /api/admin/me                                   { admin: true } - is this user an admin?
 *   GET  /api/admin/author-requests?status=pending|all   requests with the user's name and email
 *   POST /api/admin/author-requests/:id/reject           { note }
 *
 *   GET  /api/admin/book-claims?status=pending|all       "this is my book" claims that need the team
 *   POST /api/admin/book-claims/:id/approve|reject       { note }
 *   GET  /api/admin/uploads                              books uploaded by authors (newest first)
 *   DELETE /api/admin/uploads/:bookId                    remove an uploaded book from the catalog
 *
 *   GET  /api/admin/reports?status=open|all              reported reviews / discussion messages, one row per item
 *   POST /api/admin/reports/decide                       { kind, bookId, id, action: hide | keep | restore }
 *        hide: hidden from readers (the writer still sees it) · keep: shown, the reports closed ·
 *        restore: an item hidden before is shown again. (Reports: server/social-routes.js)
 *
 * Authors are verified by their publisher (server/author-verification.js); the team
 * sees the requests, decides book claims, and can remove uploaded books.
 */

const express = require("express");
const { isAdminEmail } = require("./mailer");
const { profilesTable } = require("./author-profiles");

module.exports = function adminRoutes({ db, requireUser, h }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  const emailOf = async (req) =>
    (await db.query(`SELECT email FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId])).rows[0]?.email || null;

  // The bell: asked on every page by every signed-in user, so no 403 here - just "not an admin"
  router.get("/summary", wrap(async (req, res) => {
    if (!isAdminEmail(await emailOf(req))) return res.json({ admin: false });
    const count = (sql) => db.query(sql).then((r) => r.rows[0].n).catch((err) => (err.code === "42P01" ? 0 : Promise.reject(err)));
    const [claims, waiting, reports] = await Promise.all([
      count(`SELECT count(*)::int AS n FROM book_claims WHERE status = 'pending';`),
      count(`SELECT count(*)::int AS n FROM author_requests WHERE status = 'pending';`),
      count(`SELECT count(DISTINCT (kind, book_id, coalesce(review_user_id, 0), coalesce(post_id, 0)))::int AS n FROM book_reports WHERE status = 'open';`).catch(() => 0),
    ]);
    // the bell counts what needs the TEAM: book claims and reported items (author requests wait for the publisher)
    res.json({ admin: true, pendingBookClaims: claims, waitingForPublisher: waiting, openReports: reports });
  }));

  router.use(async (req, res, next) => {
    try {
      const email = await emailOf(req);
      // signedInAs: only the user's OWN email, to see at once if they are signed in with the wrong account
      if (!isAdminEmail(email)) return res.status(403).json({ error: "this page is for the project team only", signedInAs: email });
      next();
    } catch (err) { next(err); }
  });

  router.get("/me", (req, res) => res.json({ admin: true }));

  router.get("/author-requests", wrap(async (req, res) => {
    const all = req.query.status === "all";
    const { rows } = await db.query(
      `SELECT r.id, r.status, r.pen_name, r.books, r.message, r.note, r.created_at, r.decided_at,
              r.publisher_name, r.publisher_email, r.email_sent_at, r.publisher_decision, r.publisher_decided_at,
              r.user_id, a.name, a.email, u.user_type,
              (SELECT count(*)::int FROM author_books ab WHERE ab.user_id = r.user_id) AS linked_count
       FROM author_requests r JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
       ${all ? "" : "WHERE r.status = 'pending'"}
       ORDER BY (r.status = 'pending') DESC, r.created_at DESC
       LIMIT 200;`
    );
    res.json({
      requests: rows.map((r) => ({
        id: Number(r.id), status: r.status, penName: r.pen_name, books: r.books, message: r.message, note: r.note,
        createdAt: r.created_at, decidedAt: r.decided_at, name: r.name, email: r.email, userType: r.user_type,
        userId: r.user_id, linkedCount: r.linked_count, // linked already -> the admin page links to the author's page
        publisherName: r.publisher_name, publisherEmail: r.publisher_email, emailSentAt: r.email_sent_at,
        publisherDecision: r.publisher_decision, publisherDecidedAt: r.publisher_decided_at,
      })),
    });
  }));

  const pendingRequest = async (id) => {
    const { rows } = await db.query(`SELECT id, user_id, status, pen_name FROM author_requests WHERE id = $1;`, [id]);
    if (!rows[0]) throw new BadRequest(`no request #${id}`);
    if (rows[0].status !== "pending") throw new BadRequest(`request #${id} is already ${rows[0].status}`);
    return rows[0];
  };
  const noteOf = (v) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > 1000) throw new BadRequest("note: up to 1000 characters");
    return t || null;
  };

  router.post("/author-requests/:id/reject", wrap(async (req, res) => {
    const r = await pendingRequest(checkId(req.params.id));
    await db.query(`UPDATE author_requests SET status = 'rejected', note = $2, decided_at = now() WHERE id = $1;`, [r.id, noteOf(req.body.note)]);
    res.json({ ok: true });
  }));

  // ---------- book claims ("this is my book" when the name on the book doesn't match) ----------
  router.get("/book-claims", wrap(async (req, res) => {
    const all = req.query.status === "all";
    const { rows } = await db.query(
      `SELECT c.id, c.status, c.message, c.note, c.created_at, c.decided_at, c.user_id,
              b.id AS book_id, b.title, b.authors, b.thumbnail_url, a.name, a.email,
              coalesce(p.verified_names, '{}') AS verified_names, p.pen_name
       FROM book_claims c JOIN books b ON b.id = c.book_id
       JOIN users u ON u.id = c.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
       LEFT JOIN author_profiles p ON p.user_id = c.user_id
       ${all ? "" : "WHERE c.status = 'pending'"}
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200;`
    );
    res.json({
      claims: rows.map((c) => ({
        id: Number(c.id), status: c.status, message: c.message, note: c.note, createdAt: c.created_at, decidedAt: c.decided_at,
        userId: c.user_id, name: c.name, email: c.email, penName: c.pen_name, verifiedNames: c.verified_names,
        book: { id: c.book_id, title: c.title, authors: c.authors, thumbnail_url: c.thumbnail_url },
      })),
    });
  }));

  const pendingClaim = async (id) => {
    const { rows } = await db.query(`SELECT id, user_id, book_id, status FROM book_claims WHERE id = $1;`, [id]);
    if (!rows[0]) throw new BadRequest(`no claim #${id}`);
    if (rows[0].status !== "pending") throw new BadRequest(`claim #${id} is already ${rows[0].status}`);
    return rows[0];
  };
  router.post("/book-claims/:id/approve", wrap(async (req, res) => {
    const c = await pendingClaim(checkId(req.params.id));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO author_books (user_id, book_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`, [c.user_id, c.book_id]);
      await client.query(`UPDATE book_claims SET status = 'approved', note = $2, decided_at = now() WHERE id = $1;`, [c.id, noteOf(req.body.note)]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));
  router.post("/book-claims/:id/reject", wrap(async (req, res) => {
    const c = await pendingClaim(checkId(req.params.id));
    await db.query(`UPDATE book_claims SET status = 'rejected', note = $2, decided_at = now() WHERE id = $1;`, [c.id, noteOf(req.body.note)]);
    res.json({ ok: true });
  }));

  // ---------- books uploaded by authors ----------
  router.get("/uploads", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT b.id, b.title, b.authors, b.thumbnail_url, b.description, up.created_at, up.user_id, a.email,
              coalesce(p.pen_name, a.name) AS uploader
       FROM author_uploads up JOIN books b ON b.id = up.book_id
       JOIN users u ON u.id = up.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
       LEFT JOIN author_profiles p ON p.user_id = up.user_id
       ORDER BY up.created_at DESC LIMIT 100;`
    ).catch((err) => (err.code === "42P01" ? { rows: [] } : Promise.reject(err)));
    res.json({
      uploads: rows.map((b) => ({
        id: b.id, title: b.title, authors: b.authors, thumbnail_url: b.thumbnail_url,
        description: (b.description || "").slice(0, 300), createdAt: b.created_at, userId: b.user_id, uploader: b.uploader, email: b.email,
      })),
    });
  }));
  // only a book that an author UPLOADED can be removed here (never a catalog book)
  router.delete("/uploads/:bookId", wrap(async (req, res) => {
    const bookId = checkId(req.params.bookId);
    let rowCount;
    try {
      ({ rowCount } = await db.query(
        `DELETE FROM books WHERE id = $1 AND id IN (SELECT book_id FROM author_uploads WHERE book_id = $1);`, [bookId]
      ));
    } catch (err) {
      // another table points at the book without ON DELETE CASCADE - nothing was deleted
      if (err.code === "23503") return res.status(409).json({ error: `other data still refers to this book (${err.table || "a table"}) - not removed` });
      throw err;
    }
    if (!rowCount) return res.status(404).json({ error: "not an uploaded book" });
    res.json({ ok: true });
  }));

  // ---------- reports ----------
  // One row per reported item: what it says, who wrote it (also behind a pen name), why and how many reported it
  router.get("/reports", wrap(async (req, res) => {
    const all = req.query.status === "all";
    const { rows } = await db.query(
      `SELECT r.kind, r.book_id, r.review_user_id, r.post_id, b.title,
              count(DISTINCT r.reporter_id)::int AS readers,
              array_agg(DISTINCT r.reason) AS reasons,
              min(r.created_at) AS first_at, max(r.created_at) AS last_at,
              bool_or(r.status = 'open') AS open,
              (array_agg(r.status ORDER BY r.created_at DESC))[1] AS status,
              coalesce(rv.body, p.body) AS body,
              coalesce(rv.alias, p.alias) AS alias,
              coalesce(rv.hidden, p.hidden) AS hidden,
              a.name, a.email
       FROM book_reports r
       JOIN books b ON b.id = r.book_id
       LEFT JOIN book_reviews rv ON r.kind = 'review' AND rv.user_id = r.review_user_id AND rv.book_id = r.book_id
       LEFT JOIN book_posts p ON r.kind = 'post' AND p.id = r.post_id
       LEFT JOIN users u ON u.id = coalesce(rv.user_id, p.user_id)
       LEFT JOIN neon_auth."user" a ON a.id = u.auth_user_id
       GROUP BY r.kind, r.book_id, r.review_user_id, r.post_id, b.title, rv.body, p.body, rv.alias, p.alias, rv.hidden, p.hidden, a.name, a.email
       ${all ? "" : "HAVING bool_or(r.status = 'open')"}
       ORDER BY bool_or(r.status = 'open') DESC, max(r.created_at) DESC
       LIMIT 200;`
    ).catch((err) => (err.code === "42P01" || err.code === "42703" ? { rows: [] } : Promise.reject(err))); // db/create-community-extras.js not run
    res.json({
      reports: rows.map((r) => ({
        kind: r.kind, bookId: r.book_id, id: Number(r.kind === "review" ? r.review_user_id : r.post_id),
        title: r.title, body: r.body, alias: r.alias, hidden: Boolean(r.hidden), deleted: r.body === null,
        writer: r.name, email: r.email, readers: r.readers, reasons: r.reasons,
        firstAt: r.first_at, lastAt: r.last_at, status: r.open ? "open" : r.status,
      })),
    });
  }));

  router.post("/reports/decide", wrap(async (req, res) => {
    const { kind, action } = req.body;
    if (!["review", "post"].includes(kind)) throw new BadRequest("kind must be review or post");
    if (!["hide", "keep", "restore"].includes(action)) throw new BadRequest("action must be hide, keep or restore");
    const bookId = checkId(req.body.bookId);
    const id = checkId(req.body.id);
    const hide = action === "hide";
    const { rowCount } = kind === "review"
      ? await db.query(`UPDATE book_reviews SET hidden = $3 WHERE user_id = $1 AND book_id = $2;`, [id, bookId, hide])
      : await db.query(`UPDATE book_posts SET hidden = $2 WHERE id = $1;`, [id, hide]);
    if (!rowCount) return res.status(404).json({ error: "it was deleted meanwhile" });
    const same = kind === "review" ? `kind = 'review' AND review_user_id = $1 AND book_id = $2` : `kind = 'post' AND post_id = $1 AND book_id = $2`;
    await db.query(`UPDATE book_reports SET status = $3, decided_at = now() WHERE ${same};`, [id, bookId, hide ? "hidden" : "dismissed"]);
    res.json({ ok: true });
  }));

  return router;
};
