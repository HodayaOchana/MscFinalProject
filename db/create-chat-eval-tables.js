/**
 * The human evaluation of the chatbot (proposal, section 3.2: "a score of at least 4/5
 * on 50 sample dialogues, rated by 3 raters").
 *
 *   chat_eval_dialogues - the sample dialogues raters see (made by server/eval-dialogues.js)
 *     model          the model that answered (claude-sonnet-5-5 / claude-haiku-5-5)
 *     kind           what the dialogue tests: discover | refine | about-book | near-me | small-talk | edge
 *     turns          [{ message, reply, books: [{ id, title }] }] - what the reader wrote and the answers
 *
 *   chat_eval_ratings - one score per rater and dialogue
 *     score          1-5 (the rubric is on the rating page, web/app/evaluate)
 *     comment        optional - what was wrong or good
 *   A rater can change their score (one row per rater and dialogue). Raters are the
 *   emails in ADMIN_EMAILS and RATER_EMAILS (.env) - see server/chat-eval-routes.js.
 *
 * Safe to run again. Does not touch any other table.
 *
 * Run:  node db/create-chat-eval-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CREATE = `
CREATE TABLE IF NOT EXISTS chat_eval_dialogues (
  id          serial PRIMARY KEY,
  model       text  NOT NULL,
  kind        text  NOT NULL,
  turns       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_eval_ratings (
  dialogue_id  int  NOT NULL REFERENCES chat_eval_dialogues(id) ON DELETE CASCADE,
  rater_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment      text CHECK (length(comment) <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dialogue_id, rater_id)
);
`;

(async () => {
  await pool.query(CREATE);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM chat_eval_dialogues)::int AS dialogues, (SELECT count(*) FROM chat_eval_ratings)::int AS ratings;`
  );
  console.log("Chat evaluation tables ready:", rows[0]);
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
