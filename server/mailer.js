/**
 * Emails from BookBridge - to the PROJECT TEAM, to PUBLISHERS that confirm an author (or, when an
 * admin presses the button, to an unlisted publisher with the form to join the list), and to an
 * AUTHOR's own account email with the team's answer about their publisher (sent only when an admin
 * decides). Never to arbitrary addresses: a publisher email must be on the list (the publishers
 * table, managed on /admin/publishers), so nobody can use a form to send mail through the project account.
 * Sent through the project's Gmail with an App Password (Google's official way
 * for programs to use an account).
 *
 * .env:
 *   SMTP_USER     the project's Gmail address (the emails are sent from it)
 *   SMTP_PASS     the 16-letter Google App Password (no spaces) - never in git
 *   ADMIN_EMAILS  who receives them, comma-separated (also: who may open /admin pages)
 *   APP_URL       the website address for links in the email (default http://localhost:3000)
 * The publishers authors can choose are in the publishers TABLE (server/publishers.js, /admin/publishers) -
 * no longer PUBLISHER_EMAILS in .env (moved once with db/import-env-publishers.js).
 * Authors see ONLY the names (a dropdown); the server looks up the email by the publisher's id.
 *
 * Safe for the account:
 *   - at most MAX_PER_DAY emails a day (Gmail limits sending; we stay far below)
 *   - one attempt only: if Google refuses (e.g. a wrong password) we log it and
 *     do NOT retry - repeated failed logins are what makes Google suspicious
 *   - sending never blocks or breaks the user's action: the request is saved
 *     either way, and the admin page / script shows it
 *   - without SMTP_USER / SMTP_PASS nothing is sent and everything else works
 * Package: npm install nodemailer
 */

const MAX_PER_DAY = 20;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

let transporter = null;
let disabled = false;           // set after Google refuses the login - no more attempts until restart
let sentToday = { day: "", n: 0 };

function getTransporter() {
  if (transporter || disabled) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  let nodemailer;
  try { nodemailer = require("nodemailer"); } catch {
    console.warn("[mail] nodemailer is not installed (npm install nodemailer) - no emails.");
    disabled = true;
    return null;
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS.replace(/\s+/g, "") },
  });
  return transporter;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Send one email (all sending goes through here: one daily limit). Never throws - returns true if sent. */
async function sendMail(to, subject, text, html) {
  const t = getTransporter();
  if (!t || !to) return false;
  const day = new Date().toISOString().slice(0, 10);
  if (sentToday.day !== day) sentToday = { day, n: 0 };
  if (sentToday.n >= MAX_PER_DAY) {
    console.warn(`[mail] daily limit (${MAX_PER_DAY}) reached - not sent: ${subject}`);
    return false;
  }
  sentToday.n++;
  try {
    await t.sendMail({ from: `BookBridge <${process.env.SMTP_USER}>`, to, subject, text, html });
    return true;
  } catch (err) {
    console.warn(`[mail] not sent (${err.code || err.name}): ${err.message}`);
    if (err.code === "EAUTH" || err.responseCode === 535) {
      disabled = true; // wrong user / App Password: stop, do not keep trying to log in
      console.warn("[mail] Google refused the login - check SMTP_USER / SMTP_PASS in .env, then restart the server.");
    }
    return false;
  }
}

const sendToAdmins = (subject, text, html) => (ADMINS.length ? sendMail(ADMINS.join(", "), subject, text, html) : Promise.resolve(false));

// The publishers on the list = the active rows of the publishers table (server/publishers.js loads
// them at start and after every change): [{ key: "12", name, email }] - key = the row's id.
let dbPublishers = [];
const setDbPublishers = (list) => { dbPublishers = list.map((p) => ({ key: String(p.id), name: p.name, email: String(p.contact_email).toLowerCase() })); };
const allPublishers = () => dbPublishers;

