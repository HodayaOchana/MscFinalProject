"use client";

// On the sign-in page, after "forgot password" or "verify your email":
//   ?notice=reset | verified  - a short green note
//   ?email=...                - the email field is filled in
import { useSearchParams } from "next/navigation";

const NOTICES = {
  reset: "Your password was changed – sign in with the new one.",
  verified: "Your email is verified – please sign in.",
};

export function AuthNotice() {
  const text = NOTICES[useSearchParams().get("notice")];
  if (!text) return null;
  return <p role="status" className="m-0 rounded-xl border border-moss/40 bg-cream px-4 py-3 text-sm text-moss">{text}</p>;
}

export function EmailField() {
  const email = useSearchParams().get("email") || "";
  return <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" defaultValue={email} className="field font-normal" />;
}
