/**
 * Covers of books that AUTHORS uploaded (author_uploads) - a picture file, or a link.
 * Table: book_covers (db/create-book-covers-table.js).
 *
 *   GET    /api/covers/:bookId?v=...        the picture (public - it is a book cover; cached a day)
 *   PUT    /api/author/books/:id/cover      { image: "data:image/jpeg;base64,..." } or { url: "https://..." }
 *   DELETE /api/author/books/:id/cover      back to the designed cover
 * Only the author who uploaded the book can change it. A file must really be JPEG / PNG / WebP,
 * up to 70 KB (the website shrinks it). The book's thumbnail_url is set to GET /api/covers/<id>?v=<time>.
 */

const MAX_BYTES = 70 * 1024; // as base64 in JSON this stays under the API's 100 KB body limit
const MAGIC = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };
const missing = (err) => err.code === "42P01";

/** The API's own address, for thumbnail_url (PUBLIC_API_URL in .env when it runs online) */
const apiBase = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

function publicCoverRoute(app, { db, wrap, checkId }) {
  app.get("/api/covers/:bookId", wrap(async (req, res) => {
    const id = checkId(req.params.bookId);
    const { rows } = await db.query(`SELECT mime, image FROM book_covers WHERE book_id = $1;`, [id])
      .catch((err) => (missing(err) ? { rows: [] } : Promise.reject(err)));
    if (!rows[0]) return res.status(404).json({ error: "no cover" });
    res.set("Content-Type", rows[0].mime);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(rows[0].image);
  }));
}

function authorCoverRoutes(router, { db, h }) {
  const { BadRequest, wrap, checkId } = h;

  async function ownUpload(req) {
    const id = checkId(req.params.id);
    const { rows } = await db.query(`SELECT 1 FROM author_uploads WHERE book_id = $1 AND user_id = $2;`, [id, req.user.id]);
    if (!rows.length) throw Object.assign(new BadRequest("you can change the cover only of a book you uploaded"), { status: 403 });
    return id;
  }

  router.put("/books/:id/cover", wrap(async (req, res) => {
    const id = await ownUpload(req);
    if (typeof req.body.url === "string" && req.body.url.trim()) {
      let u;
      try { u = new URL(req.body.url.trim()); } catch { throw new BadRequest("cover: a full https:// link to an image"); }
      if (u.protocol !== "https:" || u.toString().length > 500) throw new BadRequest("cover: a full https:// link to an image");
      await db.query(`DELETE FROM book_covers WHERE book_id = $1;`, [id]).catch((err) => { if (!missing(err)) throw err; });
      await db.query(`UPDATE books SET thumbnail_url = $2 WHERE id = $1;`, [id, u.toString()]);
      return res.json({ ok: true, thumbnail_url: u.toString() });
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ""));
    if (!m) throw new BadRequest("please choose a JPEG, PNG or WebP picture, or give a link");
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) throw new BadRequest("the picture is too big - please choose a smaller one");
    if (!MAGIC[m[1]].every((b, i) => bytes[i] === b)) throw new BadRequest("that file is not a picture");
    try {
      await db.query(
        `INSERT INTO book_covers (book_id, mime, image) VALUES ($1, $2, $3)
         ON CONFLICT (book_id) DO UPDATE SET mime = EXCLUDED.mime, image = EXCLUDED.image, updated_at = now();`,
        [id, m[1], bytes]);
    } catch (err) {
      if (missing(err)) throw new BadRequest("cover uploads are not set up yet (db/create-book-covers-table.js)");
      throw err;
    }
    const url = `${apiBase(req)}/api/covers/${id}?v=${Date.now()}`;
    await db.query(`UPDATE books SET thumbnail_url = $2 WHERE id = $1;`, [id, url]);
    res.json({ ok: true, thumbnail_url: url });
  }));

  router.delete("/books/:id/cover", wrap(async (req, res) => {
    const id = await ownUpload(req);
    await db.query(`DELETE FROM book_covers WHERE book_id = $1;`, [id]).catch((err) => { if (!missing(err)) throw err; });
    await db.query(`UPDATE books SET thumbnail_url = NULL WHERE id = $1;`, [id]);
    res.json({ ok: true, thumbnail_url: null });
  }));
}

module.exports = { publicCoverRoute, authorCoverRoutes };
