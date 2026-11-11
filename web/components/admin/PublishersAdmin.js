"use client";

// Admin page for publishers (project team only - the server checks ADMIN_EMAILS).
// Server: server/publishers.js (/api/admin/publishers, /api/admin/publisher-requests).
//   Requests        - authors whose publisher is not on the list ("My publisher isn't listed"):
//                     1. "Send the form to the publisher" - it gets an email with a form (/publisher/apply)
//                     2. it fills in its details + a document -> they show here with the cross-checks
//                     3. "Add to the list" (the author gets an email and can continue) or "Don't add".
//                     Also: link it to a publisher already on the list, or "Fill it in myself".
//   Add a publisher - the team fills in the details itself (same checks).
//   On the list     - publishers the team added (view the document, take one off the list),
//                     (all from the publishers table - the key is the id; the old .env list was moved
//                     there by db/import-env-publishers.js).
// The link in the team's email opens /admin/publishers?request=<id> - that request opens at once.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api, apiBlob } from "@/lib/api";
import { DOC_TYPES, readDocument } from "@/lib/document-file";

const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS = {
  new: ["New – send the form", "bg-rust-soft text-rust-dark"], invited: ["Waiting for the publisher", "bg-sand text-ink-soft"],
  submitted: ["Details in – check them", "bg-rust-soft text-rust-dark"], added: ["Added", "bg-moss-soft text-moss-dark"], rejected: ["Not added", "bg-sand text-ink-soft"],
};
const changed = () => window.dispatchEvent(new Event("bb-admin-changed")); // the bell in the header updates at once
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());


