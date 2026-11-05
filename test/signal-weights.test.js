// What a reader's actions count for the ALS model (CF/signal-weights.js). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { SIGNALS, searchSignals, chatAskSignal } = require("../CF/signal-weights");

test("a search with an opened result is a strong signal, more when repeated (max 5)", () => {
  assert.deepEqual(searchSignals({ clicked_book_id: "12", search_count: 1 }), [{ bookId: 12, value: SIGNALS.searchClick }]);
  assert.equal(searchSignals({ clicked_book_id: 12, search_count: 3 })[0].value, 4.5);
  assert.equal(searchSignals({ clicked_book_id: 12, search_count: 20 })[0].value, SIGNALS.searchClickMax);
});

test("a search with nothing opened counts a little for its top 3 results", () => {
  const out = searchSignals({ clicked_book_id: null, search_count: 1, result_book_ids: [1, 2, 3, 4] });
  assert.deepEqual(out.map((s) => s.bookId), [1, 2, 3]);
  assert.ok(out.every((s) => s.value === SIGNALS.searchSeen));
  assert.deepEqual(searchSignals({ clicked_book_id: null, search_count: 1 }), []);
});

test("asking the chatbot about a book: between the TBR and an opened search result, max 4", () => {
  assert.equal(chatAskSignal(1), SIGNALS.chatAsk);
  assert.ok(chatAskSignal(1) > SIGNALS.tbr && chatAskSignal(1) < SIGNALS.searchClick);
  assert.equal(chatAskSignal(2), 3.5);
  assert.equal(chatAskSignal(10), SIGNALS.chatAskMax);
  assert.equal(chatAskSignal(0), SIGNALS.chatAsk);
});
