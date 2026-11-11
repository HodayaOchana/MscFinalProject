// When was a verification code last sent to an email - shared by the pop-up, the Account page
// and the "Check your email" page (this browser tab, so it survives a refresh).
// A code is valid 15 minutes and a new one cancels the old one, so:
//   sent < 15 min ago -> show the code box again, don't send another
//   "Send a new code" -> only after 60 s
const KEY = "bb-verify-sent";
export const CODE_VALID_MS = 15 * 60 * 1000;
export const RESEND_MS = 60 * 1000;

function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } }

/** ms since a code was sent to this email, or null (never / expired) */
export function codeAge(email) {
  const v = read()[String(email || "").toLowerCase()];
  const at = typeof v === "number" ? v : v?.at;
  if (!at) return null;
  const age = Date.now() - at;
  return age < CODE_VALID_MS ? age : null;
}

export function markCodeSent(email, extra = {}) {
  try {
    const all = read();
    all[String(email || "").toLowerCase()] = { at: Date.now(), ...extra };
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** seconds until "Send a new code" may be used */
export const resendWait = (email) => {
  const age = codeAge(email);
  return age === null ? 0 : Math.max(0, Math.ceil((RESEND_MS - age) / 1000));
};