/** May this address receive a publisher confirmation link? */
const isPublisherEmail = (email) => Boolean(email) && allPublishers().some((p) => p.email === String(email).trim().toLowerCase());
const publisherVerificationReady = () => allPublishers().length > 0;
/** The names for the authors' dropdown - never the emails */
const publisherChoices = () => allPublishers().map(({ key, name }) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
/** The publisher behind a dropdown choice, or null */
const publisherByKey = (key) => allPublishers().find((p) => p.key === String(key || "")) || null;

/** To the team: an author's publisher is not on the list yet (request #id on /admin/publishers) */
function sendUnlistedPublisher({ id, accountName, accountEmail, penName, books, publisherName, publisherContact, message }) {
  const link = `${APP_URL}/admin/publishers${id ? `?request=${id}` : ""}`;
  const text = `${accountName || "A reader"} (${accountEmail}) wants to be confirmed as an author, but their publisher is not on the list.\n` +
    `Pen name: ${penName}\nPublisher: ${publisherName}\n` + (publisherContact ? `Publisher contact (from the author): ${publisherContact}\n` : "") +
    `Books:\n${books}\n` + (message ? `Message: ${message}\n` : "") +
    `\nOpen the request and send the form to the publisher (or say no): ${link}\nThe publisher fills in its details; you check them and add it. The author gets an email with your answer.\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">Publisher not on the list</h2>
      <p style="margin:4px 0"><b>${esc(accountName || "A reader")}</b> (${esc(accountEmail)}) wants to be confirmed as <b>${esc(penName)}</b>.</p>
      <p style="margin:4px 0">Publisher: <b>${esc(publisherName)}</b>${publisherContact ? ` · contact given by the author: ${esc(publisherContact)}` : ""}</p>
      <p style="margin:12px 0 4px"><b>Books:</b></p><pre style="margin:0;font-family:inherit;white-space:pre-wrap">${esc(books)}</pre>
      ${message ? `<p style="margin:12px 0 4px"><b>Message:</b> ${esc(message)}</p>` : ""}
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open the request</a></p>
      <p style="font-size:13px;color:#6B5B4E">From there, send the form to the publisher: it fills in its company / association number, ISBN prefix, website and a document, and you check them. The author gets an email with your answer.</p>
    </div>`;
  return sendToAdmins(`BookBridge: author's publisher not on the list - ${publisherName}`, text, html);
}
/**
 * To a publisher that is NOT on the list yet: a form to fill in its details. Sent only when an
 * admin presses "Send the form to the publisher" (server/publishers.js) - never straight from a
 * user's request, so nobody can use the site to send mail to any address they like.
 */
function sendPublisherInvite({ to, token, publisherName, penName, books, expiresAt }) {
  const link = `${APP_URL}/publisher/apply?token=${encodeURIComponent(token)}`;
  const until = new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const text =
    `Hello${publisherName ? ` ${publisherName}` : ""},\n\n` +
    `An author on BookBridge, "${penName}", says they publish with you. Before authors can be confirmed by you, ` +
    `we add publishers to our list - please fill in your details (company number, ISBN prefix, website and a document):\n${link}\n\n` +
    `The link works until ${until}. Books the author listed:\n${books}\n\nIf you don't know this author, just ignore this email.\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">Join BookBridge’s list of publishers</h2>
      <p style="margin:4px 0">An author on BookBridge, <b>${esc(penName)}</b>, says they publish with ${publisherName ? `<b>${esc(publisherName)}</b>` : "you"}.</p>
      <p style="margin:4px 0">Before you can confirm your authors, we add publishers to our list. It takes two minutes: your company / association number, ISBN prefix, website and one document.</p>
      <p style="margin:12px 0 4px"><b>Books the author listed:</b></p>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#F7F1E8;padding:10px;border-radius:8px;margin:0">${esc(books)}</pre>
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Fill in your details</a></p>
      <p style="font-size:12px;color:#6B5B4E">The link works until ${esc(until)}. If you don't know this author, simply ignore this email.</p>
    </div>`;
  return sendMail(to, `BookBridge: ${penName} says they publish with you`, text, html);
}

/** To the team: a publisher filled in its details - check them */
function sendPublisherSubmitted({ id, publisherName, penName }) {
  const link = `${APP_URL}/admin/publishers?request=${id}`;
  const text = `${publisherName} sent its details (for the author ${penName}).\nCheck them and add it, or say no: ${link}\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">${esc(publisherName)} sent its details</h2>
      <p style="margin:4px 0">For the author <b>${esc(penName)}</b>. Check the registration number, ISBN prefix, website and document.</p>
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Check the details</a></p>
    </div>`;
  return sendToAdmins(`BookBridge: ${publisherName} sent its details`, text, html);
}

const mailReady = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) && !disabled;

