/**
 * Runs the real chat router (server/chat.js) on a free port, signed in as one reader,
 * for scripts that talk to the chatbot: server/eval-chat.js (automatic checks) and
 * server/eval-dialogues.js (dialogues for the human evaluation).
 *
 *   const chat = await startChat();      // the reader with the most ratings
 *   const r = await chat.post({ message, conversationId, location, bookId });
 *   await chat.remove(r.conversationId);
 *   await chat.close();
 */

const path = require("path");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const hybrid = require(path.join(__dirname, "..", "hybrid", "hybrid-recommender"));
const meRoutes = require("./me-routes");
const db = hybrid.pool;

const MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
const RATE_PAUSE_MS = 8000; // between messages - stays under the chat's rate limit (8 a minute)

async function startChat() {
  const { rows: [user] } = await db.query(
    `SELECT id, preferred_city FROM users WHERE id = (SELECT user_id FROM user_ratings GROUP BY 1 ORDER BY count(*) DESC LIMIT 1);`
  );
  // a saved note goes into every new conversation - a run stopped halfway once left one, and it
  // changed the answers of the next runs without anyone seeing. So: clean reader, or no run.
  const { rows: notes } = await db.query(`SELECT id, note FROM chat_reader_notes WHERE user_id = $1;`, [user.id]).catch(() => ({ rows: [] }));
  if (notes.length) throw new Error(`reader ${user.id} has saved notes, which would change the answers: ${JSON.stringify(notes)}. Delete them first.`);
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
  const recommendFor = meRoutes.makeRecommendFor({ db, hybrid, withTexts: (r) => ({ ...r, reasonText: r.reason }) });
  const app = express();
  app.use(express.json());
  app.use("/api/chat", require("./chat")({ db, requireUser: () => (req, res, next) => { req.user = user; next(); }, recommendFor, h: { wrap } }));
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/chat`;

  return {
    db,
    user,
    post: async (body) => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { error: `server error ${res.status}: ${text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 200)}` }; }
    },
    remove: (conversationId) => fetch(`${url}/${conversationId}`, { method: "DELETE" }),
    pause: () => new Promise((ok) => setTimeout(ok, RATE_PAUSE_MS)),
    close: async () => { server.close(); await db.end(); },
  };
}

module.exports = { startChat, MODEL };
