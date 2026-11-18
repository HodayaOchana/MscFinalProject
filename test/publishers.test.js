// Unit tests for the checks of server/publishers.js (no database, no email):
// the Israeli check digit, the website domain, the proof of control (email domain / official page),
// the warnings for the team, and the optional fields.
const test = require("node:test");
const assert = require("node:assert/strict");
const { israeliCheckDigitOk, domainOf, warningsFor, checkPublisher, proofOf, pageUrlOf, newProofCode } = require("../server/publishers");

class BadRequest extends Error {}
const pdf = (bytes) => ({ name: "doc.pdf", data: "data:application/pdf;base64," + Buffer.from(bytes).toString("base64") });
const form = (over = {}) => ({
  name: "Lantern Press", contactEmail: "info@lantern.co.il", website: "https://www.lantern.co.il",
  registrationNumber: "510000003", isbnPrefix: "978-965-123", ...over,
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
  assert.equal(values.mime, null); // no document any more
  assert.deepEqual(warnings, []);
});

test("checkPublisher: wrong input is refused", () => {
  assert.throws(() => checkPublisher(form({ name: "" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ contactEmail: "no-at-sign" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ isbnPrefix: "123" }), BadRequest), BadRequest);
  assert.throws(() => checkPublisher(form({ website: "not a site" }), BadRequest), BadRequest);
});

test("checkPublisher: a website OR an official page is required - nothing else", () => {
  assert.throws(() => checkPublisher(form({ website: "", socialUrl: "" }), BadRequest), /website or its official page/);
  const onlyPage = checkPublisher(form({ website: "", socialUrl: "facebook.com/LanternPress" }), BadRequest).values;
  assert.equal(onlyPage.website, null);
  assert.equal(onlyPage.socialUrl, "https://facebook.com/LanternPress");
  const bare = checkPublisher({ name: "Lantern", contactEmail: "info@lantern.co.il", website: "lantern.co.il" }, BadRequest);
  assert.equal(bare.values.registrationNumber, null); // no company number, ISBN prefix or document needed
  assert.equal(bare.values.isbnPrefix, null);
  assert.equal(bare.values.file, null);
  assert.deepEqual(bare.warnings, []);
});

test("checkPublisher: an old-style document, if sent, is still checked", () => {
  assert.equal(checkPublisher(form({ document: pdf("%PDF-1.4 test") }), BadRequest).values.mime, "application/pdf");
  assert.throws(() => checkPublisher(form({ document: pdf("MZ fake exe") }), BadRequest), /not really a PDF/);
});

test("proofOf: the email on the website's domain is the proof", () => {
  assert.deepEqual(proofOf({ contactEmail: "info@lantern.co.il", website: "lantern.co.il" }), { domain: true, page: null });
  assert.deepEqual(proofOf({ contactEmail: "a@mail.lantern.co.il", website: "lantern.co.il" }), { domain: true, page: null });
  assert.equal(proofOf({ contactEmail: "lantern@gmail.com", website: "lantern.co.il" }).domain, false);
  assert.equal(proofOf({ contactEmail: "info@lantern-books.co.il", website: "lantern.co.il" }).domain, false); // a look-alike domain
  assert.deepEqual(proofOf({ contactEmail: "lantern@gmail.com", website: null, socialUrl: "https://facebook.com/x" }), { domain: false, page: "https://facebook.com/x" });
});

test("warningsFor: without domain proof the team is told to check the code on the page", () => {
  const w = warningsFor({ contactEmail: "lantern@gmail.com", website: null, socialUrl: "https://facebook.com/LanternPress" }, { proofCode: "BB-7K2Q9M" });
  assert.equal(w.length, 1);
  assert.match(w[0], /BB-7K2Q9M/);
  assert.match(w[0], /facebook\.com\/LanternPress/);
  const none = warningsFor({ contactEmail: "lantern@gmail.com", website: "lantern.co.il" });
  assert.match(none.join(" "), /private mailbox/);
  assert.match(none.join(" "), /No proof of control/);
});

test("pageUrlOf: a full link to an official page, or null", () => {
  assert.equal(pageUrlOf("instagram.com/lanternpress"), "https://instagram.com/lanternpress");
  assert.equal(pageUrlOf("https://www.facebook.com/LanternPress/"), "https://www.facebook.com/LanternPress/");
  assert.equal(pageUrlOf(""), null);
  assert.equal(pageUrlOf("not a link"), null);
  assert.equal(pageUrlOf("https://user:pass@evil.com"), null);
});

test("checkPublisher: the publisher's own form needs its official page", () => {
  assert.throws(() => checkPublisher(form({ socialUrl: "" }), BadRequest, { requirePage: true }), /official page/);
  assert.equal(checkPublisher(form({ socialUrl: "instagram.com/lantern" }), BadRequest, { requirePage: true }).values.socialUrl, "https://instagram.com/lantern");
  assert.equal(checkPublisher(form({ socialUrl: "" }), BadRequest).values.socialUrl, null); // the team's own form: not required
});

test("newProofCode: BB- and 6 easy-to-copy characters, different every time", () => {
  const codes = new Set(Array.from({ length: 50 }, newProofCode));
  for (const c of codes) assert.match(c, /^BB-[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(codes.size > 45);
});

test("checkPublisher: the address from the invitation link wins over the form", () => {
  const { values } = checkPublisher(form({ contactEmail: "someone@else.com" }), BadRequest, { contactEmail: "info@lantern.co.il" });
  assert.equal(values.contactEmail, "info@lantern.co.il");
});
