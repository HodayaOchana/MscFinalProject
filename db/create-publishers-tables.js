/**
 * Publishers that the BookBridge TEAM checked and added (on /admin/publishers), and authors'
 * requests to add a publisher that is not on the list yet.
 *
 *   publishers          - name, contact email (the confirmation link goes there), website domain,
 *                         company / association registration number, ISBN prefix, and a document
 *                         that shows it is really them (PDF / JPG / PNG, up to 2 MB). active = false
 *                         when the team removes it (kept, so old requests still make sense).
 *   publisher_requests  - "my publisher isn't listed": who asked, the publisher's name and email as
 *                         the author wrote them, status pending -> added | rejected, the team's note.
 *                         One pending request per author. The team emails the publisher a form
 *                         (invite_*); what the publisher fills in is kept in sub_* until the team decides.
 * The list in the authors' dropdown = the active rows here; the key is the row's id (server/publishers.js).
 * source: team (added on the admin page) | publisher (filled in the form) | env (moved from .env).
 * Publishers that were in PUBLISHER_EMAILS: node db/import-env-publishers.js (once).
 *
 * Only CREATES new tables. Safe to run again.   Run:  node db/create-publishers-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS publishers (
  id                   serial PRIMARY KEY,
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  contact_email        text NOT NULL CHECK (length(contact_email) <= 254),
  website_domain       text NOT NULL CHECK (length(website_domain) <= 253),
  registration_number  text NOT NULL CHECK (length(registration_number) <= 30),
  isbn_prefix          text NOT NULL CHECK (length(isbn_prefix) <= 20),
  document             bytea NOT NULL,
  document_mime        text NOT NULL CHECK (document_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  document_name        text,
  notes                text,
  active               boolean NOT NULL DEFAULT true,
  added_by             int REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  removed_at           timestamptz
);
-- publishers moved from .env (db/import-env-publishers.js) have only a name and an email
ALTER TABLE publishers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'team' CHECK (source IN ('team', 'publisher', 'env')),
  ALTER COLUMN website_domain DROP NOT NULL,
  ALTER COLUMN registration_number DROP NOT NULL,
  ALTER COLUMN isbn_prefix DROP NOT NULL,
  ALTER COLUMN document DROP NOT NULL,
  ALTER COLUMN document_mime DROP NOT NULL;
-- the id is the key everywhere; a NAME appears once on the list (the same email may serve two names)
DROP INDEX IF EXISTS publishers_email_active;
CREATE UNIQUE INDEX IF NOT EXISTS publishers_name_active ON publishers (lower(name)) WHERE active;
CREATE INDEX IF NOT EXISTS publishers_email_idx ON publishers (lower(contact_email)) WHERE active;

CREATE TABLE IF NOT EXISTS publisher_requests (
  id              bigserial PRIMARY KEY,
  user_id         int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publisher_name  text NOT NULL CHECK (length(publisher_name) BETWEEN 1 AND 200),
  contact         text CHECK (contact IS NULL OR length(contact) <= 254),
  pen_name        text NOT NULL CHECK (length(pen_name) BETWEEN 1 AND 120),
  books           text NOT NULL CHECK (length(books) BETWEEN 1 AND 2000),
  message         text CHECK (message IS NULL OR length(message) <= 2000),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'added', 'rejected')),
  publisher_id    int REFERENCES publishers(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
-- the publisher fills in its own details: the team emails it a form (one link, 14 days)
ALTER TABLE publisher_requests
  ADD COLUMN IF NOT EXISTS invite_hash        text,
  ADD COLUMN IF NOT EXISTS invite_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at         timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS sub_name           text,
  ADD COLUMN IF NOT EXISTS sub_website        text,
  ADD COLUMN IF NOT EXISTS sub_registration   text,
  ADD COLUMN IF NOT EXISTS sub_isbn           text,
  ADD COLUMN IF NOT EXISTS sub_notes          text,
  ADD COLUMN IF NOT EXISTS sub_document       bytea,
  ADD COLUMN IF NOT EXISTS sub_document_mime  text,
  ADD COLUMN IF NOT EXISTS sub_document_name  text;
CREATE UNIQUE INDEX IF NOT EXISTS publisher_requests_invite ON publisher_requests (invite_hash) WHERE invite_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS publisher_requests_one_pending ON publisher_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS publisher_requests_status_idx ON publisher_requests (status, created_at);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  await pool.query(SQL);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM publishers) AS p, (SELECT count(*)::int FROM publisher_requests) AS r;`
  );
  console.log(`Tables ready: publishers (${rows[0].p} rows), publisher_requests (${rows[0].r} rows)`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
