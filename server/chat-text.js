/**
 * Tidying the model's answers.
 *
 *   tidyTitles(text, titleOf)      the [[book:ID]] marker already shows the title, so a
 *                                  title the model wrote next to it is removed:
 *                                    "[[book:9]] (*1984*, Orwell)"   -> "[[book:9]] (Orwell)"
 *                                    "**1984** ([[book:9]], 328 pp)"  -> "[[book:9]] (328 pp)"
 *   takeFollowUps(text)            "<<followups: a | b>>" at the end -> { text, followUps: [a, b] }
 *   ground(text, seen)             keeps only [[book:ID]] markers of books the tools returned
 *                                  (seen: Map id -> info) - the "no hallucinated books" check
 *   suggestedIn(messages)          the ids of the books earlier answers suggested
 *   reasonsIn(reply)               why each listed book fits, from its bullet: id -> one short sentence
 *   OTHER_SCRIPT                   a message not in Latin letters (Hebrew, Arabic, Cyrillic...)
 *
 * Pure functions - tested in test/chat-text.test.js.
 */

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)" -> also "Harry Potter and the Sorcerer's Stone"
const namesOf = (title) => [...new Set([title, title.replace(/\s*\(.*\)\s*$/, "").replace(/:.*$/, "").trim()])]
  .filter((t) => t.length > 1).map(escapeRe).join("|");

function tidyTitles(text, titleOf) {
  let out = text;
  for (const [id, title] of titleOf) {
    if (!title) continue;
    const names = namesOf(title);
    const marker = `\\[\\[book:${id}\\]\\]`;
    // marker, then the title in brackets: "[[book:9]] (*1984*, ...)" / "[[book:9]] (*1984*)"
    out = out.replace(new RegExp(`(\\**${marker}\\**)\\s*\\(\\s*\\*{0,2}(?:${names})\\*{0,2}\\s*(,\\s*|\\))`, "g"),
      (all, m, after) => (after.startsWith(")") ? m : `${m} (`));
    // the title, then the marker in brackets: "**1984** ([[book:9]], 328 pp)" / "1984 ([[book:9]])"
    out = out.replace(new RegExp(`\\*{0,2}(?:${names})\\*{0,2}\\s*\\(\\s*(${marker})\\s*(,\\s*|\\))`, "g"),
      (all, m, after) => (after.startsWith(")") ? m : `${m} (`));
  }
  return out;
}

// "<<followups: a | b | c>>" at the end of an answer -> buttons under it
const FOLLOW_UPS = /\n?\s*<<followups:\s*([^>]*)>>\s*$/i;
function takeFollowUps(text) {
  const m = text.match(FOLLOW_UPS);
  if (!m) return { text, followUps: [] };
  const followUps = m[1].split("|").map((q) => q.trim()).filter((q) => q && q.length <= 80).slice(0, 3);
  return { text: text.replace(FOLLOW_UPS, "").trim(), followUps };
}

// [[book:123]] - how the model marks a catalog book in its answer
const BOOK_MARKER = /\[\[book:(\d+)\]\]/g;

// Markers -> checked against the books the tools returned in this conversation
function ground(text, seen) {
  const mentioned = [];
  const ungrounded = [];
  // a list line about a book no tool returned goes as a whole (not just its marker -
  // that would leave a broken "- – 212 pages…" line)
  const kept = text.split("\n").filter((line) => {
    const first = line.match(/^\s*(?:[-*•]|\d+[.)])\s+\**\[\[book:(\d+)\]\]/);
    if (first && !seen.has(Number(first[1]))) { ungrounded.push(Number(first[1])); return false; }
    return true;
  }).join("\n");
  const reply = kept.replace(BOOK_MARKER, (marker, id) => {
    const n = Number(id);
    if (seen.has(n)) { if (!mentioned.includes(n)) mentioned.push(n); return marker; }
    ungrounded.push(n);
    return "";
  });
  return {
    reply,
    books: mentioned.map((id) => ({ id, ...seen.get(id) })),
    grounding: { mentioned: mentioned.length, ungrounded: ungrounded.length },
  };
}

const suggestedIn = (messages) => new Set(messages
  .filter((m) => m.role === "assistant" && Array.isArray(m.content))
  .flatMap((m) => m.content.filter((b) => b.type === "text").flatMap((b) => [...b.text.matchAll(BOOK_MARKER)].map((x) => Number(x[1])))));

// "- [[book:9]] – 328 pages. A chilling look at surveillance." -> 9: "A chilling look at surveillance."
// The reason a book's card shows: what the answer itself said about it.
const MAX_REASON = 90;
function reasonsIn(reply) {
  const reasons = new Map();
  for (const m of reply.matchAll(/^\s*(?:[-*•]|\d+[.)])\s+\**\[\[book:(\d+)\]\]\**\s*[–—:-]?\s*(.*)$/gm)) {
    const text = m[2]
      .replace(/\[\[book:\d+\]\]/g, "the book").replace(/\*+/g, "")
      .replace(/^\(?\d[\d,]*\s*(?:pages|pp)\.?\)?[.,:;–—-]?\s*/i, "").trim();
    const sentence = (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0].trim();
    if (!sentence || reasons.has(Number(m[1]))) continue;
    reasons.set(Number(m[1]), sentence.length <= MAX_REASON ? sentence : `${sentence.slice(0, MAX_REASON - 1).replace(/\s+\S*$/, "")}…`);
  }
  return reasons;
}

// Hebrew, Arabic, Cyrillic, Greek, CJK... - a message the bot should still answer in English
const OTHER_SCRIPT = /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;

module.exports = { tidyTitles, takeFollowUps, ground, suggestedIn, reasonsIn, OTHER_SCRIPT, BOOK_MARKER };
