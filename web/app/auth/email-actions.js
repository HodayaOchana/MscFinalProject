"use server";

// Email codes from Neon Auth (6 digits, valid 15 minutes): "forgot password" and "verify your email".
// Neon Auth sends the emails itself (from auth@mail.myneon.app) - NOT the project's Gmail,
// so the project's own mail limit (server/mailer.js) is not used here.
// Needs, in the Neon Console -> Auth settings: Sign-up with Email ON, email verification
// with "Verification code".
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { safeNext } from "@/lib/next-path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => String(v || "").trim();
const codeOf = (v) => clean(v).replace(/\s+/g, "");
const why = (error, fallback) => (error?.message && !/internal/i.test(error.message) ? error.message : fallback);

// ---------- forgot password ----------
// Step 1: send a code. The answer is the SAME whether or not the email has an account,
// so nobody can use this page to find out who is registered.
export async function sendResetCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  if (!EMAIL_RE.test(email)) return { step: "email", error: "Please enter a valid email address." };
  const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "forget-password" });
  if (error) console.warn("[auth] reset code:", error.message || error); // not shown - see above
  return { step: "code", email };
}

// Step 2: the code + a new password
export async function resetWithCode(_prev, formData) {
  const email = clean(formData.get("email")).toLowerCase();
  const otp = codeOf(formData.get("code"));
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { step: "code", email, error: "The new password needs at least 8 characters." };
  if (password !== String(formData.get("password2") || "")) return { step: "code", email, error: "The two passwords are not the same." };
  const { error } = await auth.emailOtp.resetPassword({ email, otp, password });
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
  redirect(`/auth/sign-in?notice=verified&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
}
