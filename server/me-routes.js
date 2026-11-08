/**
 * API for the SIGNED-IN user - everything under /api/me.
 *
 * The user is identified ONLY by the login token (server/auth.js), never by
 * an id in the address - so one user can never read or change another
 * user's data.
 *
 *   GET    /api/me                       profile, name, email, genres, number of ratings
 *   PATCH  /api/me                       { preferredCity }
 *   PUT    /api/me/genres                { genres: [...] }            (1-5 keys from genres.js)
 *   POST   /api/me/onboarding            { genres, answers }          saves the questionnaire + returns 10 recommendations
 *   GET    /api/me/ratings               the user's ratings (newest first)
 *   POST   /api/me/rate-more             { skip: [ids] } -> ~20 books from the user's genres to rate,
 *                                        without the books he already rated (and without `skip`)
 *   POST   /api/me/ratings               { bookId, rating } or { ratings: [{ bookId, rating }] }
 *   DELETE /api/me/ratings/:bookId
 *   POST   /api/me/events                { bookId, type }             saved | unsaved | started | finished | dismissed | clicked
 *                                        (in the app "saved" = on the user's TBR list, "to be read")
 *   POST   /api/me/events/reason         { bookId, reason }           why "Not for me": already_read | not_my_taste | not_now
 *   GET    /api/me/shelf                 { saved: [...], reading: [...], finished: [...] }  (from the events)
 *   GET    /api/me/consents              { needed, versions, current: { terms, privacy, age_16, research } }
 *   POST   /api/me/consents              { terms, privacy, age16, research, source } - only the keys sent are saved
 *   GET    /api/me/recommendations/rows  the For You page as shelves: "Top 10" + one row per genre
 *                                        (your genres first), each up to 20 books - same model, one call
 *   GET    /api/me/author                author status: type, linked books, latest request, profile, pen name to prefill
 *   PUT    /api/me/author/profile        { penName, bio, website } - the author's page (authors only)
 *   GET    /api/me/author/insights       how readers respond to the author's books (server/author-insights.js)
 *   GET    /api/me/author/insights/audience?book=<id>|all   genres of the readers who loved it, books they also loved
 *   POST   /api/me/author-request        { penName, books, publisherName, publisherEmail, message, confirm }
 *                                        "I am an author" - BookBridge emails the publisher to confirm
 *   POST   /api/me/author-request/resend a new confirmation email (once a day)
 *   GET    /api/me/insights              personal reading analytics (server/insights.js)
 *   GET    /api/me/searches              recent searches; POST / DELETE too (server/search-history.js)
 *   POST   /api/me/book-views            { bookId } - the book page was open 8+ seconds (server/book-views.js)
 *                                        rows also returns `fresh`: "Continue your series" and
 *                                        "Because you looked at <book>" (server/fresh-rows.js)
 *   GET    /api/me/recommendations       ?count=10 [&exclude=1,2,3] [&city=Jerusalem | &lat=&lng=&radiusKm=] [&mode=filter|boost]
 *                                        exclude = books already shown ("Recommend more") - 10 NEW ones
 *
 * Events are only STORED for now (decided 21/10/2026); the model uses ratings.
 */

const express = require("express");
const { computeInsights } = require("./insights");
const { computeAuthorInsights, computeAudience } = require("./author-insights");
const mailer = require("./mailer");
const { peekInfo, warmPeek, addPeek } = require("./book-peek");
const { freshRows } = require("./fresh-rows");
const { emailPublisher, verifiedNamesOf, EMAIL_RE, RESEND_HOURS } = require("./author-verification");
const { authorPage, knownPenName, profilesTable, cleanWebsite } = require("./author-profiles");
const { CONSENT_VERSIONS, REQUIRED, SOURCES, BODY_KEYS, currentConsents, consentNeeded } = require("./consents");
const path = require("path");
const { getOnboardingBooks } = require(path.join(__dirname, "..", "onboarding", "onboarding"));
const { SIGNALS, searchSignals, chatAskSignal } = require(path.join(__dirname, "..", "CF", "signal-weights")); // what each action counts
const { addMatch } = require("./match"); // "92% match" on the cards
const { explainRecommendations } = require("./explain"); // "Readers who loved Harry Potter also loved this"
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));
const GENRE_LABEL = new Map(GENRES.map((g) => [g.key, g.label]));

