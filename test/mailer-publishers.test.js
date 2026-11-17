// Unit tests for the publishers list inside server/mailer.js: only an address that is
// on the list may get a publisher confirmation link, and the dropdown never shows emails.
// No email is sent here.
const test = require("node:test");
const assert = require("node:assert/strict");
const mailer = require("../server/mailer");

test("empty list: nobody is a publisher", () => {
  mailer.setDbPublishers([]);
  assert.equal(mailer.isPublisherEmail("info@lantern.co.il"), false);
  assert.equal(mailer.publisherVerificationReady(), false);
});

test("isPublisherEmail: only the listed address (any letter case / spaces)", () => {
  mailer.setDbPublishers([{ id: 1, name: "Lantern", contact_email: "Info@Lantern.co.il" }]);
  assert.equal(mailer.isPublisherEmail(" info@lantern.co.il "), true);
  assert.equal(mailer.isPublisherEmail("other@lantern.co.il"), false);
  assert.equal(mailer.isPublisherEmail(""), false);
  assert.equal(mailer.publisherVerificationReady(), true);
});

test("publisherChoices: names only, sorted, never the emails", () => {
  mailer.setDbPublishers([
    { id: 2, name: "Zmora", contact_email: "z@zmora.co.il" },
    { id: 1, name: "Am Oved", contact_email: "a@amoved.co.il" },
  ]);
  const choices = mailer.publisherChoices();
  assert.deepEqual(choices, [{ key: "1", name: "Am Oved" }, { key: "2", name: "Zmora" }]);
  assert.ok(!JSON.stringify(choices).includes("@"));
});

test("publisherByKey: finds by id (text or number), null otherwise", () => {
  mailer.setDbPublishers([{ id: 7, name: "Kinneret", contact_email: "k@kinneret.co.il" }]);
  assert.equal(mailer.publisherByKey("7").email, "k@kinneret.co.il");
  assert.equal(mailer.publisherByKey(7).name, "Kinneret");
  assert.equal(mailer.publisherByKey("8"), null);
  assert.equal(mailer.publisherByKey(undefined), null);
});
