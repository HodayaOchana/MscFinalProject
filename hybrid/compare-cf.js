/**
 * Before / after EASE for ONE BookBridge user: the same hybrid, once with the
 * old CF (ALS + item-item) and once with the new one (EASE + ALS), side by side.
 * Only READS. The user's genres and ratings are used exactly as on For You
 * (diversify on, no library filter).
 *
 *   node hybrid/compare-cf.js                        list the users (email, ratings)
 *   node hybrid/compare-cf.js someone@example.com    compare for this user
 *   node hybrid/compare-cf.js someone@example.com 20 top 20 instead of 10
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const hybrid = require(path.join(__dirname, "hybrid-recommender"));
const pool = hybrid.pool;

async function main() {
  const email = process.argv[2];
  const count = Number(process.argv[3]) || 10;
  if (!email) {
    const { rows } = await pool.query(
      `SELECT a.email, count(r.book_id)::int AS ratings FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id
       LEFT JOIN user_ratings r ON r.user_id = u.id GROUP BY a.email ORDER BY ratings DESC;`);
    console.log("Users (run again with one of the emails):");
    rows.forEach((r) => console.log(`  ${r.email}  - ${r.ratings} ratings`));
    return;
  }
  const { rows: [user] } = await pool.query(
    `SELECT u.id FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE lower(a.email) = lower($1);`, [email]);
  if (!user) throw new Error(`no user with the email ${email}`);
  const { rows: ratings } = await pool.query(`SELECT book_id, rating FROM user_ratings WHERE user_id = $1;`, [user.id]);
  const { rows: genres } = await pool.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [user.id]);
  const input = ratings.map((r) => ({ bookId: r.book_id, rating: r.rating }));
  const opts = { genres: genres.map((g) => g.genre_key), diversify: true };

  const [oldR, newR] = [await hybrid.getHybridRecommendations(input, count, { ...opts, cf: "legacy" }),
    await hybrid.getHybridRecommendations(input, count, opts)];
  console.log(`${email}: ${ratings.length} ratings, genres: ${opts.genres.join(", ") || "-"}\n`);
  console.log(`  ${"BEFORE: " + oldR.cfModel}`.padEnd(58) + `AFTER: ${newR.cfModel}`);
  const newIds = new Set(newR.recommendations.map((b) => b.id));
  const oldIds = new Set(oldR.recommendations.map((b) => b.id));
  for (let i = 0; i < count; i++) {
    const a = oldR.recommendations[i], b = newR.recommendations[i];
    const left = a ? `${newIds.has(a.id) ? " " : "-"} ${a.title}`.slice(0, 54) : "";
    const right = b ? `${oldIds.has(b.id) ? " " : "+"} ${b.title}`.slice(0, 60) : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${left.padEnd(54)} ${right}`);
  }
  const same = newR.recommendations.filter((b) => oldIds.has(b.id)).length;
  console.log(`\n  ${same} of ${count} books are in both lists. "-" = only before, "+" = new with EASE.`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