const EVENT_TYPES = new Set(["saved", "unsaved", "started", "finished", "dismissed", "clicked"]);
const DISMISS_REASONS = new Set(["already_read", "not_my_taste", "not_now"]);
const CITIES = new Set(["Jerusalem", "Tel Aviv-Yafo"]);

// The user's recommendations from the saved ratings + genres (also used by the chatbot, server/chat.js)
function makeRecommendFor({ db, hybrid, withTexts }) {
  return async function recommendFor(userId, count, nearby, exclude = [], extra = {}) {
    const [{ rows: ratings }, { rows: genres }, { rows: dismissed }] = await Promise.all([
      db.query(`SELECT book_id, rating FROM user_ratings WHERE user_id = $1;`, [userId]),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [userId]),
      // Never recommended again: "Not for me" (✕), "I finished it", and books
      // now on the TBR list ("to be read" = the latest saved/unsaved event is saved)
      db.query(
        `SELECT book_id FROM user_events WHERE user_id = $1 AND type IN ('dismissed', 'finished')
         UNION
         SELECT book_id FROM (
           SELECT DISTINCT ON (book_id) book_id, type FROM user_events
           WHERE user_id = $1 AND type IN ('saved', 'unsaved')
           ORDER BY book_id, created_at DESC
         ) t WHERE type = 'saved';`,
        [userId]
      ),
    ]);
    exclude = [...exclude, ...dismissed.map((d) => d.book_id)];
    // the user's other signals for the ALS user vector (weights: CF/signal-weights.js):
    // finished (no rating), on the TBR now, and searches (opened a result = strong,
    // no click = a little for the top results, more when the same search is repeated)
    const { rows: interest } = await db.query(
      `SELECT book_id,
              CASE WHEN bool_or(type = 'finished') THEN $2::float8 ELSE $3::float8 END AS value
       FROM user_events WHERE user_id = $1
       GROUP BY book_id
       HAVING NOT bool_or(type = 'dismissed')     -- "Not for me" is never a positive signal
          AND (bool_or(type = 'finished')
               OR (array_agg(type ORDER BY created_at DESC) FILTER (WHERE type IN ('saved', 'unsaved')))[1] = 'saved');`,
      [userId, SIGNALS.finished, SIGNALS.tbr]
    );
    const signal = new Map(interest.map((r) => [r.book_id, Number(r.value)]));
    const { rows: searches } = await db.query(
      `SELECT clicked_book_id, search_count, result_book_ids FROM user_searches WHERE user_id = $1;`, [userId]
    ).catch(() => ({ rows: [] })); // no search table yet (db/create-search-table.js)
    const { rows: nfm } = await db.query(`SELECT DISTINCT book_id FROM user_events WHERE user_id = $1 AND type = 'dismissed';`, [userId]);
    const notForMe = new Set(nfm.map((r) => r.book_id));
    // "Ask about this book" in the chatbot (server/chat.js)
    const { rows: asked } = await db.query(
      `SELECT t.about_book_id AS book_id, count(*)::int AS times
       FROM chat_turns t JOIN chat_conversations c ON c.id = t.conversation_id
       WHERE c.user_id = $1 AND t.about_book_id IS NOT NULL GROUP BY 1;`, [userId]
    ).catch(() => ({ rows: [] })); // no chat tables yet (db/create-chat-tables.js)
    const chatSignals = asked.map((r) => ({ bookId: r.book_id, value: chatAskSignal(r.times) }));
    for (const sig of [...searches.flatMap(searchSignals), ...chatSignals]) {
      if (!notForMe.has(sig.bookId) && !(signal.get(sig.bookId) >= sig.value)) signal.set(sig.bookId, sig.value);
    }
    const result = await hybrid.getHybridRecommendations(
      ratings.map((r) => ({ bookId: r.book_id, rating: r.rating })),
      count,
      { genres: genres.map((g) => g.genre_key), nearby, diversify: true, exclude,
        signals: [...signal].map(([bookId, value]) => ({ bookId, value })), ...extra }
    );
    const genreKeys = genres.map((g) => g.genre_key);
    const recommendations = await explainRecommendations(db, userId, addMatch(result.recommendations).map(withTexts), genreKeys);
    return { ...result, recommendations };
  };
}

