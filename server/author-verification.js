/**
 * Authors verified by their PUBLISHER, claiming books, and uploading new books.
 * Tables: db/create-author-verification.js.
 *
 * Public (no login - the publisher has no BookBridge account), mounted at /api/publisher:
 *   GET  /request?token=...            what the publisher is asked to confirm
 *   POST /decision { token, decision }  "confirm" | "decline" - once per link
 *
 * Signed-in authors, mounted at /api/author:
 *   GET  /search?q=...                  catalog search for "This is my book"
 *   POST /claims { bookId, message? }    linked at once if the book's author is one of
 *                                        your VERIFIED names, otherwise a claim for the team
 *   POST /books { title, authors, description, genres, publishedDate, ... }
 *                                        a new book: live at once, with its embedding and
 *                                        content neighbours (server/book-embedding.js)
 *
 * Security notes:
 *   - the link token is 256 random bits; only its sha256 is stored, it expires
 *     after 7 days and works once
 *   - opening the link decides nothing; the publisher must press a button (POST) -
 *     mail scanners open links on their own
 *   - a publisher email must be on PUBLISHER_EMAILS (server/mailer.js), and can't be
 *     the requester's own email
 *   - a verified name can't be edited by the author; uploads must list it as an author
 */

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));
const { displayName } = require("./social-routes");
const { embedBook, saveNeighbours, toVector } = require("./book-embedding");

const TOKEN_DAYS = 7;
const RESEND_HOURS = 24;
const MAX_PENDING_CLAIMS = 20;
const MAX_UPLOADS_PER_DAY = 10;
const GENRE = new Map(GENRES.map((g) => [g.key, g]));

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
function newToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_DAYS * 864e5) };
}

