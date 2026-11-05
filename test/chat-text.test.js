// The chatbot's answer tidying (server/chat-text.js). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { tidyTitles, takeFollowUps, ground, suggestedIn, reasonsIn, OTHER_SCRIPT } = require("../server/chat-text");

test("ground keeps books the tools returned and drops the others", () => {
  const seen = new Map([[1, { why: "fits" }], [3, {}]]);
  const r = ground("Try these:\n- [[book:1]] – 300 pages.\n- [[book:2]] – made up.\nOr [[book:3]], not [[book:4]].", seen);
  assert.equal(r.reply, "Try these:\n- [[book:1]] – 300 pages.\nOr [[book:3]], not .");
  assert.deepEqual(r.books, [{ id: 1, why: "fits" }, { id: 3 }]);
  assert.deepEqual(r.grounding, { mentioned: 2, ungrounded: 2 });
});

test("ground counts a book once even when it is mentioned twice", () => {
  const r = ground("[[book:5]] is great. Did I say [[book:5]]?", new Map([[5, {}]]));
  assert.deepEqual(r.grounding, { mentioned: 1, ungrounded: 0 });
});

test("ground drops a whole bullet that starts with an ungrounded book (also numbered and bold)", () => {
  const r = ground("1. **[[book:9]]** – x\n2. [[book:8]] – y", new Map([[8, {}]]));
  assert.equal(r.reply, "2. [[book:8]] – y");
});

test("takeFollowUps reads the last line and keeps at most 3 short questions", () => {
  const r = takeFollowUps("Here you go.\n<<followups: Shorter? | Any funnier ones? | | Near me? | One more>>");
  assert.equal(r.text, "Here you go.");
  assert.deepEqual(r.followUps, ["Shorter?", "Any funnier ones?", "Near me?"]);
});

test("takeFollowUps leaves an answer without the line as it is", () => {
  assert.deepEqual(takeFollowUps("Just text"), { text: "Just text", followUps: [] });
  assert.equal(takeFollowUps(`x\n<<followups: ${"a".repeat(81)}>>`).followUps.length, 0);
});

test("tidyTitles removes a title written next to its marker", () => {
  const titles = new Map([[9, "1984"], [7, "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)"]]);
  assert.equal(tidyTitles("[[book:9]] (*1984*, Orwell)", titles), "[[book:9]] (Orwell)");
  assert.equal(tidyTitles("**1984** ([[book:9]], 328 pp)", titles), "[[book:9]] (328 pp)");
  assert.equal(tidyTitles("[[book:7]] (*Harry Potter and the Sorcerer's Stone*)", titles), "[[book:7]]");
  assert.equal(tidyTitles("[[book:9]] (328 pages)", titles), "[[book:9]] (328 pages)");
});

test("suggestedIn collects the books of earlier answers only", () => {
  const messages = [
    { role: "user", content: "like [[book:1]]" },
    { role: "assistant", content: [{ type: "thinking", thinking: "[[book:2]]" }, { type: "text", text: "- [[book:3]]\n- [[book:4]]" }] },
    { role: "assistant", content: [{ type: "tool_use", input: { id: 5 } }, { type: "text", text: "and [[book:3]]" }] },
  ];
  assert.deepEqual([...suggestedIn(messages)], [3, 4]);
});

test("OTHER_SCRIPT finds non-Latin messages", () => {
  assert.ok(OTHER_SCRIPT.test("ספר מתח קצר"));
  assert.ok(OTHER_SCRIPT.test("книга"));
  assert.ok(OTHER_SCRIPT.test("كتاب"));
  assert.ok(!OTHER_SCRIPT.test("A café book, naïve and fun – 300 pages!"));
});

test("reasonsIn takes what the answer said about each listed book", () => {
  const r = reasonsIn("Here you go:\n- [[book:1]] – 273 pages. A kidnapped girl fights back. It is tense.\n1. **[[book:2]]** (180 pages). Quiet and strange!\nAlso [[book:3]] is nice.\n- [[book:4]]");
  assert.equal(r.get(1), "A kidnapped girl fights back.");
  assert.equal(r.get(2), "Quiet and strange!");
  assert.equal(r.has(3), false); // not a list line
  assert.equal(r.has(4), false); // nothing said about it
});

test("reasonsIn keeps a reason short", () => {
  const r = reasonsIn(`- [[book:1]] – ${"word ".repeat(40)}`);
  assert.ok(r.get(1).length <= 90 && r.get(1).endsWith("…"));
});
