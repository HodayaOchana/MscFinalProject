/**
 * The two For You shelves that change with what the user does (not only with ratings):
 *
 *   "Continue your series"          the next books of series the user rated (3★+) or finished
 *   "Because you looked at <book>"  books like one the user keeps coming back to:
 *                                   opened at least twice in the last 30 days (user_book_views),
 *                                   or opened from a search (user_searches.clicked_book_id)
 *
 * Both are read fresh on every visit, so a rating, a finished book or a book page opened twice
 * changes them right away. The main model (Top 10 and the genre shelves) is not changed here.
 *
 * Never shown on these shelves: books the user rated, finished or hid ("Not for me"),
 * and books already in the Top 10. "Because you looked at" also skips the TBR list.
 * If a table is missing (views / searches / EASE), that shelf is simply skipped.
 */

const path = require("path");
const { getAvailability } = require(path.join(__dirname, "..", "library", "availability"));

const DAYS = 30;          // "looked at" counts the last 30 days
const MIN_VIEWS = 2;      // opened at least twice (or once from a search)
const ROW_MAX = 20;
const LOOKED_MIN = 4;     // fewer books than this - the shelf is not shown
const SERIES_MIN = 2;
const PER_SERIES = 2;     // up to 2 next books from each series
const PER_AUTHOR = 2;     // "because you looked at": at most 2 books per author

const soft = (p) => p.catch((err) => (["42P01", "42703"].includes(err.code) ? { rows: [] } : Promise.reject(err))); // table / column missing

/** What the user already did: rated, finished, hid, on the TBR list now */
async function userState(db, userId) {
  const { rows } = await db.query(
    `SELECT book_id, 'rated' AS kind FROM user_ratings WHERE user_id = $1
     UNION ALL
     SELECT DISTINCT book_id, type FROM user_events WHERE user_id = $1 AND type IN ('dismissed', 'finished')
     UNION ALL
     SELECT book_id, 'tbr' FROM (
       SELECT DISTINCT ON (book_id) book_id, type FROM user_events
       WHERE user_id = $1 AND type IN ('saved', 'unsaved') ORDER BY book_id, created_at DESC
     ) t WHERE type = 'saved';`,
    [userId]
  );
  const s = { rated: new Set(), finished: new Set(), dismissed: new Set(), tbr: new Set() };
  for (const r of rows) s[r.kind].add(r.book_id);
  return s;
}

/** "Continue your series" - next unread books, the most recently active series first */
async function seriesRow(db, userId, skip) {
  const { rows } = await soft(db.query(
    `WITH mine AS (
       SELECT book_id, updated_at AS at FROM user_ratings WHERE user_id = $1 AND rating >= 3
       UNION ALL
       SELECT book_id, created_at FROM user_events WHERE user_id = $1 AND type = 'finished'
     ), s AS (
       SELECT b.series_name, max(m.at) AS at, max(b.series_number)::float8 AS upto
       FROM mine m JOIN books b ON b.id = m.book_id
       WHERE b.series_name IS NOT NULL
       GROUP BY b.series_name
     )
     SELECT b.id, b.series_name, b.series_number::float8 AS number, s.upto
     FROM s JOIN books b ON b.series_name = s.series_name
     WHERE b.series_number IS NOT NULL AND b.id <> ALL($2::int[])
     ORDER BY s.at DESC, s.series_name,
              (b.series_number < s.upto),           -- the books AFTER the last one read first
              (b.series_number % 1 <> 0),          -- whole numbers before novellas (#1.5)
              b.series_number;`,
    [userId, [...skip]]
  ));
  // round robin: the next book of every series, then the one after
  const bySeries = new Map();
  for (const r of rows) {
    if (!bySeries.has(r.series_name)) bySeries.set(r.series_name, []);
    const list = bySeries.get(r.series_name);
    if (list.length < PER_SERIES) list.push(r);
  }
  const picked = [];
  for (let round = 0; round < PER_SERIES && picked.length < ROW_MAX; round++) {
    for (const list of bySeries.values()) if (list[round] && picked.length < ROW_MAX) picked.push(list[round]);
  }
  if (picked.length < SERIES_MIN) return null;
  const left = new Map([...bySeries.keys()].map((name) => [name, rows.filter((r) => r.series_name === name).length]));
  return {
    key: "series", kind: "series", label: "Continue your series",
    subtitle: "The next books in series you have been reading",
    picks: picked.map((r) => ({
      id: r.id, reason: "Next in a series you read", reasonText: "Next in your series",
      series: { name: r.series_name, number: r.number, more: Math.max(0, left.get(r.series_name) - 1) },
    })),
  };
}

