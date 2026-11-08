"use client";

// "Verify your email" pop-up on every signed-in page, for accounts whose email is not
// verified yet (new sign-ups, and everyone who signed up before verification existed).
// The code is sent only when the user asks ("Send me a code"), always to the account's own
// email (app/auth/email-actions.js). "Later" hides it until the next visit (this browser tab).
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { sendMyVerifyCode, verifyMyEmail } from "@/app/auth/email-actions";

const OK = "bb-email-verified", LATER = "bb-verify-later";
const RESEND_SEC = 60;
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k) => { try { sessionStorage.setItem(k, "1"); } catch {} },
};
const linkBtn = "cursor-pointer bg-transparent p-0 underline disabled:cursor-default disabled:text-muted disabled:no-underline";

export default function VerifyEmailGate() {
  const [email, setEmail] = useState(null);   // set = show the pop-up
  const [step, setStep] = useState("ask");    // ask -> code -> done
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [wait, setWait] = useState(0);
  const first = useRef(null);

  useEffect(() => {
    if (store.get(OK) || store.get(LATER)) return;
    let cancelled = false;
    authClient.getSession({ query: { disableCookieCache: true } }).then(({ data }) => {
      const user = data?.user;
      if (cancelled || !user) return;
      if (user.emailVerified) store.set(OK);
      else setEmail(user.email);
    }).catch(() => {}); // never block a page because of this check
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (email) first.current?.focus(); }, [email, step]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!email) return null;

  const later = () => { store.set(LATER); setEmail(null); };
  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e.message || "Something went wrong – try again."); }
    finally { setBusy(false); }
  }
  const send = () => run(async () => {
    const r = await sendMyVerifyCode();
    if (r.error) throw new Error(r.error);
    setStep("code"); setWait(RESEND_SEC);
  });
  const verify = (e) => { e.preventDefault(); run(async () => {
    const r = await verifyMyEmail(code);
    if (r.error) throw new Error(r.error);
    store.set(OK);
    authClient.getSession({ query: { disableCookieCache: true } }).catch(() => {}); // the session now says "verified"
    setStep("done");
    setTimeout(() => setEmail(null), 1800);
  }); };
  const title = step === "done" ? "Email verified ✓" : "Verify your email";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/45 px-4 backdrop-blur-sm"
      onKeyDown={(e) => e.key === "Escape" && step !== "done" && later()}>
      <div role="dialog" aria-modal="true" aria-labelledby="verify-title" className="card flex w-full max-w-[440px] flex-col gap-4 p-7">
        <span className="eyebrow">One quick step</span>
        <h2 id="verify-title" className="m-0 font-serif text-3xl font-semibold">{title}</h2>

        {step === "ask" && <>
          <p className="m-0 text-ink-soft">Please confirm that <b>{email}</b> is yours. We will email you a 6-digit code (valid for 15 minutes).</p>
          {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
          <button ref={first} type="button" disabled={busy} onClick={send} className="btn btn-primary w-full">{busy ? "Sending…" : "Send me a code"}</button>
        </>}

        {step === "code" && (
          <form onSubmit={verify} className="flex flex-col gap-4">
            <p className="m-0 text-ink-soft">We sent a code to <b>{email}</b>. Not there? Check the spam folder.</p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">Code from the email
              <input ref={first} value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" autoComplete="one-time-code"
                placeholder="123456" className="field font-normal tracking-[0.3em]" />
            </label>
            {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
            <button disabled={busy || !code.trim()} className="btn btn-primary w-full">{busy ? "Checking…" : "Verify"}</button>
            <button type="button" disabled={busy || wait > 0} onClick={send} className={`${linkBtn} self-center text-sm text-rust`}>
              {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
            </button>
          </form>
        )}

        {step === "done" && <p className="m-0 text-moss">Thanks – your account is verified.</p>}

        {(step === "ask" || step === "code") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
            <span className="text-muted">Until then, everything works as usual.</span>
            <button type="button" onClick={later} className={`${linkBtn} text-ink-soft`}>Later</button>
          </div>
        )}
      </div>
    </div>
  );
}
