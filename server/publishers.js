/**
 * Publishers on the authors' list, and authors' "my publisher isn't listed" requests.
 * Tables: publishers, publisher_requests (db/create-publishers-tables.js).
 *
 * The flow - the PUBLISHER fills in its own details, the team checks them:
 *   1. An author chooses "My publisher isn't listed" and gives the publisher's name and email
 *      (POST /api/me/author-request, publisher "other") -> a publisher_requests row + an email to the team.
 *   2. The team looks at the request on /admin/publishers and presses "Send the form to the publisher":
 *      the publisher gets an email with a private link (/publisher/apply?token=..., 14 days).
 *      Only an admin can send it - nobody can use the site to send mail to any address they like.
 *   3. The publisher fills in the form: name, website, company / association number, ISBN prefix and a
 *      document (required). Its email is the one the link was sent to - receiving the link proves it.
 *      The team gets an email: "<publisher> sent its details".
 *   4. The team checks the details (the server cross-checks them and shows warnings) and adds the
 *      publisher, or says no. The author gets an email either way; once added, it is in the list at once.
 *   The team can also fill in the details itself ("Fill it in myself"), or link the request to a
 *   publisher that is on the list already.
 *
 * Public (no login - the publisher has no BookBridge account), mounted at /api/publisher-apply:
 *   GET  /?token=...                         what the form is for -> { publisherName, contactEmail, penName, expiresAt, submitted }
 *   POST /  { token, name, website, registrationNumber, isbnPrefix, notes?, document: { data, name } }   once per link
 * Admin (project team only - mounted after the admin check in server/admin-routes.js):
 *   GET    /api/admin/publishers                         { publishers, requests }
 *   POST   /api/admin/publishers                         the team adds one itself (same fields + contactEmail, requestId?, confirm?)
 *   GET    /api/admin/publishers/:id/document            the document of a publisher on the list
 *   DELETE /api/admin/publishers/:id                     take it off the list (kept, active = false)
 *   POST   /api/admin/publisher-requests/:id/invite      email the form to the publisher (again: after 24 hours)
 *   GET    /api/admin/publisher-requests/:id/document    the document the publisher sent
 *   POST   /api/admin/publisher-requests/:id/approve     { confirm? } add what the publisher sent
 *   POST   /api/admin/publisher-requests/:id/link        { publisherId } - on the list already
 *   POST   /api/admin/publisher-requests/:id/reject      { note }
 * 409 { error, warnings } = a cross-check failed; send again with confirm: true to add anyway.
 * The document can be up to 2 MB, so server.js lets the two form routes take bodies up to 3 MB.
 *
 * Security: the link token is 256 random bits, only its sha256 is stored, it works for one form.
 */

const crypto = require("crypto");
const mailer = require("./mailer");

