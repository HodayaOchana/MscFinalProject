/**
 * Real misses become test cases: every answer a reader marked 👎 (chat_turns.feedback = -1)
 * is turned into a scenario for server/eval-chat.js, so each fix is checked against the
 * chat's real failures - and a failure that was fixed stays fixed.
 *
 *   node server/eval-from-feedback.js            adds the new 👎 answers to logs/eval-regressions.json
 *   node server/eval-from-feedback.js --days 7   only the last 7 days (default: all)
 *   node server/eval-chat.js --regressions       runs them (checks below)
 *
 * A scenario: the reader's message, with up to 2 earlier messages of the same conversation
 * (a refinement like "shorter" needs them), and why the reader pressed 👎. eval-chat.js checks:
 *   every reason      a judge model (server/chat-judge.js): the new answer does what was asked
 *                     and does not have the problem the reader reported
 *   wrong_info        + faithfulness: every claim about a book is in the tool results
 *   too_long          + under 150 words
 *
 * Only the messages and the reason are copied - no names, emails or reader ids. Still, they are
 * what real readers wrote: the file stays local (logs/ is not committed), and a scenario can
 * be removed from it by hand. One scenario per answer: running it again adds only new ones.
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const OUT = path.join(__dirname, "..", "logs", "eval-regressions.json"); // logs/ is in .gitignore - real readers' words
const EARLIER = 2; // earlier messages replayed before the one that missed

(async () => {
  const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || null;
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows: misses } = await db.query(
    `SELECT t.conversation_id, t.turn, t.user_message, t.feedback_reason, t.reply, t.model, t.feedback_at
     FROM chat_turns t WHERE t.feedback = -1 ${days ? "AND t.feedback_at > now() - make_interval(days => $1)" : ""}
     ORDER BY t.feedback_at;`,
    days ? [days] : []
  );
  const saved = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { scenarios: [] };
  const have = new Set(saved.scenarios.map((s) => s.id));
  let added = 0;
  for (const m of misses) {
    const id = `fb-${m.conversation_id.slice(0, 8)}-${m.turn}`;
    if (have.has(id)) continue;
    const { rows: earlier } = await db.query(
      `SELECT user_message FROM chat_turns WHERE conversation_id = $1 AND turn < $2 ORDER BY turn DESC LIMIT ${EARLIER};`,
      [m.conversation_id, m.turn]
    );
    saved.scenarios.push({
      id,
      reason: m.feedback_reason || null,
      messages: [...earlier.reverse().map((e) => e.user_message), m.user_message],
      missed: { reply: m.reply.slice(0, 600), model: m.model, at: m.feedback_at },
    });
    added++;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), scenarios: saved.scenarios }, null, 2));
  console.log(`${misses.length} answers with 👎, ${added} new scenario(s) - ${saved.scenarios.length} in ${path.relative(process.cwd(), OUT)}`);
  await db.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
