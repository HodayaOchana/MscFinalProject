"use client";

// The publisher's form: "Join BookBridge's list of publishers" - the link from the email the team
// sends (no login). The publisher fills in its details and a document; the team checks them and
// adds it to the list, and the author can then ask it to confirm them. Server: server/publishers.js.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";
import { DOC_TYPES, readDocument } from "@/lib/document-file";

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
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api(`/api/publisher-apply?token=${encodeURIComponent(token)}`, { auth: false })
      .then((r) => { setReq(r); if (r.submitted) setDone(true); })
      .catch((e) => setError(e.message));
  }, [token]);

  async function chooseDoc(e) {
    const file = e.target.files?.[0];
    setDoc(null); setFormError(null);
    if (!file) return;
    try { setDoc(await readDocument(file)); } catch (err) { setFormError(err.message); e.target.value = ""; }
  }

  async function submit(e) {
    e.preventDefault();
    if (!doc) { setFormError("Please attach a document."); return; }
    const f = new FormData(e.currentTarget);
    setBusy(true); setFormError(null);
    try {
      await api("/api/publisher-apply", {
        method: "POST", auth: false,
        body: {
          token, name: f.get("name"), website: f.get("website"), registrationNumber: f.get("registrationNumber"),
          isbnPrefix: f.get("isbnPrefix"), notes: f.get("notes"), document: doc,
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
              <Field label="Website">
                <input name="website" required maxLength={300} placeholder="lanternpress.co.il" className="field font-normal" />
              </Field>
              <Field label="Company / association number" hint="In Israel: the company or association (amuta) number, 9 digits.">
                <input name="registrationNumber" required maxLength={30} inputMode="numeric" placeholder="51-123456-7" className="field font-normal" />
              </Field>
              <Field label="ISBN prefix" hint="Your publisher prefix, as on your books (e.g. 978-965-123).">
                <input name="isbnPrefix" required maxLength={20} placeholder="978-965-123" className="field font-normal" />
              </Field>
              <Field label="A document" hint="PDF, JPG or PNG, up to 2 MB – e.g. the registration certificate or the ISBN agency letter.">
                <input type="file" required accept={DOC_TYPES.join(",")} onChange={chooseDoc} className="text-sm font-normal" />
              </Field>
            </div>
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