/**
 * "Is <pen name> your author?" - to the publisher, with a one-time link.
 * The link opens a page with Confirm / Decline buttons (a click on the link
 * alone decides nothing - mail scanners open links automatically).
 */
function sendPublisherConfirmation({ to, token, penName, accountName, publisherName, books, expiresAt }) {
  const link = `${APP_URL}/publisher/confirm?token=${encodeURIComponent(token)}`;
  const until = new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const text =
    `Hello${publisherName ? ` ${publisherName}` : ""},\n\n` +
    `A BookBridge user (${accountName}) says they are your author, publishing as "${penName}".\n` +
    `Books they listed:\n${books}\n\n` +
    `Please confirm or decline here (the link works once, until ${until}):\n${link}\n\n` +
    `If you don't know this person, choose Decline or ignore this email.\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">Is ${esc(penName)} your author?</h2>
      <p style="margin:4px 0">A BookBridge user (<b>${esc(accountName)}</b>) says they publish with you as <b>${esc(penName)}</b>.</p>
      <p style="margin:12px 0 4px"><b>Books they listed:</b></p>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#F7F1E8;padding:10px;border-radius:8px;margin:0">${esc(books)}</pre>
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Confirm or decline</a></p>
      <p style="font-size:12px;color:#6B5B4E">The link works once, until ${esc(until)}. If you don't know this person, choose Decline or simply ignore this email.</p>
    </div>`;
  return sendMail(to, `BookBridge: please confirm your author ${penName}`, text, html);
}

/** To the AUTHOR (their own account email): the team added their publisher, or not. Sent only from the admin decision. */
function sendPublisherDecision({ to, approved, publisherName, note }) {
  const link = `${APP_URL}/account#author`;
  const subject = approved ? `BookBridge: ${publisherName} is now on the list` : "BookBridge: about your publisher";
  const text = approved
    ? `Hello,\n\nWe checked and added ${publisherName}. Choose it under "Become an author" on your Account page, and we'll email them to confirm you:\n${link}\n` + (note ? `\nNote from the team: ${note}\n` : "")
    : `Hello,\n\nWe could not add ${publisherName} to the list of publishers.\n` + (note ? `Note from the team: ${note}\n` : "") + `\nIf you think this is a mistake, reply to this email.\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">${approved ? `${esc(publisherName)} is now on the list` : "About your publisher"}</h2>
      ${approved
        ? `<p style="margin:4px 0">We checked and added <b>${esc(publisherName)}</b>. Choose it under “Become an author”, and we’ll email them to confirm you.</p>
           <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Continue</a></p>`
        : `<p style="margin:4px 0">We could not add <b>${esc(publisherName)}</b> to the list of publishers.</p>
           <p style="font-size:13px;color:#6B5B4E">If you think this is a mistake, reply to this email.</p>`}
      ${note ? `<p style="margin:12px 0 4px"><b>Note from the team:</b> ${esc(note)}</p>` : ""}
    </div>`;
  return sendMail(to, subject, text, html);
}

const isAdminEmail = (email) => Boolean(email) && ADMINS.includes(String(email).toLowerCase());

module.exports = {
  sendToAdmins, isAdminEmail, ADMINS,
  sendPublisherConfirmation, isPublisherEmail, publisherVerificationReady, mailReady,
  publisherChoices, publisherByKey, sendUnlistedPublisher, setDbPublishers, sendPublisherDecision,
  sendPublisherInvite, sendPublisherSubmitted,
};
