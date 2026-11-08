/**
 * The social layer around a book - reviews and discussion (signed-in users).
 * Tables: book_reviews, book_posts, author_books (db/create-social-tables.js).
 *
 *   GET    /api/social/books/:id              reviews + discussion of a book, and what the user may do
 *   PUT    /api/social/books/:id/review       { body }   write / edit your review (you must rate the book first)
 *   DELETE /api/social/books/:id/review       delete your review
 *   POST   /api/social/books/:id/posts        { body, parentId? }   a new post, or a reply to a post
 *   DELETE /api/social/posts/:postId          delete your own post (its replies go with it)
 *   POST   /api/social/posts/:postId/pin      { pinned }   authors of the book only: pin / unpin (one pinned post per book)
 *   POST   /api/social/books/:id/reviews/:reviewId/helpful  { on }   "Helpful" on someone else's review
 *   POST   /api/social/posts/:postId/react    { emoji, on }   a quick reaction (❤️ 😂 😢 🤯) on a message
 *   POST   /api/social/books/:id/report       { kind: review|post, id, reason }   report it to the team: the
 *                                              first report of an item emails the team (ADMIN_EMAILS); after
 *                                              HIDE_AFTER readers it is hidden until the team decides
 *                                              (/admin/reports - server/admin-routes.js)
 *
 * A review or a message can be marked { spoiler: true } - the website blurs it until the
 * reader chooses to see it - and can carry { alias } - a pen name (or "Anonymous reader") shown
 * instead of the writer's name. An alias never carries the Author badge; reports still reach
 * the real account. `who` tells writers apart on one book without saying who they are. (Spoilers, Helpful, reactions, reports: db/create-community-extras.js;
 * without those tables the page works as before.)
 *
 * Names: other users see the first name and the first letter of the last name
 * ("Hodaya A.") - never the email. Text is stored as typed and shown as plain
 * text by the website (React escapes it - no HTML from users ever runs).
 * Limits against floods: 2000 characters, 30 posts per user per hour.
 */

const crypto = require("crypto");
const express = require("express");
const { sendToAdmins } = require("./mailer");