/** "Suzanne Collins" = "suzanne  collins" = "Suzanne Collins." (accents, case, spaces, dots ignored) */
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const nameMatches = (verifiedNames, bookAuthors) => {
  const mine = new Set((verifiedNames || []).map(normName).filter(Boolean));
  return (bookAuthors || []).some((a) => mine.has(normName(a)));
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- the request and the email (used by me-routes) ----------

async function verifiedNamesOf(db, userId) {
  try {
    const { rows } = await db.query(`SELECT verified_names FROM author_profiles WHERE user_id = $1;`, [userId]);
    return rows[0]?.verified_names || [];
  } catch (err) {
    if (err.code === "42P01" || err.code === "42703") return []; // tables not created yet
    throw err;
  }
}

/** Sends (or re-sends) the confirmation email of request `r`, with a NEW token. Returns true if sent. */
async function emailPublisher(db, mailer, r, accountName) {
  const t = newToken();
  await db.query(`UPDATE author_requests SET token_hash = $2, token_expires_at = $3 WHERE id = $1;`, [r.id, t.hash, t.expiresAt]);
  const sent = await mailer.sendPublisherConfirmation({
    to: r.publisher_email, token: t.token, penName: r.pen_name, accountName,
    publisherName: r.publisher_name, books: r.books, expiresAt: t.expiresAt,
  });
  if (sent) await db.query(`UPDATE author_requests SET email_sent_at = now() WHERE id = $1;`, [r.id]);
  return sent;
}

// ---------- public: the publisher's page ----------

function publisherRoutes({ db, h }) {
  const { BadRequest, wrap } = h;
  const router = express.Router();

  const findByToken = async (token, client = db, lock = false) => {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    const { rows } = await client.query(
      `SELECT r.*, a.name AS account_name FROM author_requests r
       JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
       WHERE r.token_hash = $1 ${lock ? "FOR UPDATE OF r" : ""};`,
      [sha256(token)]
    );
    return rows[0] || null;
  };
  const gone = (res) => res.status(404).json({ error: "This link is not valid any more - it was already used, or a newer email replaced it." });

  router.get("/request", wrap(async (req, res) => {
    const r = await findByToken(req.query.token);
    if (!r || r.status !== "pending") return gone(res);
    if (new Date(r.token_expires_at) < new Date()) return res.status(410).json({ error: "This link has expired. The author can send a new one from BookBridge." });
    res.json({
      penName: r.pen_name, accountName: displayName(r.account_name), books: r.books,
      publisherName: r.publisher_name, expiresAt: r.token_expires_at,
    });
  }));

  router.post("/decision", wrap(async (req, res) => {
    const decision = req.body.decision;
    if (decision !== "confirm" && decision !== "decline") throw new BadRequest("decision must be confirm or decline");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const r = await findByToken(req.body.token, client, true);
      if (!r || r.status !== "pending") { await client.query("ROLLBACK"); return gone(res); }
      if (new Date(r.token_expires_at) < new Date()) { await client.query("ROLLBACK"); return res.status(410).json({ error: "This link has expired." }); }
      if (decision === "confirm") {
        await client.query(
          `UPDATE author_requests SET status = 'approved', publisher_decision = 'confirmed', publisher_decided_at = now(),
                  decided_at = now(), note = 'Confirmed by the publisher', token_hash = NULL WHERE id = $1;`,
          [r.id]
        );
        await client.query(`UPDATE users SET user_type = 'author' WHERE id = $1 AND user_type <> 'librarian';`, [r.user_id]);
        // the pen name becomes a verified name (an author may have more than one)
        await client.query(
          `INSERT INTO author_profiles (user_id, pen_name, verified_names) VALUES ($1, $2, ARRAY[$2])
           ON CONFLICT (user_id) DO UPDATE SET verified_names =
             (SELECT array_agg(DISTINCT x) FROM unnest(author_profiles.verified_names || ARRAY[$2]) AS x),
             updated_at = now();`,
          [r.user_id, r.pen_name]
        );
      } else {
        await client.query(
          `UPDATE author_requests SET status = 'rejected', publisher_decision = 'declined', publisher_decided_at = now(),
                  decided_at = now(), note = 'The publisher did not confirm this request', token_hash = NULL WHERE id = $1;`,
          [r.id]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true, decision });
  }));

  return router;
}

// ---------- signed-in authors: claims and uploads ----------

function cleanUpload(body, verifiedNames, BadRequest) {
  const text = (v, min, max, name) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length < min) throw new BadRequest(min > 1 ? `${name}: at least ${min} characters` : `${name} is required`);
    if (t.length > max) throw new BadRequest(`${name}: up to ${max} characters`);
    return t;
  };
  const title = text(body.title, 1, 300, "title");
  const authors = [...new Set((Array.isArray(body.authors) ? body.authors : []).map((a) => String(a || "").trim()).filter(Boolean))];
  if (!authors.length || authors.length > 5) throw new BadRequest("authors: 1 to 5 names");
  if (authors.some((a) => a.length > 120)) throw new BadRequest("an author name: up to 120 characters");
  if (!nameMatches(verifiedNames, authors)) throw new BadRequest(`the authors must include your verified name (${verifiedNames.join(" / ")})`);
  const description = text(body.description, 150, 5000, "description");
  const genres = [...new Set(Array.isArray(body.genres) ? body.genres : [])];
  if (!genres.length || genres.length > 3) throw new BadRequest("choose 1 to 3 genres");
  if (genres.some((g) => !GENRE.has(g))) throw new BadRequest("unknown genre");
  const publishedDate = text(body.publishedDate, 4, 10, "published date");
  const year = Number(publishedDate.slice(0, 4));
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(publishedDate) || year < 1450 || year > new Date().getUTCFullYear() + 1) {
    throw new BadRequest("published date: YYYY or YYYY-MM-DD");
  }
  let pageCount = null;
  if (body.pageCount !== undefined && body.pageCount !== null && body.pageCount !== "") {
    pageCount = Number(body.pageCount);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10000) throw new BadRequest("pages: a whole number from 1 to 10000");
  }
  let isbn10 = null, isbn13 = null;
  if (body.isbn) {
    const isbn = String(body.isbn).replace(/[\s-]/g, "").toUpperCase();
    if (/^\d{13}$/.test(isbn)) isbn13 = isbn;
    else if (/^\d{9}[\dX]$/.test(isbn)) isbn10 = isbn;
    else throw new BadRequest("ISBN: 10 or 13 digits");
  }
  const seriesName = typeof body.seriesName === "string" && body.seriesName.trim() ? text(body.seriesName, 1, 200, "series") : null;
  let seriesNumber = null;
  if (body.seriesNumber !== undefined && body.seriesNumber !== null && body.seriesNumber !== "") {
    if (!seriesName) throw new BadRequest("a series number needs the series name");
    seriesNumber = Number(body.seriesNumber);
    if (!(seriesNumber > 0 && seriesNumber < 1000)) throw new BadRequest("series number: from 0.5 to 999");
  }
  let coverUrl = null;
  if (typeof body.coverUrl === "string" && body.coverUrl.trim()) {
    let u;
    try { u = new URL(body.coverUrl.trim()); } catch { throw new BadRequest("cover: a full https:// link to an image"); }
    if (u.protocol !== "https:" || u.toString().length > 500) throw new BadRequest("cover: a full https:// link to an image");
    coverUrl = u.toString();
  }
  const g = genres.map((k) => GENRE.get(k));
  return {
    title, authors, description, publishedDate, pageCount, isbn10, isbn13, seriesName, seriesNumber, coverUrl,
    genres,
    goodreadsGenres: [...new Set(g.flatMap((x) => x.goodreads))],
    // Google-style categories: the genre's Google values, or its name (shown on the book page)
    categories: [...new Set(g.flatMap((x) => (x.google.length ? x.google : [x.label])))],
  };
}

