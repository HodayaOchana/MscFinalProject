/**
 * Faithfulness of the chatbot's answers: is every fact it states about a book in what the tools
 * returned? The grounding check (server/chat-text.js) only proves a recommended book EXISTS; this
 * checks what the answer SAYS about it - pages, plot, protagonist, series, ratings, availability.
 *
 *   node server/eval-faithfulness.js               the 30 latest answers that name books
 *   node server/eval-faithfulness.js --count 50    more
 *   node server/eval-faithfulness.js --days 7      only from the last 7 days
 *
 * For each answer: its saved tool results (chat_messages) and the answer go to a judge model
 * (server/chat-judge.js, CHAT_JUDGE_MODEL - default Sonnet), which lists the claims and marks each
 * supported or not. Results: logs/eval-faithfulness-<date>.json (logs/ - real readers' messages),
 * the score per answer and every unsupported claim, to read and fix the prompt or the tools.
 *
 * Costs a little: one judge call per answer (about 10K input tokens with Sonnet).
 * The judge can be wrong too - read the unsupported claims before acting on them.
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const { judgeFaithfulness, JUDGE_MODEL } = require("./chat-judge");
const { readerTexts } = require("./chat-text");

const arg = (name, fallback) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) || fallback : fallback);

// What the model knew when it wrote answer number `turn`: every tool result in the conversation up
// to it - a later answer ("which of those is shortest?") rightly uses facts from earlier turns
function evidenceOfTurn(messages, turn) {
  let seen = 0;
  const out = [];
  for (const m of messages) {
    if (m.role === "user" && readerTexts([m]).length) {
      seen++;
      if (seen > turn) break;
      // "Ask about this book": the app's own lookup came with the reader's message
      if (Array.isArray(m.content)) out.push(...m.content.filter((b) => b.type === "text" && b.text.startsWith("<book_lookup>")).map((b) => b.text));
      continue;
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      out.push(...m.content.filter((b) => b.type === "tool_result").map((b) => (typeof b.content === "string" ? b.content : JSON.stringify(b.content))));
    }
  }
  return out.join("\n");
}

(async () => {
  const count = arg("--count", 30);
  const days = arg("--days", null);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows: turns } = await db.query(
    `SELECT conversation_id, turn, user_message, reply, model, created_at FROM chat_turns
     WHERE mentioned > 0 ${days ? "AND created_at > now() - make_interval(days => $2)" : ""}
     ORDER BY created_at DESC LIMIT $1;`,
    days ? [count, days] : [count]
  );
  console.log(`judge: ${JUDGE_MODEL} - ${turns.length} answers`);
  const results = [];
  for (const t of turns) {
    const { rows: messages } = await db.query(`SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY seq;`, [t.conversation_id]);
    const evidence = evidenceOfTurn(messages, t.turn);
    if (!evidence) { console.log(`skip  ${t.conversation_id.slice(0, 8)}#${t.turn}: no tool results saved`); continue; }
    try {
      const f = await judgeFaithfulness({ question: t.user_message, reply: t.reply, evidence });
      if (!f) { console.log(`skip  ${t.conversation_id.slice(0, 8)}#${t.turn}: the judge declined`); continue; }
      results.push({ id: `${t.conversation_id.slice(0, 8)}#${t.turn}`, model: t.model, question: t.user_message, ...f });
      console.log(`${f.unsupported.length ? "MISS" : "ok  "}  ${t.conversation_id.slice(0, 8)}#${t.turn}  ${f.supported}/${f.claims} claims${f.unsupported.length ? ` - ${f.unsupported.map((u) => u.claim).join("; ").slice(0, 160)}` : ""}`);
    } catch (err) {
      console.log(`error ${t.conversation_id.slice(0, 8)}#${t.turn}: ${err.message}`);
    }
  }
  const claims = results.reduce((s, r) => s + r.claims, 0);
  const supported = results.reduce((s, r) => s + r.supported, 0);
  const summary = {
    judge: JUDGE_MODEL,
    answers: results.length,
    claims,
    faithfulness: claims ? Number((supported / claims).toFixed(3)) : null, // supported claims / all claims
    fullyFaithfulAnswers: results.filter((r) => !r.unsupported.length).length,
  };
  console.log(JSON.stringify(summary));
  const out = path.join(__dirname, "..", "logs", `eval-faithfulness-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), summary, results }, null, 2));
  console.log(`saved: ${path.relative(process.cwd(), out)}`);
  await db.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