const MAX_LEN = 2000;
const REACTIONS = ["❤️", "😂", "😢", "🤯"];
const RESERVED = /\b(author|admin|bookbridge|moderator|team|staff)\b/i; // not as a pen name
// a pen name: 2-30 letters, digits, spaces and . ' - _  (empty = the real name)
function checkAlias(value, BadRequest) {
  const a = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!a) return null;
  if (a.length < 2 || a.length > 30 || !/^[\p{L}\p{N} .'_-]+$/u.test(a)) throw new BadRequest("a pen name is 2-30 letters or digits");
  if (RESERVED.test(a)) throw new BadRequest("please choose another pen name");
  return a;
}
// the same writer on the same book -> the same short key (no user id leaves the server)
const whoOf = (userId, bookId) => crypto.createHash("sha256").update(`bb-social:${bookId}:${userId}`).digest("base64url").slice(0, 10);
const REPORT_REASONS = ["spoiler", "offensive", "spam", "other"];
const HIDE_AFTER = 3; // readers who reported it -> hidden from everyone but the writer, until the team decides
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const NO_EXTRAS = ["42P01", "42703"]; // db/create-community-extras.js not run yet: table / column missing
const soft = (q, empty = { rows: [] }) => q.catch((err) => (NO_EXTRAS.includes(err.code) ? empty : Promise.reject(err)));
const POSTS_PER_HOUR = 30;

// "Hodaya Amiram" -> "Hodaya A."
function displayName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Reader";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

module.exports = function socialRoutes({ db, requireUser, h }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  const checkBody = (body) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) throw new BadRequest("write something first");
    if (text.length > MAX_LEN) throw new BadRequest(`up to ${MAX_LEN} characters`);
    return text;
  };
  // "A reader reported..." to the team (server/mailer.js: the daily limit, never throws).
  // The first report of an item, and again when it is hidden on its own.
  async function emailTeam({ kind, target, bookId, reason, n, hiddenNow }) {
    const { rows: [item] } = kind === "review"
      ? await db.query(`SELECT rv.body, b.title FROM book_reviews rv JOIN books b ON b.id = rv.book_id WHERE rv.user_id = $1 AND rv.book_id = $2;`, [target, bookId])
      : await db.query(`SELECT p.body, b.title FROM book_posts p JOIN books b ON b.id = p.book_id WHERE p.id = $1;`, [target]);
    if (!item) return;
    const what = kind === "review" ? "a review" : "a discussion message";
    const link = `${APP_URL}/admin/reports`;
    const quote = item.body.length > 400 ? `${item.body.slice(0, 400)}…` : item.body;
    const subject = hiddenNow
      ? `BookBridge: ${what} on "${item.title}" was hidden after ${n} reports`
      : `BookBridge: a reader reported ${what} on "${item.title}"`;
    const head = hiddenNow
      ? `${n} readers reported ${what} on "${item.title}", so it is now hidden until you decide.`
      : `A reader reported ${what} on "${item.title}" (reason: ${reason}).`;
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    await sendToAdmins(subject, `${head}\n\n"${quote}"\n\nHide it or keep it: ${link}\n`, `
      <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
        <p style="margin:0 0 12px">${esc(head)}</p>
        <blockquote style="margin:0;padding:10px 14px;background:#F7F1E8;border-left:3px solid #A24B25;white-space:pre-wrap">${esc(quote)}</blockquote>
        <p style="margin:22px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open the reports</a></p>
      </div>`);
  }

  const isAuthorOf = async (userId, bookId) =>
    (await db.query(`SELECT 1 FROM author_books WHERE user_id = $1 AND book_id = $2;`, [userId, bookId])).rowCount > 0;

  router.get("/books/:id", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const me = req.user.id;
    const [{ rows: reviews }, { rows: posts }, { rows: myRating }, author, { rows: helpful }, { rows: reactions }, { rows: hasAuthor }, extras] = await Promise.all([
      db.query(
        `SELECT rv.user_id, rv.body, rv.updated_at, r.rating, a.name,
                EXISTS (SELECT 1 FROM author_books ab WHERE ab.user_id = rv.user_id AND ab.book_id = rv.book_id) AS is_author
         FROM book_reviews rv
         JOIN users u ON u.id = rv.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
         LEFT JOIN user_ratings r ON r.user_id = rv.user_id AND r.book_id = rv.book_id
         WHERE rv.book_id = $1
         ORDER BY (rv.user_id = $2) DESC, rv.updated_at DESC
         LIMIT 100;`,
        [bookId, me]
      ),
      db.query(
        `SELECT p.id, p.parent_id, p.user_id, p.body, p.pinned, p.created_at, a.name,
                EXISTS (SELECT 1 FROM author_books ab WHERE ab.user_id = p.user_id AND ab.book_id = p.book_id) AS is_author
         FROM book_posts p
         JOIN users u ON u.id = p.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
         WHERE p.book_id = $1
         ORDER BY p.created_at
         LIMIT 500;`,
        [bookId]
      ),
      db.query(`SELECT rating FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [me, bookId]),
      isAuthorOf(me, bookId),
      soft(db.query(
        `SELECT review_user_id, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM book_review_helpful WHERE book_id = $1 GROUP BY 1;`,
        [bookId, me]
      )),
      soft(db.query(
        `SELECT x.post_id, x.emoji, count(*)::int AS n, bool_or(x.user_id = $2) AS mine
         FROM book_post_reactions x JOIN book_posts p ON p.id = x.post_id WHERE p.book_id = $1 GROUP BY 1, 2;`,
        [bookId, me]
      )),
      db.query(`SELECT 1 FROM author_books WHERE book_id = $1 LIMIT 1;`, [bookId]),
      // spoiler marks and pen names (a separate query, so the page still works before the columns exist)
      soft(Promise.all([
        db.query(`SELECT user_id, spoiler, alias, hidden FROM book_reviews WHERE book_id = $1 AND (spoiler OR alias IS NOT NULL OR hidden);`, [bookId]),
        db.query(`SELECT id, spoiler, alias, hidden FROM book_posts WHERE book_id = $1 AND (spoiler OR alias IS NOT NULL OR hidden);`, [bookId]),
      ]), [{ rows: [] }, { rows: [] }]),
    ]);
    const { rows: myName } = await db.query(
      `SELECT a.name FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE u.id = $1;`, [me]
    );
    const reviewExtras = new Map(extras[0].rows.map((r) => [r.user_id, r]));
    const postExtras = new Map(extras[1].rows.map((r) => [Number(r.id), r]));
    const helpfulOf = new Map(helpful.map((h) => [h.review_user_id, h]));
    const reactionsOf = new Map();
    for (const x of reactions) {
      const list = reactionsOf.get(Number(x.post_id)) || [];
      list.push({ emoji: x.emoji, count: x.n, mine: x.mine });
      reactionsOf.set(Number(x.post_id), list);
    }

    const view = (p) => {
      const x = postExtras.get(Number(p.id));
      return {
      id: Number(p.id), body: p.body, pinned: p.pinned, createdAt: p.created_at,
      name: x?.alias || displayName(p.name), alias: Boolean(x?.alias), isAuthor: p.is_author && !x?.alias, mine: p.user_id === me,
      who: whoOf(p.user_id, bookId),
      spoiler: Boolean(x?.spoiler),
      hidden: Boolean(x?.hidden),
      reactions: (reactionsOf.get(Number(p.id)) || []).sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji)),
      };
    };
    // hidden (reported / by the team): only its writer still sees it, marked as hidden
    const shown = (hidden, writer) => !hidden || writer === me;
    const top = posts.filter((p) => !p.parent_id && shown(postExtras.get(Number(p.id))?.hidden, p.user_id)).map((p) => ({ ...view(p), replies: [] }));
    const byId = new Map(top.map((p) => [p.id, p]));
    for (const r of posts.filter((p) => p.parent_id && shown(postExtras.get(Number(p.id))?.hidden, p.user_id))) byId.get(Number(r.parent_id))?.replies.push(view(r));
    top.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt) - new Date(a.createdAt)); // pinned, then newest

    res.json({
      reviews: reviews.filter((r) => shown(reviewExtras.get(r.user_id)?.hidden, r.user_id)).map((r) => ({
        id: r.user_id, // which review - for "Helpful" and "Report"
        body: r.body, rating: r.rating, updatedAt: r.updated_at,
        name: reviewExtras.get(r.user_id)?.alias || displayName(r.name), alias: reviewExtras.get(r.user_id)?.alias || null,
        isAuthor: r.is_author && !reviewExtras.get(r.user_id)?.alias, mine: r.user_id === me,
        spoiler: Boolean(reviewExtras.get(r.user_id)?.spoiler),
        hidden: Boolean(reviewExtras.get(r.user_id)?.hidden),
        helpful: helpfulOf.get(r.user_id)?.n || 0, helpfulByMe: Boolean(helpfulOf.get(r.user_id)?.mine),
      })),
      posts: top,
      me: { rating: myRating[0]?.rating ?? null, isAuthor: author, name: displayName(myName[0]?.name) },
      authorHere: hasAuthor.length > 0, // an author of the book is on BookBridge - "Ask the author"
    });
  }));

  router.put("/books/:id/review", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const body = checkBody(req.body.body);
    const alias = checkAlias(req.body.alias, BadRequest);
    const { rowCount } = await db.query(`SELECT 1 FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    if (!rowCount) throw new BadRequest("rate the book first - a review goes with your stars");
    await db.query(
      `INSERT INTO book_reviews (user_id, book_id, body) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now();`,
      [req.user.id, bookId, body]
    );
    await soft(db.query(`UPDATE book_reviews SET spoiler = $3, alias = $4 WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId, req.body.spoiler === true, alias]));
    res.json({ ok: true });
  }));

  router.delete("/books/:id/review", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    await db.query(`DELETE FROM book_reviews WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    res.json({ ok: true });
  }));

  router.post("/books/:id/posts", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const body = checkBody(req.body.body);
    const alias = checkAlias(req.body.alias, BadRequest);
    let parentId = null;
    if (req.body.parentId !== undefined && req.body.parentId !== null) {
      parentId = checkId(req.body.parentId);
      const { rows } = await db.query(`SELECT book_id, parent_id FROM book_posts WHERE id = $1;`, [parentId]);
      if (!rows[0] || rows[0].book_id !== bookId) throw new BadRequest("that post is not in this book's discussion");
      if (rows[0].parent_id) throw new BadRequest("reply to the post itself (one level of replies)");
    }
    const { rows: recent } = await db.query(
      `SELECT count(*)::int AS n FROM book_posts WHERE user_id = $1 AND created_at > now() - interval '1 hour';`,
      [req.user.id]
    );
    if (recent[0].n >= POSTS_PER_HOUR) throw new BadRequest("you have posted a lot in the last hour - please try again later");
    const { rows: book } = await db.query(`SELECT 1 FROM books WHERE id = $1;`, [bookId]);
    if (!book[0]) throw new BadRequest("unknown book");
    const { rows } = await db.query(
      `INSERT INTO book_posts (book_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING id;`,
      [bookId, req.user.id, parentId, body]
    );
    if (req.body.spoiler === true || alias) await soft(db.query(`UPDATE book_posts SET spoiler = $2, alias = $3 WHERE id = $1;`, [rows[0].id, req.body.spoiler === true, alias]));
    res.status(201).json({ ok: true, id: Number(rows[0].id) });
  }));

  router.delete("/posts/:postId", wrap(async (req, res) => {
    const postId = checkId(req.params.postId);
    const { rowCount } = await db.query(`DELETE FROM book_posts WHERE id = $1 AND user_id = $2;`, [postId, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: "post not found (or not yours)" });
    res.json({ ok: true });
  }));

  router.post("/posts/:postId/pin", wrap(async (req, res) => {
    const postId = checkId(req.params.postId);
    const pinned = req.body.pinned !== false;
    const { rows } = await db.query(`SELECT book_id, parent_id FROM book_posts WHERE id = $1;`, [postId]);
    if (!rows[0]) return res.status(404).json({ error: "post not found" });
    if (rows[0].parent_id) throw new BadRequest("only posts can be pinned, not replies");
    if (!(await isAuthorOf(req.user.id, rows[0].book_id))) return res.status(403).json({ error: "only an author of this book can pin" });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (pinned) await client.query(`UPDATE book_posts SET pinned = false WHERE book_id = $1 AND pinned;`, [rows[0].book_id]);
      await client.query(`UPDATE book_posts SET pinned = $2 WHERE id = $1;`, [postId, pinned]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  // "Helpful" on someone else's review (on: false takes it back)
  router.post("/books/:id/reviews/:reviewId/helpful", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const reviewer = checkId(req.params.reviewId);
    if (reviewer === req.user.id) throw new BadRequest("that is your own review");
    if (req.body.on === false) {
      await db.query(`DELETE FROM book_review_helpful WHERE review_user_id = $1 AND book_id = $2 AND user_id = $3;`, [reviewer, bookId, req.user.id]);
    } else {
      const { rowCount } = await db.query(`SELECT 1 FROM book_reviews WHERE user_id = $1 AND book_id = $2;`, [reviewer, bookId]);
      if (!rowCount) return res.status(404).json({ error: "review not found" });
      await db.query(`INSERT INTO book_review_helpful (review_user_id, book_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;`, [reviewer, bookId, req.user.id]);
    }
    res.json({ ok: true });
  }));

  // a quick reaction on a message (on: false takes it back)
  router.post("/posts/:postId/react", wrap(async (req, res) => {
    const postId = checkId(req.params.postId);
    const emoji = String(req.body.emoji || "");
    if (!REACTIONS.includes(emoji)) throw new BadRequest(`emoji must be one of ${REACTIONS.join(" ")}`);
    if (req.body.on === false) {
      await db.query(`DELETE FROM book_post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3;`, [postId, req.user.id, emoji]);
    } else {
      const { rowCount } = await db.query(`SELECT 1 FROM book_posts WHERE id = $1;`, [postId]);
      if (!rowCount) return res.status(404).json({ error: "message not found" });
      await db.query(`INSERT INTO book_post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;`, [postId, req.user.id, emoji]);
    }
    res.json({ ok: true });
  }));

  // report a review or a message to the team - once per reader per item
  router.post("/books/:id/report", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const kind = req.body.kind;
    const reason = req.body.reason;
    if (!["review", "post"].includes(kind)) throw new BadRequest("kind must be review or post");
    if (!REPORT_REASONS.includes(reason)) throw new BadRequest(`reason must be one of: ${REPORT_REASONS.join(", ")}`);
    const target = checkId(req.body.id);
    const found = kind === "review"
      ? await db.query(`SELECT 1 FROM book_reviews WHERE user_id = $1 AND book_id = $2 AND user_id <> $3;`, [target, bookId, req.user.id])
      : await db.query(`SELECT 1 FROM book_posts WHERE id = $1 AND book_id = $2 AND user_id <> $3;`, [target, bookId, req.user.id]);
    if (!found.rowCount) return res.status(404).json({ error: "not found (or your own)" });
    const { rowCount: added } = await db.query(
      `INSERT INTO book_reports (reporter_id, book_id, kind, review_user_id, post_id, reason) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING;`,
      [req.user.id, bookId, kind, kind === "review" ? target : null, kind === "post" ? target : null, reason]
    );
    if (added) {
      // how many readers reported it and the team has not decided yet
      const same = kind === "review" ? `kind = 'review' AND review_user_id = $1` : `kind = 'post' AND post_id = $1`;
      const { rows: [{ n }] } = await db.query(
        `SELECT count(DISTINCT reporter_id)::int AS n FROM book_reports WHERE ${same} AND book_id = $2 AND status = 'open';`, [target, bookId]
      );
      let hiddenNow = false;
      if (n >= HIDE_AFTER) {
        const { rowCount } = kind === "review"
          ? await db.query(`UPDATE book_reviews SET hidden = true WHERE user_id = $1 AND book_id = $2 AND NOT hidden;`, [target, bookId])
          : await db.query(`UPDATE book_posts SET hidden = true WHERE id = $1 AND NOT hidden;`, [target]);
        hiddenNow = rowCount > 0;
      }
      console.log(`[social] report: ${kind} ${target} on book ${bookId} - ${reason} (${n} reader(s))${hiddenNow ? " - hidden until the team decides" : ""}`);
      if (n === 1 || hiddenNow) emailTeam({ kind, target, bookId, reason, n, hiddenNow }).catch(() => {}); // never fails the report
    }
    res.json({ ok: true });
  }));

  return router;
};

module.exports.displayName = displayName;
