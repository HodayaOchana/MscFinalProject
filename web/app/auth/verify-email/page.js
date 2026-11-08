"use client";

// Verify the email with a 6-digit code - when the user is NOT signed in yet:
// right after sign-up, or when sign-in was refused because the email is not verified.
// (Signed-in users who are not verified get the pop-up instead: components/VerifyEmailGate.js.)
//   /auth/verify-email?email=...&next=...
import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/app/components/AuthForm";
import { sendVerifyCode, verifyWithCode } from "../email-actions";

function VerifyForm() {
  const params = useSearchParams();
  const email = params.get("email") || "";
  const next = params.get("next") || "";
  const [state, verify, verifying] = useActionState(verifyWithCode, null);
  const [resent, resend, resending] = useActionState(sendVerifyCode, null);

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-serif text-[44px] font-semibold">Check your email</h1>
        <p className="m-0 text-ink-soft">We sent a 6-digit code to <b>{email || "your email"}</b>. Enter it to verify your account (valid for 15 minutes).</p>
      </div>
      <form action={verify} className="flex flex-col gap-5">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">Code from the email
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="field font-normal tracking-[0.3em]" />
        </label>
        {state?.error && <p role="alert" className="m-0 text-sm text-rust-dark">{state.error}</p>}
        <button disabled={verifying || !email} className="btn btn-primary w-full">{verifying ? "Checking…" : "Verify my email"}</button>
      </form>
      <form action={resend} className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
        <input type="hidden" name="email" value={email} />
        {resent?.sent ? <span className="text-moss">A new code is on its way.</span> : <span>No email? Check the spam folder, or</span>}
        <button disabled={resending || !email} className="cursor-pointer bg-transparent p-0 text-rust underline">{resending ? "sending…" : "send a new code"}</button>
      </form>
      <p className="m-0 text-center text-sm text-muted">Wrong email? <Link href="/auth/sign-up">Sign up again</Link> · <Link href="/auth/sign-in">Sign in</Link></p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <AuthLayout><Suspense fallback={null}><VerifyForm /></Suspense></AuthLayout>;
}
