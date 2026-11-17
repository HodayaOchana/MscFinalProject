"use client";

// Forgot password: 1) the email -> Neon Auth sends a 6-digit code (15 minutes)
//                  2) the code + a new password -> back to sign-in
import { useActionState } from "react";
import Link from "next/link";
import { AuthLayout } from "@/app/components/AuthForm";
import { sendResetCode, resetWithCode } from "../email-actions";

export default function ForgotPasswordPage() {
  const [sent, send, sending] = useActionState(sendResetCode, null);
  const [reset, doReset, resetting] = useActionState(resetWithCode, null);
  const email = reset?.email || sent?.email;
  const step = email ? "code" : "email";

  return (
    <AuthLayout>
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-serif text-[40px] font-semibold tracking-tight">Forgot password</h1>
          <p className="m-0 text-ink-soft">
            {step === "email"
              ? "Enter your email and we will send you a code to choose a new password."
              : <>A 6-digit code is on its way to <b>{email}</b>. It is valid for 15 minutes.</>}
          </p>
        </div>

        {step === "email" ? (
          <form action={send} className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Email
              <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="field font-normal" />
            </label>
            {sent?.error && (
              <p role="alert" className="m-0 text-sm text-rust-dark">
                {sent.error}{sent.notFound && <> <Link href="/auth/sign-up" className="font-bold">Create an account</Link></>}
              </p>
            )}
            <button disabled={sending} className="btn btn-primary w-full">{sending ? "Sending…" : "Send me a code"}</button>
          </form>
        ) : (
          <form action={doReset} className="flex flex-col gap-5">
            <input type="hidden" name="email" value={email} />
            <label className="flex flex-col gap-1.5 text-sm font-medium">Code from the email
              <input name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="field font-normal tracking-[0.3em]" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">New password
              <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" className="field font-normal" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">New password again
              <input name="password2" type="password" required minLength={8} autoComplete="new-password" className="field font-normal" />
            </label>
            {reset?.error && <p role="alert" className="m-0 text-sm text-rust-dark">{reset.error}</p>}
            <button disabled={resetting} className="btn btn-primary w-full">{resetting ? "Please wait…" : "Change password"}</button>
          </form>
        )}

        <p className="m-0 text-center text-sm text-muted">
          {step === "code" && <>No email? Check the spam folder, or <button type="button" onClick={() => window.location.reload()} className="cursor-pointer bg-transparent p-0 text-rust underline">start again</button>. · </>}
          <Link href="/auth/sign-in">Back to sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
