// Unit tests for hybrid/diversity.js - the variety rules of the recommendation lists:
// one book per series, at most 2 per author, no second edition of the same title.
const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_PER_AUTHOR, titleKey, seriesRepresentative, diversify } = require("../hybrid/diversity");

const book = (id, title, author) => ({ id, title, authors: [author] });
const ids = (list) => list.map((b) => b.id);

test("titleKey: editions of the same title get the same key", () => {
  assert.equal(titleKey("The Hobbit (Illustrated Edition)"), titleKey("the hobbit"));
  assert.equal(titleKey("Harry Potter, Book 1!"), titleKey("harry potter book 1"));
  assert.notEqual(titleKey("Dune"), titleKey("Dune Messiah"));
  assert.equal(titleKey(null), "");
});

test("diversify: at most 2 books per author (first author, any letter case)", () => {
  assert.equal(MAX_PER_AUTHOR, 2);
  const list = [book(1, "A", "King"), book(2, "B", "king "), book(3, "C", "KING"), book(4, "D", "Rowling")];
  assert.deepEqual(ids(diversify(list)), [1, 2, 4]);
});

test("diversify: one book per series, keeps the ranking order", () => {
  const seriesOf = new Map([[10, "hp"], [11, "hp"], [12, "lotr"]]);
  const list = [book(11, "HP 2", "a"), book(13, "Other", "b"), book(10, "HP 1", "c"), book(12, "LOTR", "d")];
  assert.deepEqual(ids(diversify(list, { seriesOf })), [11, 13, 12]);
});

test("diversify: skips other editions and titles the reader already has", () => {
  const list = [book(1, "Dune", "a"), book(2, "Dune (Deluxe Edition)", "b"), book(3, "Emma", "c"), book(4, "Ulysses", "d")];
  assert.deepEqual(ids(diversify(list, { skipTitles: ["EMMA"] })), [1, 4]);
});

test("diversify: stops at count", () => {
  const list = [1, 2, 3, 4, 5].map((i) => book(i, `T${i}`, `author${i}`));
  assert.deepEqual(ids(diversify(list, { count: 3 })), [1, 2, 3]);
  assert.equal(diversify([], { count: 3 }).length, 0);
});

test("seriesRepresentative: the first unread numbered book of the series", () => {
  const members = [
    { id: 1, number: 1, rated: true },
    { id: 2, number: 2, rated: true },
    { id: 3, number: 3, rated: true },
    { id: 9, number: null, rated: true }, // a box set / companion - never the representative
  ];
  const read = new Set([1]);
  assert.deepEqual(seriesRepresentative(members, (id) => !read.has(id)), { id: 2, number: 2, more: 1 });
});

test("seriesRepresentative: null when the whole series was read", () => {
  const members = [{ id: 1, number: 1, rated: true }, { id: 2, number: 2, rated: true }];
  assert.equal(seriesRepresentative(members, () => false), null);
  assert.equal(seriesRepresentative(undefined, () => true), null);
});
