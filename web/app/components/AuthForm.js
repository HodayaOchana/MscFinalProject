"use client";

// Sign-in / sign-up form, in the split "autumn library" layout
import { Suspense, useActionState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import Leaf from "@/components/Leaf";
import SessionEndedNotice from "./SessionEndedNotice";
import ConsentChecks from "@/components/ConsentChecks";
import NextField from "./NextField";
import { AuthNotice, EmailField } from "./AuthNotice";

// The split page: the quote on the left, the form (children) on the right
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="relative flex min-h-[380px] flex-[1_1_480px] flex-col justify-between overflow-hidden bg-ink p-10 text-parchment md:p-14">
        <Logo dark />
        <Leaf size={260} color="#C9874E" vein={null} className="absolute -right-10 top-28 rotate-[22deg] opacity-15" />
        <Leaf size={140} color="#8C9A55" vein={null} className="absolute bottom-16 right-40 rotate-[-35deg] opacity-20" />
        <div className="relative flex max-w-[440px] flex-col gap-4">
          <p className="m-0 font-serif text-[44px] italic leading-tight">“Every reader, his or her book.”</p>
          <span className="text-[15px] text-[#D9C9B4]">S. R. Ranganathan, The Five Laws of Library Science</span>
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
            <h1 className="m-0 font-serif text-[44px] font-semibold">{title}</h1>
            <p className="m-0 text-ink-soft">{subtitle} <Link href={altHref}>{altLabel}</Link></p>
          </div>
          <SessionEndedNotice />
          <Suspense fallback={null}><AuthNotice /><NextField /></Suspense>
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
          {state?.error && <p role="alert" className="m-0 text-sm text-rust-dark">{state.error}</p>}
          <button disabled={pending} className="btn btn-primary w-full">{pending ? "Please wait…" : submitLabel}</button>
          <p className="m-0 text-center text-sm text-muted">{altText}</p>
        </form>
    </AuthLayout>
  );
}
