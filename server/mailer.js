/**
 * Emails from BookBridge - to the PROJECT TEAM, and to PUBLISHERS that confirm an author.
 * Never to arbitrary addresses: a publisher email must be on PUBLISHER_EMAILS
 * (so nobody can use the form to send mail through the project account).
 * Sent through the project's Gmail with an App Password (Google's official way
 * for programs to use an account).
 *
 * .env:
 *   SMTP_USER     the project's Gmail address (the emails are sent from it)
 *   SMTP_PASS     the 16-letter Google App Password (no spaces) - never in git
 *   ADMIN_EMAILS  who receives them, comma-separated (also: who may open /admin pages)
 *   APP_URL       the website address for links in the email (default http://localhost:3000)
 *   PUBLISHER_EMAILS  publisher contact emails that may receive "confirm your author" links,
 *                 comma-separated. In the demo: your own email, playing the publisher.
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
const PUBLISHERS = (process.env.PUBLISHER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

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

/** May this address receive a publisher confirmation link? */
const isPublisherEmail = (email) => Boolean(email) && PUBLISHERS.includes(String(email).trim().toLowerCase());
const publisherVerificationReady = () => PUBLISHERS.length > 0;
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

const isAdminEmail = (email) => Boolean(email) && ADMINS.includes(String(email).toLowerCase());

module.exports = {
  sendToAdmins, isAdminEmail, ADMINS,
  sendPublisherConfirmation, isPublisherEmail, publisherVerificationReady, mailReady,
};
