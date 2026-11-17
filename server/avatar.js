/**
 * The user's profile picture, mounted under /api/me (signed-in users only).
 * Table: user_avatars (db/create-avatar-table.js).
 *
 *   GET    /api/me/avatar    { image: "data:image/jpeg;base64,..." | null }
 *   PUT    /api/me/avatar    { image: "data:image/jpeg;base64,..." }  - the website shrinks it to 256x256 first
 *   DELETE /api/me/avatar
 *
 * Checked here too: only JPEG / PNG / WebP (by the file's first bytes, not only by what the
 * browser says), at most 80 KB. If the table is missing, GET answers null and the page shows initials.
 */

const MAX_BYTES = 80 * 1024;
const TYPES = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };
const missing = (err) => err.code === "42P01";

module.exports = function avatarRoutes(router, { db, h }) {
  const { BadRequest, wrap } = h;

  router.get("/avatar", wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT mime, image FROM user_avatars WHERE user_id = $1;`, [req.user.id])
      .catch((err) => (missing(err) ? { rows: [] } : Promise.reject(err)));
    const r = rows[0];
    res.json({ image: r ? `data:${r.mime};base64,${r.image.toString("base64")}` : null });
  }));

  router.put("/avatar", wrap(async (req, res) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ""));
    if (!m) throw new BadRequest("please choose a JPEG, PNG or WebP picture");
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) throw new BadRequest("the picture is too big - please choose a smaller one");
    const magic = TYPES[m[1]];
    if (!magic.every((b, i) => bytes[i] === b)) throw new BadRequest("that file is not a picture");
    try {
      await db.query(
        `INSERT INTO user_avatars (user_id, mime, image) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, image = EXCLUDED.image, updated_at = now();`,
        [req.user.id, m[1], bytes]);
    } catch (err) {
      if (missing(err)) throw new BadRequest("profile pictures are not set up yet (db/create-avatar-table.js)");
      throw err;
    }
    res.json({ ok: true });
  }));

  router.delete("/avatar", wrap(async (req, res) => {
    const r = await db.query(`DELETE FROM user_avatars WHERE user_id = $1;`, [req.user.id])
      .catch((err) => (missing(err) ? { rowCount: 0 } : Promise.reject(err)));
    res.json({ ok: true, deleted: r.rowCount });
  }));
};
