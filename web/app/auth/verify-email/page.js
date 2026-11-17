"use client";

// "Check your email" - a step of sign-up: right after the account is created, before the
// questionnaire. Also where a sign-in lands when Neon requires a verified email.
//   /auth/verify-email?email=...&next=...
// Signed in already: the code is sent from here (once a minute at most, also on refresh).
// Not signed in: Neon Auth sent it when the account was created / at the sign-in attempt.
// Verified here = the "Verify your email" pop-up never shows (components/VerifyEmailGate.js).
import { Suspense, useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthLayout } from "@/app/components/AuthForm";
import { safeNext } from "@/lib/next-path";
import { sendVerifyCode, startVerifyStep, verifyWithCode } from "../email-actions";

const SENT_KEY = "bb-verify-sent"; // when the code was last sent from this page (per email)
const RESEND_MS = 60_000;

function VerifyForm() {
  const params = useSearchParams();
  const router = useRouter();
  const email = params.get("email") || "";
  const next = safeNext(params.get("next") || "");
  const [state, verify, verifying] = useActionState(verifyWithCode, null);
  const [resent, resend, resending] = useActionState(sendVerifyCode, null);
  const [start, setStart] = useState(null); // what startVerifyStep found

  useEffect(() => {
    let cancelled = false;
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem(SENT_KEY) || "{}")[email] || null; } catch {}
    const fresh = last && Date.now() - last.at < RESEND_MS; // refresh / Back: don't send another code
    (fresh ? Promise.resolve({ signedIn: last.signedIn, sent: true, again: true }) : startVerifyStep()).then((r) => {
      if (cancelled) return;
      if (r.verified) return router.replace(next); // nothing to do
      if (r.sent && !r.again) {
        try { sessionStorage.setItem(SENT_KEY, JSON.stringify({ [email]: { at: Date.now(), signedIn: r.signedIn } })); } catch {}
      }
      setStart(r);
    }).catch(() => setStart({ signedIn: false }));
    return () => { cancelled = true; };
  }, [email, next, router]);

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Last step of sign-up</span>
        <h1 className="m-0 font-serif text-[40px] font-semibold tracking-tight">Check your email</h1>
        <p className="m-0 text-ink-soft">
          {start === null ? "Sending you a code…"
            : <>We sent a 6-digit code to <b>{email || "your email"}</b>. Enter it to verify your account (valid for 15 minutes).</>}
        </p>
        {start?.error && <p role="alert" className="m-0 text-sm text-rust-dark">{start.error}</p>}
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
      <p className="m-0 text-center text-sm text-muted">
        Wrong email? <Link href="/auth/sign-up">Sign up again</Link>
        {start?.signedIn
          ? <> · <Link href={next}>Skip for now</Link></>  /* the pop-up will ask again later */
          : <> · <Link href="/auth/sign-in">Sign in</Link></>}
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <AuthLayout><Suspense fallback={null}><VerifyForm /></Suspense></AuthLayout>;
}
