/**
 * The human evaluation of the chatbot - raters score the sample dialogues 1-5
 * (proposal, section 3.2: "at least 4/5 on 50 dialogues, 3 raters").
 * The dialogues are made by server/eval-dialogues.js; the page is web/app/evaluate.
 *
 * Raters: the emails in ADMIN_EMAILS and RATER_EMAILS (.env, comma separated); anyone
 * else gets 403. Raters do not see which model answered (a blind rating) - only the
 * summary groups by model.
 *
 *   GET /api/chat-eval/me                     { rater: true }
 *   GET /api/chat-eval/dialogues              [{ id, kind, turns, score, comment }] - with MY score
 *   PUT /api/chat-eval/dialogues/:id/rating   { score: 1-5, comment? } - a rater can change it
 *   GET /api/chat-eval/summary                per model: average, how many dialogues reached 3
 *                                             raters, the average per kind, agreement between raters
 *   GET /api/chat-eval/feedback?days=30       real readers: 👍 / 👎 on answers (reasons, latest misses),
 *                                             speed (first words / whole answer), why books were hidden
 */

const express = require("express");
const { isAdminEmail } = require("./mailer");

const RATERS = String(process.env.RATER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const isRater = (email) => isAdminEmail(email) || (Boolean(email) && RATERS.includes(String(email).toLowerCase()));

const GOAL = { score: 4, raters: 3, dialogues: 50 }; // the proposal's success measure

module.exports = function chatEvalRoutes({ db, requireUser, h }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  const emailOf = async (req) =>
    (await db.query(`SELECT email FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId])).rows[0]?.email || null;

  router.use(async (req, res, next) => {
    try {
      const email = await emailOf(req);
      if (!isRater(email)) return res.status(403).json({ error: "this page is for the evaluation raters only", signedInAs: email });
      next();
    } catch (err) { next(err); }
  });

  router.get("/me", (req, res) => res.json({ rater: true }));

  router.get("/dialogues", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.id, d.kind, d.turns, r.score, r.comment
       FROM chat_eval_dialogues d
       LEFT JOIN chat_eval_ratings r ON r.dialogue_id = d.id AND r.rater_id = $1
       ORDER BY d.id;`,
      [req.user.id]
    );
    res.json(rows);
  }));

  router.put("/dialogues/:id/rating", wrap(async (req, res) => {
    const id = checkId(req.params.id);
    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new BadRequest("score must be 1-5");
    const comment = String(req.body?.comment || "").trim().slice(0, 1000) || null;
    const { rowCount } = await db.query(
      `INSERT INTO chat_eval_ratings (dialogue_id, rater_id, score, comment)
       SELECT id, $2, $3, $4 FROM chat_eval_dialogues WHERE id = $1
       ON CONFLICT (dialogue_id, rater_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, created_at = now();`,
      [id, req.user.id, score, comment]
    );
    if (!rowCount) return res.status(404).json({ error: "no such dialogue" });
    res.json({ id, score, comment });
  }));

  router.get("/summary", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.id, d.model, d.kind, array_remove(array_agg(r.score), NULL) AS scores
       FROM chat_eval_dialogues d LEFT JOIN chat_eval_ratings r ON r.dialogue_id = d.id
       GROUP BY d.id ORDER BY d.id;`
    );
    const { rows: [{ raters }] } = await db.query(`SELECT count(DISTINCT rater_id)::int AS raters FROM chat_eval_ratings;`);
    const avg = (xs) => (xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null);

    const models = [...new Set(rows.map((d) => d.model))].map((model) => {
      const ds = rows.filter((d) => d.model === model);
      const rated = ds.filter((d) => d.scores.length);
      const full = ds.filter((d) => d.scores.length >= GOAL.raters);
      const means = rated.map((d) => avg(d.scores));
      return {
        model,
        dialogues: ds.length,
        ratings: ds.reduce((n, d) => n + d.scores.length, 0),
        fullyRated: full.length, // reached GOAL.raters raters
        average: avg(ds.flatMap((d) => d.scores)),
        atLeastGoal: means.filter((m) => m >= GOAL.score).length, // dialogues whose average is 4 or more
        // raters agree when their scores are at most 1 apart
        agreement: full.length ? Number((full.filter((d) => Math.max(...d.scores) - Math.min(...d.scores) <= 1).length / full.length).toFixed(2)) : null,
        byKind: Object.fromEntries([...new Set(ds.map((d) => d.kind))].map((k) => [k, avg(ds.filter((d) => d.kind === k).flatMap((d) => d.scores))])),
        lowest: rated.map((d) => ({ id: d.id, kind: d.kind, average: avg(d.scores) })).sort((a, b) => a.average - b.average).slice(0, 5),
      };
    });
    res.json({ goal: GOAL, raters, models });
  }));

  // ---------- feedback from real readers: 👍 / 👎 on chat answers, and why readers hid books ----------
  // For the pilot: which answers miss and why (web/app/admin/feedback). Questions and answers, no names or emails.
  router.get("/feedback", wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const quiet = (p) => p.catch((err) => (err.code === "42P01" || err.code === "42703" ? { rows: [] } : Promise.reject(err))); // migration not run yet
    const [{ rows: chat }, { rows: chatWhy }, { rows: misses }, { rows: hidden }, { rows: speed }] = await Promise.all([
      quiet(db.query(
        `SELECT count(*)::int AS answers,
                count(*) FILTER (WHERE feedback = 1)::int AS up,
                count(*) FILTER (WHERE feedback = -1)::int AS down
         FROM chat_turns WHERE created_at > now() - make_interval(days => $1);`, [days])),
      quiet(db.query(
        `SELECT coalesce(feedback_reason, 'no_reason') AS reason, count(*)::int AS n
         FROM chat_turns WHERE feedback = -1 AND created_at > now() - make_interval(days => $1)
         GROUP BY 1 ORDER BY 2 DESC;`, [days])),
      quiet(db.query(
        `SELECT t.conversation_id AS "conversationId", t.turn, t.user_message AS question, left(t.reply, 400) AS reply,
                t.feedback_reason AS reason, t.model, t.latency_ms AS ms, t.feedback_at AS at
         FROM chat_turns t WHERE t.feedback = -1 AND t.created_at > now() - make_interval(days => $1)
         ORDER BY t.feedback_at DESC LIMIT 30;`, [days])),
      quiet(db.query(
        `SELECT coalesce(reason, 'no_reason') AS reason, count(*)::int AS n
         FROM user_events WHERE type = 'dismissed' AND created_at > now() - make_interval(days => $1)
         GROUP BY 1 ORDER BY 2 DESC;`, [days])),
      // how fast it feels: the first words (first_text_ms) and the whole answer, median and p90
      quiet(db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_text_ms)::int AS "firstMedian",
                percentile_cont(0.9) WITHIN GROUP (ORDER BY first_text_ms)::int AS "firstP90",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS "totalMedian",
                percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms)::int AS "totalP90"
         FROM chat_turns WHERE created_at > now() - make_interval(days => $1);`, [days])),
    ]);
    res.json({ days, chat: chat[0] || { answers: 0, up: 0, down: 0 }, chatReasons: chatWhy, misses, notForMe: hidden, speed: speed[0] || null });
  }));

  return router;
};