function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-[13px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

// The "add a publisher" form - empty, or filled from an author's request
function AddForm({ request, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState(null); // the server's cross-checks - shown before adding
  const [sure, setSure] = useState(false);
  const [doc, setDoc] = useState(null); // { data, name }
  const formRef = useRef(null);
  const contact = request?.contact || "";

  async function chooseDoc(e) {
    const file = e.target.files?.[0];
    setDoc(null); setError(null);
    if (!file) return;
    try { setDoc(await readDocument(file)); } catch (err) { setError(err.message); e.target.value = ""; }
  }

  async function submit(e) {
    e.preventDefault();
    if (!doc) { setError("Please attach a document that shows it is really this publisher."); return; }
    const f = new FormData(formRef.current);
    setBusy(true); setError(null);
    try {
      const out = await api("/api/admin/publishers", {
        method: "POST",
        body: {
          name: f.get("name"), contactEmail: f.get("contactEmail"), website: f.get("website"),
          registrationNumber: f.get("registrationNumber"), isbnPrefix: f.get("isbnPrefix"), notes: f.get("notes"),
          document: doc, requestId: request?.id ?? null, confirm: Boolean(warnings && sure),
        },
      });
      changed();
      onDone(out);
    } catch (err) {
      if (err.status === 409 && err.body?.warnings) { setWarnings(err.body.warnings); setSure(false); }
      else setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} onChange={() => warnings && setWarnings(null)} className="flex flex-col gap-4">
      {request && (
        <p className="m-0 rounded-md bg-parchment px-4 py-3 text-sm text-ink-soft">
          For <b>{request.name || request.email}</b>’s request. When you add it, they get an email and can ask the publisher to confirm them.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Publisher’s name">
          <input name="name" required maxLength={200} defaultValue={request?.publisherName || ""} className="field font-normal" />
        </Field>
        <Field label="Contact email" hint="The confirmation links go here – best on the publisher’s own domain.">
          <input name="contactEmail" type="email" required maxLength={254} defaultValue={looksLikeEmail(contact) ? contact.trim() : ""} className="field font-normal" />
        </Field>
        <Field label="Website" hint="We compare it with the email’s domain.">
          <input name="website" required maxLength={300} defaultValue={!looksLikeEmail(contact) ? contact : ""} placeholder="lanternpress.co.il" className="field font-normal" />
        </Field>
        <Field label="Company / association number" hint="Israel: 9 digits (companies 51…, associations 58…) – look it up in the Corporations Authority registry.">
          <input name="registrationNumber" required maxLength={30} inputMode="numeric" placeholder="51-123456-7" className="field font-normal" />
        </Field>
        <Field label="ISBN prefix" hint="The publisher’s prefix from the ISBN agency – Israeli ones start with 978-965.">
          <input name="isbnPrefix" required maxLength={20} placeholder="978-965-123" className="field font-normal" />
        </Field>
        <Field label="Document (required)" hint="PDF, JPG or PNG, up to 2 MB – e.g. the registration certificate or the ISBN agency letter.">
          <input type="file" required accept={DOC_TYPES.join(",")} onChange={chooseDoc} className="text-sm font-normal" />
        </Field>
      </div>
      <Field label={<span>Notes for the team <span className="font-normal text-muted">(optional)</span></span>}>
        <textarea name="notes" maxLength={1000} rows={2} placeholder="How you checked it" className="field resize-y font-normal" />
      </Field>

      {warnings && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-rust/40 bg-rust-soft/40 px-4 py-3 text-sm text-ink">
          <b>Please check before adding:</b>
          <ul className="m-0 flex flex-col gap-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <label className="flex items-start gap-2 pt-1">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-rust)]" />
            <span>I checked these, and it really is this publisher – add it anyway.</span>
          </label>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || (warnings && !sure)} className="btn btn-primary">{busy ? "Adding…" : request ? "Add it and tell the author" : "Add the publisher"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>}
      </div>
    </form>
  );
}

function RequestCard({ r, publishers, open, onDone }) {
  const [mode, setMode] = useState(null); // add (the team fills it in) | link | reject
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [sure, setSure] = useState(false); // "I checked the warnings"
  const [label, cls] = STATUS[r.stage] || STATUS.new;
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [open]);

  async function post(path, body, after) {
    setBusy(true); setError(null); setInfo(null);
    try { await api(path, { method: "POST", body }); changed(); if (after) after(); else onDone(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function viewDoc() {
    setError(null);
    try {
      const url = URL.createObjectURL(await apiBlob(`/api/admin/publisher-requests/${r.id}/document`));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { setError(err.message); }
  }
  const active = publishers.filter((p) => p.active);
  const sub = r.submitted;
  const warn = sub?.warnings || [];

  return (
    <article ref={ref} className={`card flex flex-col gap-3 p-5 ${open ? "ring-2 ring-rust/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold uppercase ${cls}`}>{label}</span>
        <h2 className="m-0 font-serif text-xl font-semibold">{sub?.name || r.publisherName}</h2>
        <span className="ml-auto text-sm text-muted">{when(r.createdAt)}</span>
      </div>
      <dl className="m-0 grid grid-cols-[9rem_1fr] gap-y-1.5 text-[15px]">
        <dt className="text-muted">Author</dt>
        <dd className="m-0">{r.name || "?"}{r.email && <> · <a href={`mailto:${r.email}`}>{r.email}</a></>} · pen name “{r.penName}”</dd>
        <dt className="text-muted">Publisher’s email</dt><dd className="m-0 break-all">{r.contact || <span className="text-muted">–</span>}</dd>
        <dt className="text-muted">Books</dt><dd className="m-0 whitespace-pre-wrap">{r.books}</dd>
        {r.message && <><dt className="text-muted">Message</dt><dd className="m-0 whitespace-pre-wrap">{r.message}</dd></>}
        {r.invitedAt && <><dt className="text-muted">Form sent</dt><dd className="m-0">{when(r.invitedAt)}{!r.submittedAt && r.inviteExpiresAt && <span className="text-muted"> · link works until {when(r.inviteExpiresAt)}</span>}</dd></>}
        {r.status === "added" && <><dt className="text-muted">Added as</dt><dd className="m-0">{r.addedAs || "?"} · {when(r.decidedAt)}</dd></>}
        {r.status === "rejected" && <><dt className="text-muted">Your reason</dt><dd className="m-0">{r.note} · {when(r.decidedAt)}</dd></>}
      </dl>

      {/* what the publisher sent */}
      {sub && (
        <div className="flex flex-col gap-2 rounded-md bg-parchment px-4 py-3">
          <b className="text-[15px]">The publisher’s details{r.submittedAt && <span className="font-normal text-muted"> · sent {when(r.submittedAt)}</span>}</b>
          <dl className="m-0 grid grid-cols-[9rem_1fr] gap-y-1 text-[15px]">
            <dt className="text-muted">Name</dt><dd className="m-0">{sub.name}</dd>
            <dt className="text-muted">Website</dt><dd className="m-0">{sub.website}</dd>
            <dt className="text-muted">Registration no.</dt><dd className="m-0">{sub.registrationNumber}</dd>
            <dt className="text-muted">ISBN prefix</dt><dd className="m-0">{sub.isbnPrefix}</dd>
            {sub.notes && <><dt className="text-muted">Their note</dt><dd className="m-0 whitespace-pre-wrap">{sub.notes}</dd></>}
          </dl>
          <button type="button" onClick={viewDoc} className="btn btn-outline self-start px-4 py-2 text-sm">View document{sub.documentName ? ` (${sub.documentName})` : ""}</button>
          {warn.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm">
              <b className="text-rust-dark">Check before adding:</b>
              <ul className="m-0 flex flex-col gap-1 pl-5">{warn.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : <span className="text-sm text-moss-dark">The cross-checks found nothing odd. Still look at the document and the registry.</span>}
        </div>
      )}

      {r.status === "pending" && !mode && (
        <div className="flex flex-wrap items-center gap-3">
          {r.stage === "submitted" && (
            <>
              {warn.length > 0 && (
                <label className="flex w-full items-start gap-2 text-sm">
                  <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-rust)]" />
                  <span>I checked these, and it really is this publisher.</span>
                </label>
              )}
              <button type="button" disabled={busy || (warn.length > 0 && !sure)} onClick={() => post(`/api/admin/publisher-requests/${r.id}/approve`, { confirm: sure })} className="btn btn-primary">
                {busy ? "Adding…" : "Add to the list and tell the author"}
              </button>
            </>
          )}
          {r.stage !== "submitted" && r.canReinvite && r.contact && (
            <button type="button" disabled={busy} onClick={() => post(`/api/admin/publisher-requests/${r.id}/invite`, {}, () => { setInfo(`The form was sent to ${r.contact}.`); onDone(); })} className="btn btn-primary">
              {busy ? "Sending…" : r.invitedAt ? "Send the form again" : "Send the form to the publisher"}
            </button>
          )}
          {r.stage === "invited" && !r.canReinvite && <span className="text-sm text-muted">Waiting for the publisher to fill in the form.</span>}
          {active.length > 0 && <button type="button" onClick={() => setMode("link")} className="btn btn-outline">It’s on the list already</button>}
          {r.stage !== "submitted" && <button type="button" onClick={() => setMode("add")} className="cursor-pointer bg-transparent p-0 text-sm text-ink-soft underline">Fill it in myself</button>}
          <button type="button" onClick={() => setMode("reject")} className="cursor-pointer bg-transparent p-0 text-sm text-rust underline">Don’t add</button>
        </div>
      )}
      {mode === "add" && <div className="border-t border-line pt-4"><AddForm request={r} onDone={onDone} onCancel={() => setMode(null)} /></div>}
      {mode === "link" && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Field label="Which publisher on the list?">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="field font-normal">
              <option value="" disabled>Choose</option>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.contactEmail})</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || !pick} onClick={() => post(`/api/admin/publisher-requests/${r.id}/link`, { publisherId: Number(pick) })} className="btn btn-primary">Tell the author</button>
            <button type="button" onClick={() => setMode(null)} className="btn btn-outline">Cancel</button>
          </div>
        </div>
      )}
      {mode === "reject" && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Field label="Why not? (the author gets this by email)">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="field resize-y font-normal" placeholder="e.g. We could not find this publisher in the registry." />
          </Field>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || !note.trim()} onClick={() => post(`/api/admin/publisher-requests/${r.id}/reject`, { note })} className="btn btn-primary">Send</button>
            <button type="button" onClick={() => setMode(null)} className="btn btn-outline">Cancel</button>
          </div>
        </div>
      )}
      {info && <p role="status" className="m-0 text-sm text-moss-dark">{info}</p>}
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
    </article>
  );
}

