"use client";

// Sign-in / sign-up form, beside a wall of covers
import { Suspense, useActionState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import CoverWall from "@/components/CoverWall";
import SessionEndedNotice from "./SessionEndedNotice";
import ConsentChecks from "@/components/ConsentChecks";
import NextField from "./NextField";
import { AuthNotice, EmailField } from "./AuthNotice";
import { SignUpPhoto } from "./SignUpPhoto";

// The split page: the cover wall on the left, the form (children) on the right
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="relative flex min-h-[380px] flex-[1_1_480px] flex-col justify-between overflow-hidden bg-cream p-10 text-ink md:p-14">
        <CoverWall rows={5} className="opacity-60" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-parchment via-parchment/60 to-parchment/30" />
        <div className="relative"><Logo /></div>
        <div className="relative flex max-w-[440px] flex-col gap-4">
          <p className="m-0 font-serif text-[40px] italic leading-tight">“Every reader, his or her book.”</p>
          <span className="text-[15px] text-ink-soft">S. R. Ranganathan, The Five Laws of Library Science</span>
        </div>
      </aside>
      <main className="flex flex-[1_1_480px] items-center justify-center px-8 py-14">{children}</main>
    </div>
  );
}

export default function AuthForm({ title, subtitle, action, withName, withConsent, submitLabel, altText, altHref, altLabel, forgot }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <AuthLayout>
        <form action={formAction} className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-serif text-[40px] font-semibold tracking-tight">{title}</h1>
            <p className="m-0 text-ink-soft">{subtitle} <Link href={altHref}>{altLabel}</Link></p>
          </div>
          <SessionEndedNotice />
          <Suspense fallback={null}><AuthNotice /><NextField /></Suspense>
          {withName && <SignUpPhoto />}
          {withName && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">Name
              <input name="name" required autoComplete="name" className="field font-normal" />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">Email
            <Suspense fallback={<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="field font-normal" />}>
              <EmailField />
            </Suspense>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="flex items-baseline justify-between">Password
              {forgot && <Link href="/auth/forgot-password" className="text-sm font-normal">Forgot password?</Link>}
            </span>
            <input name="password" type="password" required minLength={8} autoComplete={withName ? "new-password" : "current-password"} placeholder="At least 8 characters" className="field font-normal" />
          </label>
          {withConsent && <ConsentChecks />}
          {state?.error && (
            <p role="alert" className="m-0 text-sm text-rust-dark">
              {state.error}
              {state.signInEmail && <> <Link href={`/auth/sign-in?email=${encodeURIComponent(state.signInEmail)}`} className="font-bold">Sign in instead</Link> or <Link href="/auth/forgot-password" className="font-bold">reset your password</Link>.</>}
            </p>
          )}
          <button disabled={pending} className="btn btn-primary w-full">{pending ? "Please wait…" : submitLabel}</button>
          <p className="m-0 text-center text-sm text-muted">{altText}</p>
        </form>
    </AuthLayout>
  );
}