module.exports = function meRoutes({ db, hybrid, requireUser, h }) {
  const { BadRequest, wrap, checkGenres, checkRatings, checkId, withTexts, nearbyFromQuery, parseNearby } = h;
  const router = express.Router();
  router.use(requireUser(db));

  // all book ids exist? (a clear 400 instead of a database error)
  async function checkBooksExist(ids) {
    if (!ids.length) return;
    const { rows } = await db.query(`SELECT id FROM books WHERE id = ANY($1::int[]);`, [ids]);
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new BadRequest(`unknown book ids: ${missing.slice(0, 10).join(", ")}`);
  }

  async function saveRatings(client, userId, ratings, source) {
    if (!ratings.length) return;
    await client.query(
      `INSERT INTO user_ratings (user_id, book_id, rating, source)
       SELECT $1, b, r, $4 FROM unnest($2::int[], $3::smallint[]) AS t(b, r)
       ON CONFLICT (user_id, book_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now();`,
      [userId, ratings.map((r) => r.bookId), ratings.map((r) => r.rating), source]
    );
  }

  async function saveGenres(client, userId, genres) {
    await client.query(`DELETE FROM user_genres WHERE user_id = $1;`, [userId]);
    if (genres.length) {
      await client.query(
        `INSERT INTO user_genres (user_id, genre_key) SELECT $1, unnest($2::text[]);`,
        [userId, genres]
      );
    }
  }

  const recommendFor = makeRecommendFor({ db, hybrid, withTexts });

  // ---------- consents (Terms, Privacy Policy, age 16+, optional research use) ----------
  router.get("/consents", wrap(async (req, res) => {
    const current = await currentConsents(db, req.user.id);
    res.json({ needed: consentNeeded(current), required: REQUIRED, versions: CONSENT_VERSIONS, current });
  }));

  // Saves one row per key sent (history is kept). Required consents cannot be
  // declined - without them the app cannot be used (delete the account instead).
  router.post("/consents", wrap(async (req, res) => {
    const source = SOURCES.has(req.body.source) ? req.body.source : "consent_page";
    const items = [];
    for (const [key, type] of Object.entries(BODY_KEYS)) {
      if (req.body[key] === undefined) continue;
      if (typeof req.body[key] !== "boolean") throw new BadRequest(`${key} must be true or false`);
      if (REQUIRED.includes(type) && req.body[key] !== true) {
        throw new BadRequest(`${key} is required to use BookBridge`);
      }
      items.push({ type, granted: req.body[key] });
    }
    if (!items.length) throw new BadRequest("send at least one of: terms, privacy, age16, research");
    await db.query(
      `INSERT INTO user_consents (user_id, consent_type, version, granted, source)
       SELECT $1, t, v, g, $5 FROM unnest($2::text[], $3::text[], $4::boolean[]) AS x(t, v, g);`,
      [req.user.id, items.map((i) => i.type), items.map((i) => CONSENT_VERSIONS[i.type]), items.map((i) => i.granted), source]
    );
    const current = await currentConsents(db, req.user.id);
    res.json({ ok: true, needed: consentNeeded(current), current });
  }));

  // ---------- authors: status and "become an author" requests ----------
  router.get("/author", wrap(async (req, res) => {
    const [{ rows: books }, { rows: reqs }] = await Promise.all([
      db.query(
        `SELECT b.id, b.title, b.thumbnail_url FROM author_books ab JOIN books b ON b.id = ab.book_id
         WHERE ab.user_id = $1 ORDER BY b.title;`,
        [req.user.id]
      ),
      db.query(
        `SELECT * FROM author_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;`,
        [req.user.id]
      ).catch((err) => (err.code === "42P01" ? { rows: [] } : Promise.reject(err))), // table not created yet
    ]);
    const r = reqs[0];
    const [verifiedNames, claims, uploads] = await Promise.all([
      verifiedNamesOf(db, req.user.id),
      db.query(
        `SELECT c.id, c.status, c.note, c.created_at, b.id AS book_id, b.title FROM book_claims c JOIN books b ON b.id = c.book_id
         WHERE c.user_id = $1 AND (c.status = 'pending' OR c.decided_at > now() - interval '30 days') ORDER BY c.created_at DESC LIMIT 50;`,
        [req.user.id]
      ).then((x) => x.rows).catch(() => []),
      db.query(`SELECT book_id FROM author_uploads WHERE user_id = $1;`, [req.user.id]).then((x) => x.rows.map((u) => u.book_id)).catch(() => []),
    ]);
    const sentAt = r?.email_sent_at ? new Date(r.email_sent_at) : null;
    const page = books.length ? await authorPage(db, req.user.id).catch(() => null) : null;
    // a verified author with no linked book yet still has a profile (pen name, bio)
    const own = !page && req.user.user_type === "author"
      ? (await db.query(`SELECT pen_name, bio, website FROM author_profiles WHERE user_id = $1;`, [req.user.id]).catch(() => ({ rows: [] }))).rows[0]
      : null;
    res.json({
      isAuthor: req.user.user_type === "author",
      books: await addPeek(db, books), // + blurb / rating for the hover card
      userId: req.user.id,
      profile: page ? { penName: page.penName, bio: page.bio, website: page.website }
        : own ? { penName: own.pen_name, bio: own.bio, website: own.website } : null,
      penName: page?.penName || (await knownPenName(db, req.user.id).catch(() => null)), // to prefill the next request
      verifiedNames,
      claims: claims.map((c) => ({ id: Number(c.id), status: c.status, note: c.note, createdAt: c.created_at, bookId: c.book_id, title: c.title })),
      uploads,
      publisherVerification: mailer.publisherVerificationReady(),
      request: r ? {
        id: Number(r.id), penName: r.pen_name, books: r.books, status: r.status, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at,
        publisherName: r.publisher_name || null, publisherEmail: r.publisher_email || null,
        emailSentAt: r.email_sent_at || null, publisherDecision: r.publisher_decision || null,
        canResend: r.status === "pending" && Boolean(r.publisher_email) && (!sentAt || Date.now() - sentAt > RESEND_HOURS * 36e5 || new Date(r.token_expires_at) < new Date()),
      } : null,
    });
  }));

  router.get("/author/insights", wrap(async (req, res) => {
    const data = await computeAuthorInsights(db, req.user.id);
    if (!data.books.length) return res.status(403).json({ error: "author insights are for authors linked to a book" });
    res.json(data);
  }));

  router.get("/author/insights/audience", wrap(async (req, res) => {
    const book = req.query.book === "all" || req.query.book === undefined ? "all" : checkId(req.query.book);
    const data = await computeAudience(db, req.user.id, book);
    if (!data) return res.status(404).json({ error: "not one of your books" });
    res.json({ ...data, alsoLoved: await addPeek(db, data.alsoLoved || []) }); // + hover card data
  }));

  router.put("/author/profile", wrap(async (req, res) => {
    const { rowCount } = await db.query(`SELECT 1 FROM author_books WHERE user_id = $1 LIMIT 1;`, [req.user.id]);
    if (!rowCount && req.user.user_type !== "author") return res.status(403).json({ error: "only authors have an author page" });
    if (!(await profilesTable(db))) throw new BadRequest("author pages are not set up yet (db/create-author-profiles-table.js)");
    const penName = typeof req.body.penName === "string" ? req.body.penName.trim() : "";
    if (!penName) throw new BadRequest("pen name is required");
    if (penName.length > 120) throw new BadRequest("pen name: up to 120 characters");
    const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
    if (bio.length > 2000) throw new BadRequest("bio: up to 2000 characters");
    const website = cleanWebsite(req.body.website);
    if (website === undefined) throw new BadRequest("website: please give a full link, like https://yoursite.com");
    await db.query(
      `INSERT INTO author_profiles (user_id, pen_name, bio, website) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET pen_name = EXCLUDED.pen_name, bio = EXCLUDED.bio, website = EXCLUDED.website, updated_at = now();`,
      [req.user.id, penName, bio || null, website]
    );
    res.json({ ok: true });
  }));

  router.post("/author-request", wrap(async (req, res) => {
    const text = (v, max, name, required = true) => {
      const t = typeof v === "string" ? v.trim() : "";
      if (required && !t) throw new BadRequest(`${name} is required`);
      if (t.length > max) throw new BadRequest(`${name}: up to ${max} characters`);
      return t || null;
    };
    const penName = text(req.body.penName, 120, "pen name");
    const books = text(req.body.books, 2000, "your books");
    const publisherName = text(req.body.publisherName, 200, "publisher");
    const publisherEmail = text(req.body.publisherEmail, 254, "publisher email").toLowerCase();
    const message = text(req.body.message, 2000, "message", false);
    if (req.body.confirm !== true) throw new BadRequest("please confirm that you are the author of these books");
    if (req.user.user_type === "librarian") throw new BadRequest("library accounts cannot become authors");
    if (!EMAIL_RE.test(publisherEmail)) throw new BadRequest("publisher email: please check the address");
    if (!mailer.publisherVerificationReady()) throw new BadRequest("publisher verification is not set up yet (PUBLISHER_EMAILS on the server)");
    const { rows: me } = await db.query(`SELECT name, email FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId]);
    if (me[0]?.email && me[0].email.toLowerCase() === publisherEmail) throw new BadRequest("the publisher's email can't be your own email");
    if (!mailer.isPublisherEmail(publisherEmail)) {
      throw new BadRequest("we can only email publishers we know - please check the address, or contact the BookBridge team");
    }
    let r;
    try {
      ({ rows: [r] } = await db.query(
        `INSERT INTO author_requests (user_id, pen_name, books, message, publisher_name, publisher_email)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;`,
        [req.user.id, penName, books, message, publisherName, publisherEmail]
      ));
    } catch (err) {
      if (err.code === "23505") throw new BadRequest("you already have a request waiting for your publisher");
      throw err;
    }
    const emailed = await emailPublisher(db, mailer, r, me[0]?.name || "a reader");
    res.status(201).json({ ok: true, emailed });
  }));

  router.post("/author-request/resend", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT * FROM author_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1;`, [req.user.id]
    );
    const r = rows[0];
    if (!r || !r.publisher_email) throw new BadRequest("no request is waiting for a publisher");
    const sentAt = r.email_sent_at ? new Date(r.email_sent_at) : null;
    const expired = r.token_expires_at && new Date(r.token_expires_at) < new Date();
    if (sentAt && !expired && Date.now() - sentAt < RESEND_HOURS * 36e5) throw new BadRequest("the email was sent less than a day ago - please give your publisher time");
    if (!mailer.isPublisherEmail(r.publisher_email)) throw new BadRequest("this publisher email is not on the list any more");
    const { rows: me } = await db.query(`SELECT name FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId]);
    const emailed = await emailPublisher(db, mailer, r, me[0]?.name || "a reader");
    res.json({ ok: true, emailed });
  }));

  // ---------- reading analytics (the Insights page) ----------
  router.get("/insights", wrap(async (req, res) => {
    res.json(await computeInsights(db, req.user.id));
  }));

  // ---------- profile ----------
  router.get("/", wrap(async (req, res) => {
    const u = req.user;
    const [{ rows: acc }, { rows: genres }, { rows: n }] = await Promise.all([
      db.query(`SELECT name, email FROM neon_auth."user" WHERE id = $1;`, [u.authUserId]),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1 ORDER BY genre_key;`, [u.id]),
      db.query(`SELECT count(*)::int AS n FROM user_ratings WHERE user_id = $1;`, [u.id]),
    ]);
    res.json({
      id: u.id,
      name: acc[0]?.name ?? null,
      email: acc[0]?.email ?? u.email,
      userType: u.user_type,
      libraryId: u.library_id,
      preferredCity: u.preferred_city,
      onboarded: Boolean(u.onboarded_at),
      genres: genres.map((g) => g.genre_key),
      ratingsCount: n[0].n,
    });
  }));

  router.patch("/", wrap(async (req, res) => {
    const city = req.body.preferredCity ?? null;
    if (city !== null && !CITIES.has(city)) throw new BadRequest(`preferredCity must be one of: ${[...CITIES].join(", ")}`);
    await db.query(`UPDATE users SET preferred_city = $1 WHERE id = $2;`, [city, req.user.id]);
    res.json({ ok: true, preferredCity: city });
  }));

  router.put("/genres", wrap(async (req, res) => {
    const genres = checkGenres(req.body.genres, { min: 1, max: 5 });
    await saveGenres(db, req.user.id, genres);
    res.json({ ok: true, genres });
  }));

  // ---------- questionnaire ----------
  router.post("/onboarding", wrap(async (req, res) => {
    const genres = checkGenres(req.body.genres, { min: 1, max: 5 });
    const ratings = checkRatings(req.body); // stars 1-5 only; "haven't read" dropped
    await checkBooksExist(ratings.map((r) => r.bookId));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await saveGenres(client, req.user.id, genres);
      await saveRatings(client, req.user.id, ratings, "onboarding");
      await client.query(`UPDATE users SET onboarded_at = coalesce(onboarded_at, now()) WHERE id = $1;`, [req.user.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ saved: { genres, ratings: ratings.length }, ...(await recommendFor(req.user.id, 10)) });
  }));

  // ---------- ratings ----------
  router.get("/ratings", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.book_id AS "bookId", r.rating, r.source, r.updated_at AS "updatedAt", b.title, b.authors, b.thumbnail_url
       FROM user_ratings r JOIN books b ON b.id = r.book_id
       WHERE r.user_id = $1 ORDER BY r.updated_at DESC;`,
      [req.user.id]
    );
    res.json({ ratings: rows });
  }));

  // "Rate more": the same choice as the questionnaire (onboarding.js - the
  // most liked books of HIS genres, at most 2 per author), but never a book he
  // already rated, and not the ones in `skip` (shown before, "haven't read").
  router.post("/rate-more", wrap(async (req, res) => {
    const skip = Array.isArray(req.body.skip) ? req.body.skip.slice(0, 1000).map(Number).filter(Number.isInteger) : [];
    const [{ rows: genres }, { rows: rated }] = await Promise.all([
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [req.user.id]),
      db.query(`SELECT book_id FROM user_ratings WHERE user_id = $1;`, [req.user.id]),
    ]);
    if (!genres.length) throw new BadRequest("choose your genres first");
    const keys = genres.map((g) => g.genre_key);
    const books = await getOnboardingBooks(keys, 20, { exclude: [...rated.map((r) => r.book_id), ...skip] });
    res.json({ genres: keys, books });
  }));

  router.post("/ratings", wrap(async (req, res) => {
    const list = req.body.ratings ?? [{ bookId: req.body.bookId, rating: req.body.rating }];
    if (!Array.isArray(list) || !list.length || list.length > 500) throw new BadRequest("send { bookId, rating } or { ratings: [...] } (up to 500)");
    const ratings = list.map((r) => {
      const rating = Number(r.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequest("rating must be 1-5");
      return { bookId: checkId(r.bookId), rating };
    });
    await checkBooksExist(ratings.map((r) => r.bookId));
    await saveRatings(db, req.user.id, ratings, req.body.source === "chat" ? "chat" : "app");
    res.json({ ok: true, saved: ratings.length });
  }));

  router.delete("/ratings/:bookId", wrap(async (req, res) => {
    const bookId = checkId(req.params.bookId);
    const { rowCount } = await db.query(`DELETE FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    res.json({ ok: true, deleted: rowCount });
  }));

  // ---------- events (stored only, for now) ----------
  router.post("/events", wrap(async (req, res) => {
    const bookId = checkId(req.body.bookId);
    const type = String(req.body.type || "");
    if (!EVENT_TYPES.has(type)) throw new BadRequest(`type must be one of: ${[...EVENT_TYPES].join(", ")}`);
    await checkBooksExist([bookId]);
    await db.query(`INSERT INTO user_events (user_id, book_id, type) VALUES ($1, $2, $3);`, [req.user.id, bookId, type]);
    res.json({ ok: true });
  }));

  // "Not for me" - why, answered after the ✕ (optional): goes on the latest "dismissed" event of the book
  router.post("/events/reason", wrap(async (req, res) => {
    const bookId = checkId(req.body.bookId);
    const reason = String(req.body.reason || "");
    if (!DISMISS_REASONS.has(reason)) throw new BadRequest(`reason must be one of: ${[...DISMISS_REASONS].join(", ")}`);
    const { rowCount } = await db.query(
      `UPDATE user_events SET reason = $3
       WHERE id = (SELECT id FROM user_events WHERE user_id = $1 AND book_id = $2 AND type = 'dismissed'
                   ORDER BY created_at DESC LIMIT 1);`,
      [req.user.id, bookId, reason]
    );
    if (!rowCount) throw new BadRequest("this book was not hidden");
    res.json({ ok: true });
  }));

  // ---------- shelf: saved + reading + finished books (from the events) ----------
  // A book is in ONE stage, by its latest event: saved / started / finished. After "unsaved"
  // it leaves the TBR, but a book the reader finished stays finished.
  router.get("/shelf", wrap(async (req, res) => {
    const { rows } = await db.query(
      `WITH latest AS (
         SELECT DISTINCT ON (book_id) book_id, type, created_at
         FROM user_events WHERE user_id = $1 AND type IN ('saved', 'unsaved', 'started', 'finished')
         ORDER BY book_id, created_at DESC
       ), done AS (
         SELECT DISTINCT book_id FROM user_events WHERE user_id = $1 AND type = 'finished'
       )
       SELECT CASE l.type WHEN 'saved' THEN 'saved' WHEN 'started' THEN 'reading' ELSE 'finished' END AS list,
              b.id, b.title, b.authors, b.thumbnail_url, l.created_at AS at
       FROM latest l JOIN books b ON b.id = l.book_id LEFT JOIN done d ON d.book_id = l.book_id
       WHERE l.type IN ('saved', 'started') OR d.book_id IS NOT NULL
       ORDER BY at DESC;`,
      [req.user.id]
    );
    const pick = (list) => rows.filter((r) => r.list === list).map(({ list: _l, at, ...b }) => ({ ...b, at }));
    res.json({ saved: pick("saved"), reading: pick("reading"), finished: pick("finished") });
  }));

  // ---------- recommendations from the saved ratings ----------
  // ---------- For You as shelves (like a streaming service: a row per genre) ----------
  // One call to the same hybrid model with a big pool, then: the first 10 = "Top picks",
  // the rest is shelved by genre - the user's genres first, then the genres that came up
  // most. Each book sits on ONE shelf, in the model's order. Nothing new is learned
  // here: it is only how the list is shown.
  const ROW_POOL = 160, ROW_MAX = 20, ROW_MIN = 4, ROWS_MAX = 8, TOP = 10;
  const GOODREADS_KEY = new Map(), GOOGLE_KEY = new Map(), LABEL_KEY = new Map();
  for (const g of GENRES) {
    for (const v of g.goodreads) GOODREADS_KEY.set(v, [...(GOODREADS_KEY.get(v) || []), g.key]);
    for (const v of g.google) GOOGLE_KEY.set(v, [...(GOOGLE_KEY.get(v) || []), g.key]);
    LABEL_KEY.set(g.label, [g.key]); // books uploaded by authors carry the genre name in categories
  }
  const keysOf = (b) => [...new Set([
    ...(b.main_genres || []).flatMap((v) => GOODREADS_KEY.get(v) || []),
    ...(b.goodbooks_id ? [] : (b.categories || []).flatMap((v) => GOOGLE_KEY.get(v) || LABEL_KEY.get(v) || [])),
  ])];

  warmPeek(db); // sum the dataset ratings at server start, so the first visitor does not wait

  router.get("/recommendations/rows", wrap(async (req, res) => {
    // the library filter: the raw form goes to the model (it checks it again), the checked form to the fresh shelves
    let nearby, where = null;
    const asked = nearbyFromQuery(req.query);
    if (asked) {
      nearby = { ...asked, mode: req.query.mode }; // with the mode, so "Available first" works on the shelves too
      where = parseNearby(nearby); // 400 on bad input
    }
    // a few more places for books without ratings (new books, author uploads) - they get their own exposure
    const r = await recommendFor(req.user.id, ROW_POOL, nearby, [], { slots: 12 });
    const recs = r.recommendations;
    const top = recs.slice(0, TOP);
    // the shelves that change with what the user does (server/fresh-rows.js): "Continue your series",
    // "Because you looked at <book>" - they take the places of the two last genre shelves
    const fresh = (await freshRows(db, req.user.id, { skipIds: top.map((b) => b.id), where })).map((x) => ({ ...x, books: x.books.map(withTexts) }));
    const onFresh = new Set(fresh.flatMap((x) => x.books.map((b) => b.id)));
    const rest = recs.slice(TOP).filter((b) => !onFresh.has(b.id)); // no book twice on the page
    const genreRowsMax = ROWS_MAX - fresh.length;
    const { rows: info } = rest.length
      ? await db.query(`SELECT id, goodbooks_id, main_genres, categories FROM books WHERE id = ANY($1::int[]);`, [rest.map((b) => b.id)])
      : { rows: [] };
    const genresOf = new Map(info.map((b) => [b.id, keysOf(b)]));
    const chosen = (r.genres || []).filter((k) => GENRE_LABEL.has(k));
    const freq = new Map();
    for (const b of rest) for (const k of genresOf.get(b.id) || []) freq.set(k, (freq.get(k) || 0) + 1);
    const order = [...chosen, ...[...freq.keys()].filter((k) => !chosen.includes(k)).sort((a, b) => freq.get(b) - freq.get(a))];
    const shelves = new Map(order.map((k) => [k, []]));
    const leftover = [];
    for (const b of rest) {
      const ks = genresOf.get(b.id) || [];
      const k = order.find((g) => ks.includes(g) && shelves.get(g).length < ROW_MAX);
      if (k) shelves.get(k).push(b); else leftover.push(b);
    }
    const rows = [];
    for (const k of order) {
      const books = shelves.get(k);
      if (books.length >= ROW_MIN && rows.length < genreRowsMax) rows.push({ key: k, label: GENRE_LABEL.get(k), chosen: chosen.includes(k), books });
      else leftover.push(...books);
    }
    if (leftover.length >= ROW_MIN) rows.push({ key: "more", label: "More picks for you", chosen: false, books: leftover.slice(0, ROW_MAX) });
    // for the floating card on hover: a short blurb + the overall rating (server/book-peek.js)
    const shown = [...top, ...fresh.flatMap((x) => x.books), ...rows.flatMap((x) => x.books)];
    const hover = await peekInfo(db, shown.map((b) => b.id));
    const add = (b) => ({ ...b, ...(hover.get(b.id) || {}) });
    res.json({
      cfModel: r.cfModel, genres: chosen, ...(r.nearby ? { nearby: r.nearby } : {}),
      top: top.map(add),
      fresh: fresh.map((x) => ({ ...x, books: x.books.map(add) })), // shown right after the Top 10
      rows: rows.map((x) => ({ ...x, books: x.books.map(add) })),
    });
  }));

  router.get("/recommendations", wrap(async (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 10, 1), 30);
    let nearby;
    const where = nearbyFromQuery(req.query);
    if (where) {
      nearby = { ...where, mode: req.query.mode };
      parseNearby(nearby); // 400 on bad input
    }
    // "Recommend more": the ids already on the page (up to 50 books in all)
    const exclude = String(req.query.exclude || "").split(",").filter(Boolean).slice(0, 100).map(Number).filter(Number.isInteger);
    res.json(await recommendFor(req.user.id, count, nearby, exclude));
  }));

  // search history: GET/POST/DELETE /api/me/searches (server/search-history.js)
  require("./search-history")(router, { db, h });
  // book page views: POST /api/me/book-views (server/book-views.js) - for "Because you looked at"
  require("./book-views")(router, { db, h });

  return router;
};

module.exports.makeRecommendFor = makeRecommendFor;
