"use server";

// Email codes from Neon Auth (6 digits, valid 15 minutes): "forgot password" and "verify your email".
// Neon Auth sends the emails itself (from auth@mail.myneon.app) - NOT the project's Gmail,
// so the project's own mail limit (server/mailer.js) is not used here.
// Needs, in the Neon Console -> Auth settings: Sign-up with Email ON, email verification
// with "Verification code".
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { safeNext } from "@/lib/next-path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => String(v || "").trim();
const codeOf = (v) => clean(v).replace(/\s+/g, "");
const why = (error, fallback) => (error?.message && !/internal/i.test(error.message) ? error.message : fallback);

// ---------- forgot password ----------
// Step 1: send a code - only if the email has an account (else the page says so;
// sign-up reveals that anyway with "already has an account").
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export async function sendResetCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  if (!EMAIL_RE.test(email)) return { step: "email", error: "Please enter a valid email address." };
  const check = await fetch(`${API_URL}/api/accounts/exists`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }), cache: "no-store",
  }).then((r) => r.json()).catch(() => null); // the API is down: carry on as before
  if (check && check.exists === false) return { step: "email", error: "There is no BookBridge account with this email. Check the address, or sign up.", notFound: true };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "forget-password" });
  if (error) console.warn("[auth] reset code:", error.message || error); // not shown - see above
  return { step: "code", email };
}

// The Neon Auth package sends "reset password with a code" to a wrong address (email-otp/passcode
// -> 404 Not Found), so this one call goes straight to Neon Auth's own endpoint (Better Auth's
// /email-otp/reset-password), from the server, with this site as its origin.
async function resetPasswordWithCode({ email, otp, password }) {
  const h = await headers();
  const origin = h.get("origin") || `${h.get("x-forwarded-proto") || "http"}://${h.get("host")}`;
  try {
    const res = await fetch(`${process.env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/email-otp/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, otp, password }),
      cache: "no-store",
    });
    if (res.ok) return { error: null };
    const body = await res.json().catch(() => ({}));
    console.warn("[auth] reset password:", res.status, body.code || body.message || "");
    return { error: { message: body.code === "INVALID_OTP" || body.code === "OTP_EXPIRED" || res.status === 400 ? "" : body.message, code: body.code } };
  } catch (err) {
    console.warn("[auth] reset password:", err.message);
    return { error: { message: "Could not reach the sign-in service – try again in a minute." } };
  }
}

// Step 2: the code + a new password
export async function resetWithCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  const otp = codeOf(formData.get("code"));
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { step: "code", email, error: "The new password needs at least 8 characters." };
  if (password !== String(formData.get("password2") || "")) return { step: "code", email, error: "The two passwords are not the same." };
  const { error } = await resetPasswordWithCode({ email, otp, password });
  if (error) return { step: "code", email, error: why(error, "The code is wrong or has expired – ask for a new one.") };
  redirect(`/auth/sign-in?notice=reset&email=${encodeURIComponent(email)}`);
}

// ---------- verify the email ----------
// Signed in (the pop-up on every page): the code goes to the account's OWN email only.
async function sessionEmail() {
  const { data } = await auth.getSession();
  return data?.user?.email || null;
}

export async function sendMyVerifyCode() {
  const email = await sessionEmail();
  if (!email) return { error: "Please sign in again." };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
  return error ? { error: why(error, "Could not send the code – try again in a minute.") } : { sent: true };
}

export async function verifyMyEmail(otp) {
  const email = await sessionEmail();
  if (!email) return { error: "Please sign in again." };
  const { error } = await auth.emailOtp.verifyEmail({ email, otp: codeOf(otp) });
  return error ? { error: why(error, "The code is wrong or has expired.") } : { verified: true };
}

// The "Check your email" step right after sign-up (/auth/verify-email):
//   signed in already (verification optional in Neon) -> we send the code now (to the account's own email)
//   already verified                                 -> nothing to do, go on
//   not signed in (verification required in Neon)    -> Neon Auth already sent the code at sign-up
export async function startVerifyStep() {
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user) return { signedIn: false };
  if (user.emailVerified) return { signedIn: true, verified: true };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email: user.email, type: "email-verification" });
  if (error) console.warn("[auth] verify code:", error.message || error);
  return { signedIn: true, email: user.email, sent: !error, ...(error ? { error: why(error, "Could not send the code – use \"send a new code\" in a minute.") } : {}) };
}

// Not signed in (right after sign-up, or a sign-in refused because the email is not verified yet)
export async function sendVerifyCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
  if (error) console.warn("[auth] verify code:", error.message || error);
  return { sent: true }; // the same answer either way
}

export async function verifyWithCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  const { data, error } = await auth.emailOtp.verifyEmail({ email, otp: codeOf(formData.get("code")) });
  if (error) return { error: why(error, "The code is wrong or has expired – ask for a new one.") };
  const next = safeNext(String(formData.get("next") || ""));
  if (data?.token || data?.session) redirect(next); // Neon Auth signed them in
  const { data: now } = await auth.getSession();
  if (now?.user) redirect(next); // signed in already (right after sign-up) - straight on
  redirect(`/auth/sign-in?notice=verified&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
}

// ---------- the Account page: verify the account's email (also right after changing it) ----------
// The page passes the email it shows (from GET /api/me, read fresh from the database).
export async function sendCodeTo(email) {
  const e = clean(email).toLowerCase();
  if (!EMAIL_RE.test(e)) return { error: "Please enter a valid email address." };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email: e, type: "email-verification" });
  return error ? { error: why(error, "Could not send the code – try again in a minute.") } : { sent: true };
}

export async function verifyCodeFor(email, otp) {
  const e = clean(email).toLowerCase();
  const { error } = await auth.emailOtp.verifyEmail({ email: e, otp: codeOf(otp) });
  return error ? { error: why(error, "The code is wrong or has expired.") } : { verified: true };
}