const DOC_MAX = 2 * 1024 * 1024;
const DOC_MAGIC = { "application/pdf": [0x25, 0x50, 0x44, 0x46], "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47] };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|protonmail|proton|gmx|mail|walla|012|netvision|bezeqint|zahav)\./;
const SAME_EMAIL = "Another publisher on the list already uses this email.";
const INVITE_DAYS = 14;
const REINVITE_HOURS = 24;
const missing = (err) => err.code === "42P01" || err.code === "42703";
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/** The list in the authors' dropdown = the active rows here (key = id). Call at start and after changes. */
async function loadPublishers(db) {
  try {
    const { rows } = await db.query(`SELECT id, name, contact_email FROM publishers WHERE active ORDER BY name;`);
    mailer.setDbPublishers(rows);
    if (process.env.PUBLISHER_EMAILS && !rows.length) console.warn("[publishers] PUBLISHER_EMAILS in .env is not used any more - move it to the table: node db/import-env-publishers.js");
  } catch (err) {
    if (!missing(err)) console.warn("[publishers] could not load the list:", err.message);
  }
}

// ---------- checks ----------
/** "https://www.Lantern-Press.co.il/about" -> "lantern-press.co.il" */
function domainOf(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch { return null; }
}
const sameSite = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/** Israeli company (51…), association (58…) etc. numbers: 9 digits with a check digit, like an ID number */
function israeliCheckDigitOk(num) {
  if (!/^\d{9}$/.test(num)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(num[i]) * (i % 2 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/** A "data:...;base64,..." document -> { file, mime, docName }. Throws BadRequest. */
function readDocument(doc, BadRequest) {
  const m = /^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(typeof doc?.data === "string" ? doc.data : "");
  if (!m) throw new BadRequest("a document is required - a PDF, JPG or PNG (company registration, ISBN agency letter…)");
  const file = Buffer.from(m[2], "base64");
  if (!file.length || file.length > DOC_MAX) throw new BadRequest("the document can be up to 2 MB");
  if (!DOC_MAGIC[m[1]].every((b, i) => file[i] === b)) throw new BadRequest("the document is not really a PDF / JPG / PNG");
  const docName = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim().slice(0, 200) : null;
  return { file, mime: m[1], docName };
}

/** Cross-checks: warnings, not errors - the team decides */
function warningsFor({ contactEmail, website, registrationNumber, isbnPrefix }) {
  const emailDomain = contactEmail.split("@")[1];
  const warnings = [];
  if (FREE_MAIL.test(emailDomain)) warnings.push(`The contact email is a private mailbox (${emailDomain}), not the publisher's own domain - anyone can open one.`);
  else if (!sameSite(emailDomain, website)) warnings.push(`The contact email (${emailDomain}) is not on the publisher's website domain (${website}).`);
  if (/^\d{9}$/.test(registrationNumber)) {
    if (!israeliCheckDigitOk(registrationNumber)) warnings.push("The registration number's check digit is wrong - it is not a valid Israeli company / association number.");
    else if (!/^5[0-9]/.test(registrationNumber)) warnings.push("Israeli companies start with 51 and associations (amutot) with 58 - this number starts differently.");
  } else {
    warnings.push("The registration number is not 9 digits - fine for a publisher outside Israel, check it in that country's registry.");
  }
  if (!isbnPrefix.startsWith("978965") && /\.il$/.test(website)) warnings.push("An Israeli website, but the ISBN prefix is not Israeli (978-965…).");
  return warnings;
}

/** Reads and checks the form. Throws BadRequest for wrong input; returns { values, warnings }.
 *  contactEmail: given = fixed (the address the publisher's link was sent to). */
function checkPublisher(body, BadRequest, { contactEmail: fixedEmail } = {}) {
  const text = (v, max, name, required = true) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (required && !t) throw new BadRequest(`${name} is required`);
    if (t.length > max) throw new BadRequest(`${name}: up to ${max} characters`);
    return t || null;
  };
  const name = text(body.name, 200, "publisher name");
  const contactEmail = fixedEmail || text(body.contactEmail, 254, "contact email").toLowerCase();
  if (!EMAIL_RE.test(contactEmail)) throw new BadRequest("contact email: please give a valid email address");
  const website = domainOf(text(body.website, 300, "website"));
  if (!website) throw new BadRequest("website: please give the publisher's site, like lanternpress.co.il");
  const registrationNumber = text(body.registrationNumber, 30, "registration number").replace(/[\s-]/g, "");
  if (!/^[0-9A-Za-z]{5,20}$/.test(registrationNumber)) throw new BadRequest("registration number: digits (and letters) only, 5-20 of them");
  const isbnPrefix = text(body.isbnPrefix, 20, "ISBN prefix").replace(/[\s-]/g, "");
  if (!/^97[89]\d{4,9}$/.test(isbnPrefix)) throw new BadRequest("ISBN prefix: starts with 978 or 979, 7-12 digits (e.g. 978-965-123)");
  const notes = text(body.notes, 1000, "notes", false);
  const doc = readDocument(body.document, BadRequest);
  const values = { name, contactEmail, website, registrationNumber, isbnPrefix, notes, ...doc };
  return { values, warnings: warningsFor(values) };
}

/** Adds a checked publisher to the list. Returns { id, name }. */
async function insertPublisher(db, v, addedBy, BadRequest, source) {
  try {
    const { rows: [p] } = await db.query(
      `INSERT INTO publishers (name, contact_email, website_domain, registration_number, isbn_prefix, document, document_mime, document_name, notes, added_by, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, name;`,
      [v.name, v.contactEmail, v.website, v.registrationNumber, v.isbnPrefix, v.file, v.mime, v.docName, v.notes, addedBy, source]
    );
    await loadPublishers(db);
    return p;
  } catch (err) {
    if (err.code === "23505") throw new BadRequest("a publisher with this name is already on the list");
    throw err;
  }
}

// ---------- the author's side (used by server/me-routes.js) ----------
/** "My publisher isn't listed": save the request and tell the team. Returns { id, emailed } */
async function requestPublisher(db, { userId, me, penName, books, message, publisherName, contact }, BadRequest) {
  const email = String(contact || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new BadRequest("please give your publisher's email - we send them a form to fill in");
  if (me?.email && email === String(me.email).toLowerCase()) throw new BadRequest("the publisher's email can't be your own email");
  if (mailer.isPublisherEmail(email)) throw new BadRequest("this publisher is on the list already - choose it from the list");
  let row;
  try {
    ({ rows: [row] } = await db.query(
      `INSERT INTO publisher_requests (user_id, publisher_name, contact, pen_name, books, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;`,
      [userId, publisherName, email, penName, books, message]
    ));
  } catch (err) {
    if (err.code === "23505") throw new BadRequest("the team is already checking a publisher for you - you'll get an email");
    if (missing(err)) throw new BadRequest("adding publishers is not set up yet (db/create-publishers-tables.js)");
    throw err;
  }
  const emailed = await mailer.sendUnlistedPublisher({
    id: Number(row.id), accountName: me?.name, accountEmail: me?.email, penName, books,
    publisherName, publisherContact: email, message,
  });
  return { id: Number(row.id), emailed };
}

const stageOf = (r) => (r.status !== "pending" ? r.status : r.submitted_at ? "submitted" : r.invited_at ? "invited" : "new");

/** The author's latest request (pending, or decided in the last 30 days) - for the Account page */
async function latestRequest(db, userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.publisher_name, r.note, r.created_at, r.decided_at, r.invited_at, r.submitted_at,
            p.id AS pid, p.name AS pname, p.active
     FROM publisher_requests r LEFT JOIN publishers p ON p.id = r.publisher_id
     WHERE r.user_id = $1 AND (r.status = 'pending' OR r.decided_at > now() - interval '30 days')
     ORDER BY r.created_at DESC LIMIT 1;`,
    [userId]
  ).catch((err) => (missing(err) ? { rows: [] } : Promise.reject(err)));
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id), status: r.status, stage: stageOf(r), // new | invited | submitted | added | rejected
    publisherName: r.status === "added" && r.pname ? r.pname : r.publisher_name,
    note: r.note, createdAt: r.created_at, decidedAt: r.decided_at,
    publisherKey: r.status === "added" && r.pid && r.active ? String(r.pid) : null, // to choose it in the dropdown
  };
}

/** For the bell: requests the TEAM has to act on (new, or the publisher sent its details) */
const pendingCount = (db) => db.query(
  `SELECT count(*)::int AS n FROM publisher_requests WHERE status = 'pending' AND (invited_at IS NULL OR submitted_at IS NOT NULL);`
).then((r) => r.rows[0].n).catch((err) => (missing(err) ? 0 : Promise.reject(err)));

// ---------- the publisher's form (no login) ----------
function publicApplyRoutes(router, { db, h }) {
  const { BadRequest, wrap } = h;
  const byToken = async (token, client = db, lock = false) => {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    const { rows } = await client.query(
      `SELECT id, publisher_name, contact, pen_name, invite_expires_at, submitted_at, status FROM publisher_requests
       WHERE invite_hash = $1 ${lock ? "FOR UPDATE" : ""};`, [sha256(token)]
    );
    return rows[0] || null;
  };
  const gone = (r) => r.status !== "pending" || new Date(r.invite_expires_at) < new Date();

  router.get("/", wrap(async (req, res) => {
    const r = await byToken(req.query.token);
    if (!r) return res.status(404).json({ error: "This link is not valid." });
    if (gone(r) && !r.submitted_at) return res.status(410).json({ error: "This link has expired. Reply to our email and we'll send a new one." });
    res.json({
      publisherName: r.publisher_name, contactEmail: r.contact, penName: r.pen_name,
      expiresAt: r.invite_expires_at, submitted: Boolean(r.submitted_at),
    });
  }));

  router.post("/", wrap(async (req, res) => {
    const client = await db.connect();
    let r;
    try {
      await client.query("BEGIN");
      r = await byToken(req.body?.token, client, true);
      if (!r) { await client.query("ROLLBACK"); return res.status(404).json({ error: "This link is not valid." }); }
      if (r.submitted_at) { await client.query("ROLLBACK"); throw new BadRequest("we already have your details - thank you"); }
      if (gone(r)) { await client.query("ROLLBACK"); return res.status(410).json({ error: "This link has expired." }); }
      const { values: v } = checkPublisher(req.body, BadRequest, { contactEmail: r.contact });
      await client.query(
        `UPDATE publisher_requests SET submitted_at = now(), sub_name = $2, sub_website = $3, sub_registration = $4,
           sub_isbn = $5, sub_notes = $6, sub_document = $7, sub_document_mime = $8, sub_document_name = $9 WHERE id = $1;`,
        [r.id, v.name, v.website, v.registrationNumber, v.isbnPrefix, v.notes, v.file, v.mime, v.docName]
      );
      await client.query("COMMIT");
      r.sub_name = v.name;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    mailer.sendPublisherSubmitted({ id: Number(r.id), publisherName: r.sub_name, penName: r.pen_name }).catch(() => {});
    res.json({ ok: true });
  }));
}

// ---------- the team's side ----------
function adminPublisherRoutes(router, { db, h }) {
  const { BadRequest, wrap, checkId } = h;

  const requestRow = async (id) => (await db.query(
    `SELECT r.*, a.email, a.name AS account_name FROM publisher_requests r JOIN users u ON u.id = r.user_id
     JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE r.id = $1;`, [id]
  )).rows[0];

  /** Marks the request decided and emails the author (their own account email). Returns emailed true/false. */
  async function decide(requestId, { status, publisherId = null, publisherName, note = null }) {
    const { rows } = await db.query(
      `UPDATE publisher_requests SET status = $2, publisher_id = $3, note = $4, decided_at = now(), invite_hash = NULL
       WHERE id = $1 AND status = 'pending' RETURNING id;`,
      [requestId, status, publisherId, note]
    );
    if (!rows.length) {
      const { rowCount } = await db.query(`SELECT 1 FROM publisher_requests WHERE id = $1;`, [requestId]);
      throw Object.assign(new BadRequest(rowCount ? "this request was decided already" : "no such request"), { status: rowCount ? 400 : 404 });
    }
    const r = await requestRow(requestId);
    if (!r?.email) return false;
    return mailer.sendPublisherDecision({ to: r.email, approved: status === "added", publisherName: publisherName || r.publisher_name, note });
  }

  /** What the publisher sent, in the shape of the form */
  const submission = (r) => ({
    name: r.sub_name, contactEmail: r.contact, website: r.sub_website, registrationNumber: r.sub_registration,
    isbnPrefix: r.sub_isbn, notes: r.sub_notes, file: r.sub_document, mime: r.sub_document_mime, docName: r.sub_document_name,
  });

  router.get("/publishers", wrap(async (req, res) => {
    const [pubs, reqs] = await Promise.all([
      db.query(
        `SELECT id, name, contact_email, website_domain, registration_number, isbn_prefix, document_mime, document_name,
                notes, active, created_at, removed_at, source,
                (SELECT count(*)::int FROM author_requests ar WHERE lower(ar.publisher_email) = lower(p.contact_email)) AS authors
         FROM publishers p ORDER BY active DESC, name;`
      ).catch((err) => (missing(err) ? { rows: [], missing: true } : Promise.reject(err))),
      db.query(
        `SELECT r.id, r.status, r.publisher_name, r.contact, r.pen_name, r.books, r.message, r.note, r.created_at, r.decided_at,
                r.invited_at, r.invite_expires_at, r.submitted_at, r.sub_name, r.sub_website, r.sub_registration, r.sub_isbn,
                r.sub_notes, r.sub_document_name, p.name AS added_as, a.name, a.email
         FROM publisher_requests r JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
         LEFT JOIN publishers p ON p.id = r.publisher_id
         WHERE r.status = 'pending' OR r.decided_at > now() - interval '60 days'
         ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 200;`
      ).catch((err) => (missing(err) ? { rows: [], missing: true } : Promise.reject(err))),
    ]);
    if (pubs.missing || reqs.missing) throw new BadRequest("publishers are not set up yet - run node db/create-publishers-tables.js");
    res.json({
      publishers: pubs.rows.map((p) => ({
        id: p.id, key: String(p.id), name: p.name, contactEmail: p.contact_email, website: p.website_domain,
        registrationNumber: p.registration_number, isbnPrefix: p.isbn_prefix, documentName: p.document_name,
        documentMime: p.document_mime, notes: p.notes, active: p.active, createdAt: p.created_at, removedAt: p.removed_at,
        authors: p.authors, source: p.source, // team | publisher | env (moved from .env - no document)
      })),
      requests: reqs.rows.map((r) => ({
        id: Number(r.id), status: r.status, stage: stageOf(r), publisherName: r.publisher_name, contact: r.contact,
        penName: r.pen_name, books: r.books, message: r.message, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at,
        invitedAt: r.invited_at, inviteExpiresAt: r.invite_expires_at, submittedAt: r.submitted_at,
        canReinvite: !r.submitted_at && (!r.invited_at || Date.now() - new Date(r.invited_at) > REINVITE_HOURS * 36e5),
        submitted: r.submitted_at ? {
          name: r.sub_name, website: r.sub_website, registrationNumber: r.sub_registration, isbnPrefix: r.sub_isbn,
          notes: r.sub_notes, documentName: r.sub_document_name,
          warnings: warningsFor({ contactEmail: r.contact, website: r.sub_website, registrationNumber: r.sub_registration, isbnPrefix: r.sub_isbn }),
        } : null,
        addedAs: r.added_as, name: r.name, email: r.email,
      })),
    });
  }));

  // The team fills in the details itself
  router.post("/publishers", wrap(async (req, res) => {
    const { values: v, warnings } = checkPublisher(req.body || {}, BadRequest);
    const requestId = req.body.requestId == null || req.body.requestId === "" ? null : checkId(req.body.requestId);
    if (mailer.isPublisherEmail(v.contactEmail)) warnings.push(SAME_EMAIL);
    if (warnings.length && req.body.confirm !== true) return res.status(409).json({ error: "please check these before adding", warnings });
    const p = await insertPublisher(db, v, req.user.id, BadRequest, "team");
    const emailed = requestId ? await decide(requestId, { status: "added", publisherId: p.id, publisherName: p.name }) : null;
    res.status(201).json({ ok: true, publisher: { id: p.id, key: String(p.id), name: p.name }, emailed });
  }));

  router.get("/publishers/:id/document", wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT document, document_mime, document_name FROM publishers WHERE id = $1;`, [checkId(req.params.id)]);
    if (!rows[0]?.document) return res.status(404).json({ error: "no document (moved from .env)" });
    sendDocument(res, rows[0].document, rows[0].document_mime, rows[0].document_name);
  }));

  router.delete("/publishers/:id", wrap(async (req, res) => {
    const { rowCount } = await db.query(`UPDATE publishers SET active = false, removed_at = now() WHERE id = $1 AND active;`, [checkId(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: "not on the list" });
    await loadPublishers(db);
    res.json({ ok: true });
  }));

  // Email the form to the publisher - only from here (an admin), never straight from the author's request
  router.post("/publisher-requests/:id/invite", wrap(async (req, res) => {
    const r = await requestRow(checkId(req.params.id));
    if (!r) return res.status(404).json({ error: "no such request" });
    if (r.status !== "pending") throw new BadRequest("this request was decided already");
    if (r.submitted_at) throw new BadRequest("the publisher already sent its details");
    if (!EMAIL_RE.test(r.contact || "")) throw new BadRequest("the author gave no email for the publisher - fill it in yourself, or ask the author");
    if (r.invited_at && Date.now() - new Date(r.invited_at) < REINVITE_HOURS * 36e5) throw new BadRequest("the form was sent in the last 24 hours");
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
    const emailed = await mailer.sendPublisherInvite({
      to: r.contact, token, publisherName: r.publisher_name, penName: r.pen_name, books: r.books, expiresAt,
    });
    if (!emailed) throw new BadRequest("the email was not sent (mail is off or today's limit was reached) - try later");
    await db.query(`UPDATE publisher_requests SET invite_hash = $2, invite_expires_at = $3, invited_at = now() WHERE id = $1;`,
      [r.id, sha256(token), expiresAt]);
    res.json({ ok: true, emailed });
  }));

  router.get("/publisher-requests/:id/document", wrap(async (req, res) => {
    const r = await requestRow(checkId(req.params.id));
    if (!r?.sub_document) return res.status(404).json({ error: "no document" });
    sendDocument(res, r.sub_document, r.sub_document_mime, r.sub_document_name);
  }));

  // Add what the publisher sent
  router.post("/publisher-requests/:id/approve", wrap(async (req, res) => {
    const r = await requestRow(checkId(req.params.id));
    if (!r) return res.status(404).json({ error: "no such request" });
    if (r.status !== "pending") throw new BadRequest("this request was decided already");
    if (!r.submitted_at) throw new BadRequest("the publisher has not sent its details yet");
    const v = submission(r);
    const warnings = warningsFor(v);
    if (mailer.isPublisherEmail(v.contactEmail)) warnings.push(SAME_EMAIL);
    if (warnings.length && req.body?.confirm !== true) return res.status(409).json({ error: "please check these before adding", warnings });
    const p = await insertPublisher(db, v, req.user.id, BadRequest, "publisher");
    const emailed = await decide(r.id, { status: "added", publisherId: p.id, publisherName: p.name });
    res.json({ ok: true, publisher: { id: p.id, key: String(p.id), name: p.name }, emailed });
  }));

  router.post("/publisher-requests/:id/link", wrap(async (req, res) => {
    const requestId = checkId(req.params.id);
    const { rows } = await db.query(`SELECT id, name FROM publishers WHERE id = $1 AND active;`, [checkId(req.body.publisherId)]);
    if (!rows[0]) throw new BadRequest("choose a publisher from the list");
    const emailed = await decide(requestId, { status: "added", publisherId: rows[0].id, publisherName: rows[0].name });
    res.json({ ok: true, emailed });
  }));

  router.post("/publisher-requests/:id/reject", wrap(async (req, res) => {
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 1000) : "";
    if (!note) throw new BadRequest("please write a short reason - the author gets it by email");
    const emailed = await decide(checkId(req.params.id), { status: "rejected", note });
    res.json({ ok: true, emailed });
  }));
}

function sendDocument(res, file, mime, name) {
  const ext = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }[mime];
  const safeName = String(name || `document.${ext}`).replace(/[^\w.\- ]+/g, "_");
  res.set("Content-Type", mime);
  res.set("Content-Disposition", `inline; filename="${safeName}"`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, no-store");
  res.send(file);
}

module.exports = {
  loadPublishers, requestPublisher, latestRequest, pendingCount, adminPublisherRoutes, publicApplyRoutes,
  checkPublisher, warningsFor, israeliCheckDigitOk, domainOf,
};