/** The book the user keeps coming back to (most recent first), not rated / hidden */
async function anchors(db, userId, state) {
  const [{ rows: views }, { rows: clicks }] = await Promise.all([
    soft(db.query(
      `SELECT book_id, last_viewed_at AS at FROM user_book_views
       WHERE user_id = $1 AND views >= $2 AND last_viewed_at > now() - make_interval(days => $3);`,
      [userId, MIN_VIEWS, DAYS])),
    soft(db.query(
      `SELECT clicked_book_id AS book_id, coalesce(last_searched_at, created_at) AS at FROM user_searches
       WHERE user_id = $1 AND clicked_book_id IS NOT NULL AND coalesce(last_searched_at, created_at) > now() - make_interval(days => $2);`,
      [userId, DAYS])),
  ]);
  const at = new Map();
  for (const r of [...views, ...clicks]) {
    if (state.rated.has(r.book_id) || state.dismissed.has(r.book_id)) continue;
    if (!at.has(r.book_id) || at.get(r.book_id) < r.at) at.set(r.book_id, r.at);
  }
  return [...at].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Books like the anchor: EASE ("readers who liked it also liked"), then similar content */
async function neighbours(db, anchorId) {
  const [{ rows: cf }, { rows: cbf }] = await Promise.all([
    soft(db.query(
      `SELECT neighbor_id AS id FROM ease_similarity WHERE book_id = $1 AND weight > 0 ORDER BY weight DESC LIMIT 80;`, [anchorId])),
    soft(db.query(
      `SELECT neighbor_id AS id FROM content_similarity WHERE book_id = $1 ORDER BY similarity DESC LIMIT 60;`, [anchorId])),
  ]);
  const seen = new Set();
  const out = [];
  for (const [list, kind] of [[cf, "cf"], [cbf, "cbf"]]) {
    for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, kind }); }
  }
  return out;
}

async function lookedRow(db, userId, state, skip) {
  const ids = await anchors(db, userId, state);
  for (const anchorId of ids.slice(0, 5)) { // the newest anchor with enough books
    const near = await neighbours(db, anchorId);
    if (near.length < LOOKED_MIN) continue;
    const { rows: info } = await db.query(
      `SELECT id, title, authors, series_name FROM books WHERE id = ANY($1::int[]);`,
      [[anchorId, ...near.map((n) => n.id)]]
    );
    const byId = new Map(info.map((b) => [b.id, b]));
    const anchor = byId.get(anchorId);
    if (!anchor) continue;
    const series = new Set(anchor.series_name ? [anchor.series_name] : []); // not the anchor's own series
    const authors = new Map();
    const picks = [];
    for (const n of near) {
      const b = byId.get(n.id);
      if (!b || skip.has(n.id) || state.tbr.has(n.id) || picks.length >= ROW_MAX) continue;
      if (b.series_name && series.has(b.series_name)) continue;
      const a = b.authors?.[0] || "";
      if ((authors.get(a) || 0) >= PER_AUTHOR) continue;
      if (b.series_name) series.add(b.series_name);
      authors.set(a, (authors.get(a) || 0) + 1);
      picks.push(n.kind === "cf"
        ? { id: n.id, reason: "Readers who liked it loved this (CF)", reasonText: "Readers of it loved this" }
        : { id: n.id, reason: "Similar to a book you looked at (CBF)", reasonText: "A similar story" });
    }
    if (picks.length < LOOKED_MIN) continue;
    return {
      key: "looked", kind: "looked", label: `Because you looked at ${anchor.title}`,
      subtitle: "You came back to this book - here are books like it",
      anchor: { id: anchor.id, title: anchor.title },
      picks,
    };
  }
  return null;
}

/**
 * @param skipIds  books already on the page (the Top 10)
 * @param where    the library filter, if on (parseNearby result): filter = only available, boost = available first
 * @returns rows [{ key, kind, label, subtitle, anchor?, books: [...] }] - books with title, cover, reason, series
 */
async function freshRows(db, userId, { skipIds = [], where = null } = {}) {
  const state = await userState(db, userId);
  const skip = new Set([...skipIds, ...state.rated, ...state.finished, ...state.dismissed]);
  const series = await seriesRow(db, userId, skip);
  for (const p of series?.picks || []) skip.add(p.id); // no book on both shelves
  const looked = await lookedRow(db, userId, state, skip);
  const rows = [series, looked].filter(Boolean);
  if (!rows.length) return [];

  const ids = rows.flatMap((r) => r.picks.map((p) => p.id));
  const [{ rows: details }, avail] = await Promise.all([
    db.query(`SELECT id, title, authors, categories, goodbooks_id, thumbnail_url FROM books WHERE id = ANY($1::int[]);`, [ids]),
    where ? getAvailability(db, ids, where) : null,
  ]);
  const byId = new Map(details.map((d) => [d.id, d]));
  const out = [];
  for (const r of rows) {
    let books = r.picks.filter((p) => byId.has(p.id)).map((p) => ({
      ...byId.get(p.id), ...p, ...(avail ? { availability: avail.get(p.id) || null } : {}),
    }));
    if (where?.mode === "filter") books = books.filter((b) => b.availability);
    else if (where) books = [...books.filter((b) => b.availability), ...books.filter((b) => !b.availability)];
    if (books.length < (r.kind === "series" ? SERIES_MIN : LOOKED_MIN)) continue;
    const { picks: _p, ...row } = r;
    out.push({ ...row, books });
  }
  return out;
}

module.exports = { freshRows };
