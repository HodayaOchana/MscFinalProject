// Input checks of the chatbot's tools (server/chat-tools.js). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers: { checkIds, withSuggested }, ToolError } = require("../server/chat-tools");

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