// which optional columns the books table has (checked once)
let columnsPromise = null;
function bookColumns(db) {
  if (!columnsPromise) {
    columnsPromise = db.query(
      `SELECT column_name, is_generated FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'books' AND column_name IN ('main_genres', 'series_name', 'series_number');`
    ).then(({ rows }) => ({
      mainGenres: rows.some((r) => r.column_name === "main_genres" && r.is_generated === "NEVER"),
      series: rows.some((r) => r.column_name === "series_name") && rows.some((r) => r.column_name === "series_number"),
    })).catch((err) => { columnsPromise = null; throw err; });
  }
  return columnsPromise;
}

function authorRoutes({ db, requireUser, h, embed }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));
  const mustBeAuthor = (req) => {
    if (req.user.user_type !== "author") {
      const err = new BadRequest("only verified authors can do this - ask your publisher to confirm you first (Account page)");
      err.status = 403;
      throw err;
    }
  };

  router.get("/search", wrap(async (req, res) => {
    mustBeAuthor(req);
    const q = String(req.query.q || "").trim();
    if (q.length < 2) throw new BadRequest("search needs at least 2 letters");
    const verified = await verifiedNamesOf(db, req.user.id);
    const { rows } = await db.query(
      `SELECT b.id, b.title, b.authors, b.thumbnail_url, b.published_date,
              EXISTS (SELECT 1 FROM author_books ab WHERE ab.user_id = $2 AND ab.book_id = b.id) AS mine,
              EXISTS (SELECT 1 FROM book_claims c WHERE c.user_id = $2 AND c.book_id = b.id AND c.status = 'pending') AS pending
       FROM books b
       WHERE b.title ILIKE '%' || $1 || '%' OR array_to_string(b.authors, ' ') ILIKE '%' || $1 || '%'
       ORDER BY (lower(b.title) = lower($1)) DESC, b.goodbooks_id NULLS LAST, length(b.title)
       LIMIT 20;`,
      [q, req.user.id]
    );
    res.json({ books: rows.map((b) => ({ ...b, matchesYou: nameMatches(verified, b.authors) })) });
  }));

  router.post("/claims", wrap(async (req, res) => {
    mustBeAuthor(req);
    const bookId = checkId(req.body.bookId);
    const message = typeof req.body.message === "string" ? req.body.message.trim().slice(0, 1000) || null : null;
    const { rows: b } = await db.query(`SELECT id, title, authors FROM books WHERE id = $1;`, [bookId]);
    if (!b[0]) throw new BadRequest("unknown book");
    const { rowCount: mine } = await db.query(`SELECT 1 FROM author_books WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    if (mine) throw new BadRequest("this book is already linked to you");
    const verified = await verifiedNamesOf(db, req.user.id);
    if (nameMatches(verified, b[0].authors)) {
      await db.query(`INSERT INTO author_books (user_id, book_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`, [req.user.id, bookId]);
      return res.json({ ok: true, linked: true });
    }
    const { rows: n } = await db.query(`SELECT count(*)::int AS n FROM book_claims WHERE user_id = $1 AND status = 'pending';`, [req.user.id]);
    if (n[0].n >= MAX_PENDING_CLAIMS) throw new BadRequest(`you have ${MAX_PENDING_CLAIMS} claims waiting - please wait for the team`);
    try {
      await db.query(`INSERT INTO book_claims (user_id, book_id, message) VALUES ($1, $2, $3);`, [req.user.id, bookId, message]);
    } catch (err) {
      if (err.code === "23505") throw new BadRequest("you already asked for this book - it is waiting for the team");
      throw err;
    }
    res.status(201).json({ ok: true, pending: true });
  }));

  router.post("/books", wrap(async (req, res) => {
    mustBeAuthor(req);
    const verified = await verifiedNamesOf(db, req.user.id);
    if (!verified.length) throw new BadRequest("your pen name is not verified yet");
    const book = cleanUpload(req.body || {}, verified, BadRequest);

    const { rows: recent } = await db.query(
      `SELECT count(*)::int AS n FROM author_uploads WHERE user_id = $1 AND created_at > now() - interval '1 day';`, [req.user.id]
    );
    if (recent[0].n >= MAX_UPLOADS_PER_DAY) throw new BadRequest(`up to ${MAX_UPLOADS_PER_DAY} new books a day`);
    const { rows: dup } = await db.query(
      `SELECT id FROM books
       WHERE (lower(title) = lower($1) AND authors && $2::text[])
          OR ($3::text IS NOT NULL AND isbn_13 = $3) OR ($4::text IS NOT NULL AND isbn_10 = $4)
       LIMIT 1;`,
      [book.title, book.authors, book.isbn13, book.isbn10]
    );
    if (dup[0]) {
      return res.status(409).json({ error: "this book is already in the catalog - find it under \"Add a book that's already here\"", bookId: dup[0].id });
    }

    const vector = await embedBook(book.title, book.description, { embed }); // may take a few seconds (model load)
    const cols = await bookColumns(db);
    const client = await db.connect();
    let bookId, neighbours;
    try {
      await client.query("BEGIN");
      const fields = {
        google_id: `bb:${crypto.randomUUID()}`, title: book.title, authors: book.authors,
        published_date: book.publishedDate, description: book.description,
        isbn_10: book.isbn10, isbn_13: book.isbn13, page_count: book.pageCount,
        categories: book.categories, goodreads_genres: book.goodreadsGenres, language: "en",
        thumbnail_url: book.coverUrl, search_term: "author-upload",
      };
      if (cols.mainGenres) fields.main_genres = book.goodreadsGenres.slice(0, 2);
      if (cols.series) Object.assign(fields, { series_name: book.seriesName, series_number: book.seriesNumber });
      const names = Object.keys(fields);
      const { rows } = await client.query(
        `INSERT INTO books (${names.join(", ")}, embedding)
         VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}, $${names.length + 1}::vector)
         RETURNING id;`,
        [...Object.values(fields), toVector(vector)]
      );
      bookId = rows[0].id;
      await client.query(`INSERT INTO author_uploads (book_id, user_id) VALUES ($1, $2);`, [bookId, req.user.id]);
      await client.query(`INSERT INTO author_books (user_id, book_id) VALUES ($1, $2);`, [req.user.id, bookId]);
      neighbours = await saveNeighbours(client, db, bookId);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ ok: true, bookId, neighbours });
  }));

  return router;
}

module.exports = {
  publisherRoutes, authorRoutes, emailPublisher, verifiedNamesOf, cleanUpload,
  normName, nameMatches, newToken, sha256, EMAIL_RE, RESEND_HOURS,
};
