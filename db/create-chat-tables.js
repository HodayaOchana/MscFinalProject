/**
 * Chat history for "Ask BookBridge" (AI model 2, server/chat.js).
 *
 *   chat_conversations - one row per conversation
 *     title          the first message, shortened (shown in the history list)
 *     seen           every book a tool returned in the conversation, with what its
 *                    card shows: { "<bookId>": { why?, availabilityText? } } -
 *                    the grounding check allows ONLY these books in an answer
 *     turns          how many answers so far
 *
 *   chat_messages - the conversation exactly as sent to Claude (the API's message
 *                   list), in order: the user's text, Claude's answers, tool calls
 *                   and tool results. Only ever ADDED to (never edited), so a
 *                   conversation can go on days later where it stopped.
 *     seq            position in the list (0, 1, 2, ...)
 *     role           user | assistant | system (what changed about the reader: date, location shared)
 *     content        the message content (JSON)
 *
 *   chat_turns - one row per question + answer: what the history page shows, and
 *                the data for the evaluation (proposal section 7.1)
 *     user_message, reply      the reader's text and the answer ([[book:ID]] markers)
 *     books                    the books in the answer: [{ id, why?, availabilityText? }]
 *     tools                    the tool calls: [{ tool, input, books | error, ms }]
 *     mentioned, ungrounded    books in the answer / removed because no tool returned
 *                              them (the "zero hallucinated books" measure)
 *     model, latency_ms, input_tokens, output_tokens
 *     places                   the branches on the map under the answer (no reader location)
 *     lang                     the reply's language (always "en" now)
 *     about_book_id            the book the reader pressed "Ask about this book" on - a signal
 *                              for the recommendation engine (CF/signal-weights.js, chatAsk)
 *
 * Deleting a conversation deletes its messages and turns; deleting the account
 * deletes the conversations (ON DELETE CASCADE).
 *
 * Safe to run again. Does not touch any other table.
 *
 * Run:  node db/create-chat-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CREATE = `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'New chat',
  seen        jsonb NOT NULL DEFAULT '{}'::jsonb,
  turns       int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_conversations_user_idx ON chat_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  seq              int  NOT NULL,
  role             text NOT NULL,
  content          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS chat_turns (
  id               bigserial PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  turn             int  NOT NULL,
  user_message     text NOT NULL,
  reply            text NOT NULL,
  books            jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools            jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentioned        int  NOT NULL DEFAULT 0,
  ungrounded       int  NOT NULL DEFAULT 0,
  model            text,
  latency_ms       int,
  input_tokens     int,
  output_tokens    int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, turn)
);
ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS places jsonb;
ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS lang text;  -- the reply's language
ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS about_book_id int REFERENCES books(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_turns_about_book ON chat_turns (about_book_id) WHERE about_book_id IS NOT NULL;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_role_check CHECK (role IN ('user', 'assistant', 'system'));
`;

(async () => {
  await pool.query(CREATE);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM chat_conversations)::int AS conversations,
            (SELECT count(*) FROM chat_messages)::int AS messages,
            (SELECT count(*) FROM chat_turns)::int AS turns;`
  );
  console.log("Chat tables ready:", rows[0]);
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
