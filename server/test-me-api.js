/**
 * End-to-end test of the signed-in user API, with a REAL Neon Auth account.
 *
 *   1. signs in to Neon Auth with a TEST email + password (creates the
 *      account the first time)
 *   2. gets the login token (JWT)
 *   3. calls the running server: profile, questionnaire, ratings, events,
 *      recommendations (plain + nearby libraries), and a request without a
 *      token (must be refused)
 *
 * WRITES data, then PUTS IT BACK at the end (also if a check fails): the genres,
 * the ratings of the 3 test books, the TBR list, the test search. So it can run on
 * a real account with lots of data. The only trace left: one book view (Dune).
 *
 * --read-only: ONLY reads (nothing is written, not even a view) - for a real account with
 * lots of data: For You load time, no book twice, no rated book, the fresh shelves.
 *
 * First start the server in another terminal:  node server/server.js
 * Run:  node server/test-me-api.js test1@recoread.dev "Test-password-123"
 *       node server/test-me-api.js real.user@gmail.com "password" --read-only
 *
 * Needs NEON_AUTH_BASE_URL in .env. If sign-in fails, the full answer from Neon
 * Auth is printed - email + password sign-in must be enabled in the Neon
 * Console (Auth -> Configuration).
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const AUTH_URL = (process.env.NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || "").replace(/\/$/, "");
const API = `http://localhost:${process.env.PORT || 3001}`;
const ORIGIN = "http://localhost:3000"; // like a website running locally
const [email, password] = process.argv.slice(2);
const READ_ONLY = process.argv.includes("--read-only"); // only reads: for a real account with lots of data

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
}

// cookies returned by Neon Auth (the session), sent back on the next calls
function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

async function authCall(pathPart, body, cookie) {
  const res = await fetch(`${AUTH_URL}${pathPart}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, json, text };
}

async function getToken() {
  // sign in; the first time - sign up
  let r = await authCall("/sign-in/email", { email, password });
  if (!r.res.ok && READ_ONLY) throw new Error(`Sign-in refused (${r.res.status}) - check the email and password (read-only mode never creates an account)`);
  if (!r.res.ok) {
    console.log(`Sign-in: ${r.res.status} - trying to create the test account...`);
    r = await authCall("/sign-up/email", { email, password, name: "RecoRead Test" });
  }
  if (!r.res.ok) throw new Error(`Neon Auth refused (${r.res.status}): ${r.text.slice(0, 300)}`);
  const cookie = cookiesFrom(r.res);

  // the JWT: from the session header, or from /token
  const s = await authCall("/get-session", null, cookie);
  let token = s.res.headers.get("set-auth-jwt");
  if (!token) {
    const t = await authCall("/token", null, cookie);
    token = t.json?.token;
    if (!token) throw new Error(`No token from Neon Auth (/token ${t.res.status}): ${t.text.slice(0, 300)}`);
  }
  return token;
}

async function api(method, pathPart, token, body) {
  const res = await fetch(`${API}${pathPart}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function main() {
  if (!AUTH_URL) throw new Error("Missing NEON_AUTH_BASE_URL in .env");
  if (!email || !password) throw new Error('Usage: node server/test-me-api.js <test email> "<password>"');

  console.log(`Signing in to Neon Auth as ${email}...`);
  const token = await getToken();
  console.log("Got a login token.\n");

  const noToken = await api("GET", "/api/me");
  check("request without login is refused (401)", noToken.status === 401, `got ${noToken.status}`);
  const badToken = await api("GET", "/api/me", "not-a-real-token");
  check("fake token is refused (401)", badToken.status === 401, `got ${badToken.status}`);

  const me = await api("GET", "/api/me", token);
  check("profile (GET /api/me)", me.status === 200, me.json ? `name ${me.json.name}, ${me.json.ratingsCount} ratings` : me.status);

  if (READ_ONLY) {
    await readOnly(token, me.json);
    console.log(`\n${pass} passed, ${fail} failed.  (read-only: nothing was written)`);
    if (fail) process.exitCode = 1;
    return;
  }

  // The test may run on a real account: remember what it changes, and put it back at the end
  const before = {
    genres: me.json?.genres || [],
    ratings: new Map(((await api("GET", "/api/me/ratings", token)).json?.ratings || []).map((r) => [r.bookId, r.rating])),
    saved: new Set(((await api("GET", "/api/me/shelf", token)).json?.saved || []).map((b) => b.id)),
  };
  const ids = [];
  try {
    await steps(token, ids);
  } finally {
    await restore(token, before, ids);
  }
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) process.exitCode = 1;
}

// Read-only, on a real account: how fast and how correct For You is for a user with lots of data
const timed = async (n, fn) => {
  const times = [];
  let last;
  for (let i = 0; i < n; i++) { const t = performance.now(); last = await fn(); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  return { last, text: `${n} calls: fastest ${Math.round(times[0])} ms, median ${Math.round(times[Math.floor(n / 2)])} ms, slowest ${Math.round(times[n - 1])} ms` };
};
async function readOnly(token, me) {
  const rated = new Set(((await api("GET", "/api/me/ratings", token)).json?.ratings || []).map((r) => r.bookId));
  console.log(`  (${rated.size} ratings, genres: ${(me?.genres || []).join(", ") || "-"})`);

  const recs = await timed(5, () => api("GET", "/api/me/recommendations", token));
  check("Top 10 (GET /recommendations)", recs.last.status === 200 && recs.last.json?.recommendations?.length === 10, recs.text);

  const rows = await timed(5, () => api("GET", "/api/me/recommendations/rows", token));
  const j = rows.last.json || {};
  check("For You shelves (GET /recommendations/rows)", rows.last.status === 200 && j.top?.length === 10, rows.text);
  const fresh = j.fresh || [];
  const all = [...(j.top || []), ...fresh.flatMap((r) => r.books), ...(j.rows || []).flatMap((r) => r.books)].map((b) => b.id);
  check("no book twice on the page", new Set(all).size === all.length, `${all.length} books on ${1 + fresh.length + (j.rows || []).length} shelves`);
  check("no rated book on the page", !all.some((id) => rated.has(id)));
  // the fresh shelves depend on what this user did - shown as information, not as pass / fail
  for (const key of ["series", "looked"]) {
    const r = fresh.find((x) => x.key === key);
    console.log(`  info  ${key === "series" ? "\"Continue your series\"" : "\"Because you looked at\""}: ` +
      (r ? `${r.label} - ${r.books.slice(0, 3).map((b) => b.title).join(", ")}${r.books.length > 3 ? ` (+${r.books.length - 3})` : ""}` : "not shown (nothing to base it on yet)"));
  }
}

// Back to how the account was: genres, the ratings of the 3 test books, the TBR list
async function restore(token, before, ids) {
  let ok = true;
  if (before.genres.length) ok = (await api("PUT", "/api/me/genres", token, { genres: before.genres })).status === 200 && ok;
  for (const id of ids) {
    const r = before.ratings.has(id)
      ? await api("POST", "/api/me/ratings", token, { bookId: id, rating: before.ratings.get(id) })
      : await api("DELETE", `/api/me/ratings/${id}`, token);
    ok = r.status === 200 && ok;
  }
  if (ids[0] && !before.saved.has(ids[0])) ok = (await api("POST", "/api/me/events", token, { bookId: ids[0], type: "unsaved" })).status === 200 && ok;
  console.log(`\n  ${ok ? "Account restored" : "WARNING: could not fully restore"}: genres (${before.genres.join(", ") || "none"}), ratings of the 3 test books, TBR list.`);
  console.log("  (The Dune book view stays in user_book_views - the only trace, it counts after 30 minutes.)");
}

async function steps(token, ids) {
  // three known books, found by title
  for (const q of ["The Hobbit", "Twilight", "Gone Girl"]) {
    const s = await api("GET", `/api/books/search?q=${encodeURIComponent(q)}`);
    if (s.json?.books?.[0]) ids.push(s.json.books[0].id);
  }
  check("found 3 test books by search", ids.length === 3, ids.join(", "));

  const onb = await api("POST", "/api/me/onboarding", token, {
    genres: ["fantasy", "mystery-crime"],
    answers: [{ bookId: ids[0], stars: 5 }, { bookId: ids[1], stars: 4 }, { bookId: ids[2], stars: null }],
  });
  check("questionnaire saved + 10 recommendations", onb.status === 200 && onb.json?.recommendations?.length === 10,
    onb.json?.saved ? `saved ${onb.json.saved.ratings} ratings (1 "haven't read" dropped)` : JSON.stringify(onb.json));

  const rate = await api("POST", "/api/me/ratings", token, { bookId: ids[2], rating: 4 });
  check("rate a book (POST /api/me/ratings)", rate.status === 200);
  const badRate = await api("POST", "/api/me/ratings", token, { bookId: ids[2], rating: 9 });
  check("bad rating refused (400)", badRate.status === 400);

  const ev = await api("POST", "/api/me/events", token, { bookId: ids[0], type: "saved" });
  check("save event (POST /api/me/events)", ev.status === 200);

  const mine = await api("GET", "/api/me/ratings", token);
  const got = new Map((mine.json?.ratings || []).map((r) => [r.bookId, r.rating]));
  check("my ratings saved: 5, 4, and the re-rated book 4",
    got.get(ids[0]) === 5 && got.get(ids[1]) === 4 && got.get(ids[2]) === 4,
    (mine.json?.ratings || []).map((r) => `${r.title}=${r.rating} (${r.source})`).join(", "));

  const recs = await api("GET", "/api/me/recommendations", token);
  check("recommendations from saved ratings", recs.status === 200 && recs.json?.recommendations?.length === 10,
    `CF weight ${Math.round((recs.json?.cfWeight || 0) * 100)}%`);
  (recs.json?.recommendations || []).slice(0, 5).forEach((b, i) => console.log(`        ${i + 1}. ${b.title} - ${b.reasonText}`));

  const near = await api("GET", "/api/me/recommendations?city=Jerusalem&mode=filter", token);
  check("recommendations + libraries in Jerusalem (filter)",
    near.status === 200 && near.json?.recommendations?.every((b) => b.availability),
    `${near.json?.nearby?.available}/${near.json?.recommendations?.length} available`);

  // ---------- search: by author and by reader tag ----------
  const byAuthor = await api("GET", "/api/books/search?q=rowling");
  check("search by author (\"rowling\")", byAuthor.status === 200 && byAuthor.json?.books?.some((b) => (b.authors || []).some((a) => /rowling/i.test(a))),
    `${byAuthor.json?.books?.length ?? 0} books`);
  const byTag = await api("GET", "/api/books/search?q=%23dystopian");
  check("search by reader tag (\"#dystopian\")", byTag.status === 200 && byTag.json?.mode === "tag" && byTag.json?.books?.length > 0,
    `mode ${byTag.json?.mode}, ${byTag.json?.books?.length ?? 0} books`);

  // ---------- the fresh For You shelves ----------
  // "Because you looked at": a search, then opening a result (the test user has not rated Dune)
  const dune = await api("GET", "/api/books/search?q=dune");
  const duneId = dune.json?.books?.[0]?.id;
  const saved = await api("POST", "/api/me/searches", token, { query: "dune", resultsCount: dune.json?.books?.length || 0, topBookIds: (dune.json?.books || []).slice(0, 3).map((b) => b.id) });
  const click = saved.json?.id ? await api("POST", `/api/me/searches/${saved.json.id}/click`, token, { bookId: duneId }) : { status: 0 };
  check("search saved + result opened", saved.status === 200 && click.status === 200, `search id ${saved.json?.id}, book ${duneId}`);

  // a book page view: counted once, the same book again at once is NOT counted (30 minutes)
  await api("POST", "/api/me/book-views", token, { bookId: duneId });
  const again = await api("POST", "/api/me/book-views", token, { bookId: duneId });
  check("book view again within 30 min is not counted", again.status === 200 && again.json?.counted === false,
    again.json?.tableMissing ? "table missing - run db/create-book-views-table.js" : `counted ${again.json?.counted}`);

  // the shelves, timed (the For You page loads this one call)
  const times = [];
  let rows;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    rows = await api("GET", "/api/me/recommendations/rows", token);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  check("For You shelves (GET /recommendations/rows)", rows.status === 200 && rows.json?.top?.length === 10,
    `5 calls: fastest ${Math.round(times[0])} ms, median ${Math.round(times[2])} ms, slowest ${Math.round(times[4])} ms`);
  const fresh = rows.json?.fresh || [];
  const all = [...(rows.json?.top || []), ...fresh.flatMap((r) => r.books), ...(rows.json?.rows || []).flatMap((r) => r.books)].map((b) => b.id);
  check("no book twice on the page", new Set(all).size === all.length, `${all.length} books`);
  check("no rated book on the page", !all.some((id) => ids.includes(id)));
  const series = fresh.find((r) => r.key === "series");
  check("\"Continue your series\" shelf (rated Twilight)", Boolean(series?.books?.length >= 2),
    series ? series.books.slice(0, 3).map((b) => `${b.title}`).join(", ") : "not shown");
  const looked = fresh.find((r) => r.key === "looked");
  check("\"Because you looked at\" shelf (opened Dune from a search)", looked?.anchor?.id === duneId && looked.books.length >= 4,
    looked ? `${looked.label}: ${looked.books.length} books` : "not shown");

  // clean up: the test search leaves the history
  await api("DELETE", "/api/me/searches?query=dune", token);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
