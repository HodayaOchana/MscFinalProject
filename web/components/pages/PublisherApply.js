"use client";

// The publisher's form: "Join BookBridge's list of publishers" - the link from the email the team
// sends (no login). The publisher gives its official page (+ website, ISBN prefix if it has one),
// adds the code it is shown to the page's bio and ticks "I added it". The form asks - it doesn't
// explain how the team checks. No documents. Server: server/publishers.js.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-[13px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

export default function PublisherApply() {
  const token = useSearchParams().get("token") || "";
  const [req, setReq] = useState(null);
  const [error, setError] = useState(token ? null : "This link is missing its code. Please open the link from the email again.");
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [codeAdded, setCodeAdded] = useState(false);

  useEffect(() => {
    if (!token) return;
    api(`/api/publisher-apply?token=${encodeURIComponent(token)}`, { auth: false })
      .then((r) => { setReq(r); if (r.submitted) setDone(true); })
      .catch((e) => setError(e.message));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setFormError(null);
    try {
      await api("/api/publisher-apply", {
        method: "POST", auth: false,
        body: {
          token, name: f.get("name"), website: f.get("website"), socialUrl: f.get("socialUrl"), codeAdded,
          registrationNumber: f.get("registrationNumber"), isbnPrefix: f.get("isbnPrefix"), notes: f.get("notes"),
        },
      });
      setDone(true);
    } catch (err) { setFormError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-10 bg-parchment px-6 py-12">
      <Logo href="/" />
      <main className="card flex w-full max-w-[640px] flex-col gap-5 p-8">
        {error && (
          <>
            <h1 className="m-0 font-serif text-3xl font-semibold">This link can’t be used</h1>
            <p role="alert" className="m-0 text-ink-soft">{error}</p>
          </>
        )}
        {!error && !req && <p className="m-0 text-muted">Loading…</p>}
        {req && done && (
          <>
            <h1 className="m-0 font-serif text-3xl font-semibold">Thank you!</h1>
            <p className="m-0 text-ink-soft">We have your details. The BookBridge team will check them, usually within a few days. Once you’re on the list, {req.penName} can ask you to confirm them as your author – you’ll get a separate email for that.</p>
          </>
        )}
        {req && !done && (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="eyebrow">For publishers</span>
              <h1 className="m-0 font-serif text-4xl font-semibold leading-tight">Join BookBridge’s list of publishers</h1>
              <p className="m-0 text-ink-soft">
                An author, <strong>{req.penName}</strong>, says they publish with you. On BookBridge, publishers confirm their authors –
                so first we check that you’re a real publisher. Your details are used only for that check.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Publisher’s name">
                <input name="name" required maxLength={200} defaultValue={req.publisherName || ""} className="field font-normal" />
              </Field>
              <Field label="Email" hint="Confirmation requests will come to this address.">
                <input value={req.contactEmail} readOnly className="field bg-cream font-normal text-ink-soft" />
              </Field>
              <Field label="Official page on a social network" hint="Your publisher’s Facebook / Instagram page.">
                <input name="socialUrl" required maxLength={300} placeholder="facebook.com/LanternPress" className="field font-normal" />
              </Field>
              <Field label={<span>Website <span className="font-normal text-muted">(optional)</span></span>}>
                <input name="website" maxLength={300} placeholder="lanternpress.co.il" className="field font-normal" />
              </Field>
              <Field label={<span>ISBN prefix <span className="font-normal text-muted">(optional)</span></span>} hint="As on your books (e.g. 978-965-123) – we match it with the books in our catalog.">
                <input name="isbnPrefix" maxLength={20} placeholder="978-965-123" className="field font-normal" />
              </Field>
              <Field label={<span>Company / association number <span className="font-normal text-muted">(optional)</span></span>} hint="In Israel: 9 digits.">
                <input name="registrationNumber" maxLength={30} inputMode="numeric" placeholder="51-123456-7" className="field font-normal" />
              </Field>
            </div>
            {req.proofCode && (
              <div className="flex flex-col gap-2 rounded-md bg-parchment px-4 py-3 text-sm text-ink-soft">
                <span>Please add this code to the bio / About of your official page. We’ll email you when you’re on the list – then you can remove it.</span>
                <code className="self-start rounded bg-cream px-3 py-1 font-mono text-base font-bold text-ink">{req.proofCode}</code>
                <label className="flex items-start gap-2 text-ink">
                  <input type="checkbox" required checked={codeAdded} onChange={(e) => setCodeAdded(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-rust)]" />
                  <span>I added the code to my page’s bio.</span>
                </label>
              </div>
            )}
            <Field label={<span>Anything we should know? <span className="font-normal text-muted">(optional)</span></span>}>
              <textarea name="notes" maxLength={1000} rows={2} className="field resize-y font-normal" />
            </Field>
            {formError && <p role="alert" className="m-0 text-sm text-rust-dark">{formError}</p>}
            <button disabled={busy} className="btn btn-primary self-start">{busy ? "Sending…" : "Send to BookBridge"}</button>
            <p className="m-0 text-xs text-muted">The link works once, until {day(req.expiresAt)}. If you don’t know this author, just close this page.</p>
          </form>
        )}
      </main>
    </div>
  );
}