function PublisherRow({ p, onDone }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState(null);
  async function viewDoc() {
    setError(null);
    try {
      const url = URL.createObjectURL(await apiBlob(`/api/admin/publishers/${p.id}/document`));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { setError(err.message); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await api(`/api/admin/publishers/${p.id}`, { method: "DELETE" }); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <article className={`card flex flex-col gap-2 p-5 ${p.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="m-0 font-serif text-xl font-semibold">{p.name} <span className="font-sans text-sm font-normal text-muted">#{p.id}</span></h3>
        {!p.active && <span className="rounded-md bg-sand px-2.5 py-0.5 text-xs font-bold uppercase text-ink-soft">Removed</span>}
        <span className="ml-auto text-sm text-muted">Added {when(p.createdAt)}</span>
      </div>
      <dl className="m-0 grid grid-cols-[9rem_1fr] gap-y-1 text-[15px]">
        <dt className="text-muted">Contact</dt><dd className="m-0 break-all">{p.contactEmail}</dd>
        <dt className="text-muted">Website</dt><dd className="m-0">{p.website || "–"}</dd>
        <dt className="text-muted">Registration no.</dt><dd className="m-0">{p.registrationNumber || "–"}</dd>
        <dt className="text-muted">ISBN prefix</dt><dd className="m-0">{p.isbnPrefix || "–"}</dd>
        <dt className="text-muted">Added by</dt><dd className="m-0">{{ team: "the team", publisher: "the publisher’s form, checked by the team", env: "moved from the old .env list – not checked, no document" }[p.source] || "the team"}</dd>
        <dt className="text-muted">Authors asked</dt><dd className="m-0">{p.authors}</dd>
        {p.notes && <><dt className="text-muted">Notes</dt><dd className="m-0 whitespace-pre-wrap">{p.notes}</dd></>}
      </dl>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {p.documentMime && <button type="button" onClick={viewDoc} className="btn btn-outline px-4 py-2 text-sm">View document</button>}
        {p.active && !sure && <button type="button" onClick={() => setSure(true)} className="cursor-pointer bg-transparent p-0 text-sm text-rust">Take off the list</button>}
        {p.active && sure && (
          <span className="flex flex-wrap items-center gap-3 text-sm">
            Authors won’t see it in the list any more.
            <button type="button" disabled={busy} onClick={remove} className="btn btn-primary px-4 py-2 text-sm">Remove</button>
            <button type="button" onClick={() => setSure(false)} className="cursor-pointer bg-transparent p-0 text-sm text-ink-soft">Cancel</button>
          </span>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
    </article>
  );
}

export default function PublishersAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signedInAs, setSignedInAs] = useState(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(null);
  const [focus, setFocus] = useState(null); // ?request=<id> from the team's email
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(() => {
    api("/api/admin/publishers").then((r) => { setData(r); setError(null); }).catch((e) => {
      setError(e.message);
      if (e.message.includes("project team")) api("/api/me").then((m) => setSignedInAs(m.email)).catch(() => {});
    });
  }, []);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("request"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setFocus(id);
    load();
  }, [load]);

  const pending = data?.requests.filter((r) => r.status === "pending") || [];
  const decided = data?.requests.filter((r) => r.status !== "pending") || [];
  const done = (out) => { setAdding(false); setAdded(out?.publisher?.name || null); setFocus(null); load(); };

  return (
    <AppShell width="max-w-[900px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="eyebrow">Admin</span>
            <span className="flex gap-4 text-sm"><Link href="/admin/author-requests">Authors →</Link><Link href="/admin/reports">Reports →</Link></span>
          </div>
          <h1 className="m-0 font-serif text-5xl font-semibold">Publishers</h1>
          <p className="m-0 text-ink-soft">Authors are confirmed by their publisher. Add a publisher only after checking it’s real: its registration number, ISBN prefix and website – and a document that shows it.</p>
        </div>

        {error && (
          <p role="alert" className="text-rust-dark">
            {error.includes("project team")
              ? <>This page is for the BookBridge project team only. {signedInAs ? <>You are signed in as <strong>{signedInAs}</strong> – sign out and sign in with the project account.</> : "Sign in with the project account."}</>
              : error}
          </p>
        )}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {added && <p role="status" className="m-0 rounded-md bg-moss-soft px-4 py-3 text-moss-dark"><b>{added}</b> is on the list now.</p>}

        {data && (
          <>
            <section className="flex flex-col gap-4">
              <h2 className="m-0 font-serif text-3xl font-semibold">Requests from authors {pending.length > 0 && <span className="text-muted">({pending.length})</span>}</h2>
              {pending.length === 0 && <p className="m-0 text-muted">No author is waiting for a publisher.</p>}
              {pending.map((r) => (
                <RequestCard key={r.id} r={r} publishers={data.publishers} open={focus === r.id} onDone={() => done()} />
              ))}
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 font-serif text-3xl font-semibold">On the list</h2>
                {!adding && <button type="button" onClick={() => { setAdding(true); setAdded(null); }} className="btn btn-primary">Add a publisher</button>}
              </div>
              {adding && <div className="card p-5"><AddForm onDone={done} onCancel={() => setAdding(false)} /></div>}
              {data.publishers.length === 0 && <p className="m-0 text-muted">No publishers yet.</p>}
              {data.publishers.map((p) => <PublisherRow key={p.id} p={p} onDone={load} />)}
            </section>

            {decided.length > 0 && (
              <section className="flex flex-col gap-4">
                <button type="button" onClick={() => setShowDecided((s) => !s)} aria-expanded={showDecided} className="cursor-pointer self-start bg-transparent p-0 text-left font-serif text-2xl font-semibold text-ink">
                  Decided in the last 60 days ({decided.length}) {showDecided ? "▴" : "▾"}
                </button>
                {showDecided && decided.map((r) => <RequestCard key={r.id} r={r} publishers={data.publishers} onDone={load} />)}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
