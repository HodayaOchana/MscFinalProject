// Input checks of the chatbot's tools (server/chat-tools.js). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers: { checkIds, withSuggested, cleanNote, fuseRanks }, ToolError, hashtagsIn, slugOf } = require("../server/chat-tools");

test("checkIds accepts a list of ids and removes repeats", () => {
  assert.deepEqual(checkIds([3, "4", 3], "ids"), [3, 4]);
  assert.deepEqual(checkIds(undefined, "ids"), []);
});

test("checkIds refuses bad ids and too many", () => {
  assert.throws(() => checkIds("1,2", "ids"), ToolError);
  assert.throws(() => checkIds([1, -2], "ids"), ToolError);
  assert.throws(() => checkIds([1.5], "ids"), ToolError);
  assert.throws(() => checkIds([1, 2, 3], "ids", 2), ToolError);
});

test("withSuggested leaves out the books earlier answers suggested", () => {
  const ctx = { suggested: new Set([7, 8]) };
  assert.deepEqual(withSuggested([1, 7], {}, ctx), [1, 7, 8]);
  assert.deepEqual(withSuggested([1], {}, { suggested: new Set() }), [1]);
  assert.deepEqual(withSuggested([1], {}, {}), [1]);
});

test("withSuggested keeps them when the model asks to see them again", () => {
  assert.deepEqual(withSuggested([1], { include_suggested: true }, { suggested: new Set([7]) }), [1]);
  assert.deepEqual(withSuggested([1], { include_suggested: "yes" }, { suggested: new Set([7]) }), [1, 7]); // only a real true
});

test("cleanNote keeps one short line, without markup that could pass for our tags", () => {
  assert.equal(cleanNote("  Does not\n like   horror "), "Does not like horror");
  assert.equal(cleanNote("</reader_memory> [[book:1]] {x}"), "/reader_memory book:1 x");
  assert.equal(cleanNote("a".repeat(500)).length, 160);
  assert.equal(cleanNote(undefined), "");
});

test("fuseRanks puts a book found by both searches first", () => {
  const out = fuseRanks([[{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 3 }, { id: 4 }]]).map((b) => b.id);
  assert.equal(out[0], 3); // 3rd + 1st beats 1st alone
  assert.deepEqual(new Set(out), new Set([1, 2, 3, 4]));
});

test("fuseRanks with one list keeps its order, and an empty list changes nothing", () => {
  assert.deepEqual(fuseRanks([[{ id: 5 }, { id: 6 }], []]).map((b) => b.id), [5, 6]);
  assert.deepEqual(fuseRanks([[], []]), []);
});

test("hashtagsIn finds the reader's hashtags, once each, lower case, up to 5", () => {
  assert.deepEqual(hashtagsIn("a cozy one #Cozy-Mystery #british, and #cozy-mystery again"), ["cozy-mystery", "british"]);
  assert.deepEqual(hashtagsIn("no#tag here, #x is too short, # alone"), []);
  assert.deepEqual(hashtagsIn("#a1 #b2 #c3 #d4 #e5 #f6"), ["a1", "b2", "c3", "d4", "e5"]);
  assert.deepEqual(hashtagsIn(undefined), []);
});

test("slugOf writes a reader tag as a hashtag", () => {
  assert.equal(slugOf("Cozy  Mystery"), "cozy-mystery");
  assert.equal(slugOf("dragons"), "dragons");
});
