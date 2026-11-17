// Unit tests for the checks of server/publishers.js (no database, no email):
// the Israeli check digit, the website domain, the warnings for the team and the document check.
const test = require("node:test");
const assert = require("node:assert/strict");
const { israeliCheckDigitOk, domainOf, warningsFor, checkPublisher } = require("../server/publishers");

class BadRequest extends Error {}
const pdf = (bytes) => ({ name: "doc.pdf", data: "data:application/pdf;base64," + Buffer.from(bytes).toString("base64") });
const form = (over = {}) => ({
  name: "Lantern Press", contactEmail: "info@lantern.co.il", website: "https://www.lantern.co.il",
  registrationNumber: "510000003", isbnPrefix: "978-965-123", document: pdf("%PDF-1.4 test"), ...over,
});

test("israeliCheckDigitOk: valid and invalid company numbers", () => {
  assert.equal(israeliCheckDigitOk("510000003"), true);
  assert.equal(israeliCheckDigitOk("510000007"), false);
  assert.equal(israeliCheckDigitOk("51000000"), false);  // 8 digits
  assert.equal(israeliCheckDigitOk("51000000a"), false);
});

test("domainOf: the bare site name", () => {
  assert.equal(domainOf("https://www.Lantern.co.il/about"), "lantern.co.il");
  assert.equal(domainOf("lantern.co.il"), "lantern.co.il");
  assert.equal(domainOf(""), null);
  assert.equal(domainOf("not a site"), null);
});

test("warningsFor: a clean Israeli publisher gets no warnings", () => {
  assert.deepEqual(warningsFor({ contactEmail: "info@lantern.co.il", website: "lantern.co.il", registrationNumber: "510000003", isbnPrefix: "978965123" }), []);
});

test("warningsFor: private mailbox, other domain, wrong check digit, foreign ISBN", () => {
  const base = { contactEmail: "info@lantern.co.il", website: "lantern.co.il", registrationNumber: "510000003", isbnPrefix: "978965123" };
  assert.match(warningsFor({ ...base, contactEmail: "lantern@gmail.com" }).join(" "), /private mailbox/);
  assert.match(warningsFor({ ...base, contactEmail: "info@other.com" }).join(" "), /not on the publisher's website/);
  assert.match(warningsFor({ ...base, registrationNumber: "510000007" }).join(" "), /check digit/);
  assert.match(warningsFor({ ...base, isbnPrefix: "9781234" }).join(" "), /ISBN prefix is not Israeli/);
  assert.equal(warningsFor({ ...base, contactEmail: "a@books.lantern.co.il" }).length, 0); // a sub-domain is the same site
});

test("warningsFor: the publisher's own mail server is not a private mailbox", () => {
  const base = { website: "lantern.co.il", registrationNumber: "510000003", isbnPrefix: "978965123" };
  // these start like free mailboxes ("mail.", "me.", "live.") but are on the publisher's domain
  for (const contactEmail of ["info@mail.lantern.co.il", "info@me.lantern.co.il", "info@live.lantern.co.il"]) {
    assert.deepEqual(warningsFor({ ...base, contactEmail }), [], contactEmail);
  }
  // a real free mailbox still gets the warning
  assert.match(warningsFor({ ...base, contactEmail: "lantern@mail.com" }).join(" "), /private mailbox/);
  assert.match(warningsFor({ ...base, contactEmail: "lantern@walla.co.il" }).join(" "), /private mailbox/);
});

test("checkPublisher: a good form passes and is cleaned", () => {
  const { values, warnings } = checkPublisher(form(), BadRequest);
  assert.equal(values.website, "lantern.co.il");
  assert.equal(values.isbnPrefix, "978965123");
  assert.equal(values.mime, "application/pdf");
  assert.deepEqual(warnings, []);
});

test("checkPublisher: wrong input is refused", () => {
  assert.throws(() => checkPublisher(form({ name: "" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ contactEmail: "no-at-sign" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ isbnPrefix: "123" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ document: undefined }), BadRequest), BadRequest);
});

test("checkPublisher: a file that only claims to be a PDF is refused", () => {
  assert.throws(() => checkPublisher(form({ document: pdf("MZ fake exe") }), BadRequest), /not really a PDF/);
});

test("checkPublisher: the address from the invitation link wins over the form", () => {
  const { values } = checkPublisher(form({ contactEmail: "someone@else.com" }), BadRequest, { contactEmail: "info@lantern.co.il" });
  assert.equal(values.contactEmail, "info@lantern.co.il");
});
