"use client";

// Admin page for authors (project team only - the server checks the signed-in
// email against ADMIN_EMAILS). Server: server/admin-routes.js.
//   Book claims     - "this is my book" where the name on the book is not the author's
//                     verified name: approve (link the book) or reject
//   Uploaded books  - new books authors added; remove one if something is wrong
//   Author requests - authors are confirmed by their PUBLISHER (an emailed link);
//                     here: the status of each request, and Reject if needed
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import { api } from "@/lib/api";

const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS = { pending: "bg-sand text-[#5E4A2A]", approved: "bg-moss-soft text-moss-dark", rejected: "bg-rust-soft text-rust-dark" };
const changed = () => window.dispatchEvent(new Event("bb-admin-changed")); // the bell in the header updates at once
const Badge = ({ status, label }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${STATUS[status] || STATUS.pending}`}>{label || status}</span>;

function ClaimCard({ c, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function decide(kind) {
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/book-claims/${c.id}/${kind}`, { method: "POST", body: { note } });
      changed(); onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <article className="card flex flex-wrap gap-5 p-5">
      <Link href={`/books/${c.book.id}`} className="w-20 flex-none"><Cover book={c.book} small /></Link>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 font-serif text-xl font-semibold"><Link href={`/books/${c.book.id}`} className="text-ink">{c.book.title}</Link></h2>
          <Badge status={c.status} />
          <span className="ml-auto text-sm text-muted">{when(c.createdAt)}</span>
        </div>
        <dl className="m-0 grid grid-cols-[8.5rem_1fr] gap-y-1.5 text-[15px]">
          <dt className="text-muted">Name on the book</dt><dd className="m-0">{c.book.authors?.join(", ") || "?"}</dd>
          <dt className="text-muted">Verified name</dt><dd className="m-0 font-bold">{c.verifiedNames.join(" / ") || "–"}</dd>
          <dt className="text-muted">Account</dt><dd className="m-0">{c.name} · <a href={`mailto:${c.email}`}>{c.email}</a> · <Link href={`/authors/${c.userId}`}>author page</Link></dd>
          {c.message && (<><dt className="text-muted">Their note</dt><dd className="m-0 whitespace-pre-wrap break-words">{c.message}</dd></>)}
          {c.note && (<><dt className="text-muted">Your note</dt><dd className="m-0">{c.note}</dd></>)}
        </dl>
        {c.status === "pending" && (
          <>
            <p className="m-0 text-sm text-ink-soft">The names don’t match exactly – e.g. a co-author, an earlier name or another spelling. Approve only if it is clearly the same person.</p>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Note to the author (optional)" className="field" />
            {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => decide("approve")} className="btn btn-primary">Approve – link the book</button>
              <button type="button" disabled={busy} onClick={() => decide("reject")} className="btn btn-outline">Reject</button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function UploadCard({ b, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function remove() {
    if (!window.confirm(`Remove "${b.title}" from the catalog? Its ratings and discussion go with it.`)) return;
    setBusy(true); setError(null);
    try { await api(`/api/admin/uploads/${b.id}`, { method: "DELETE" }); changed(); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <article className="card flex flex-wrap gap-5 p-5">
      <Link href={`/books/${b.id}`} className="w-20 flex-none"><Cover book={b} small /></Link>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 font-serif text-xl font-semibold"><Link href={`/books/${b.id}`} className="text-ink">{b.title}</Link></h2>
          <span className="ml-auto text-sm text-muted">{when(b.createdAt)}</span>
        </div>
        <p className="m-0 text-sm text-ink-soft">by {b.authors?.join(", ")} · uploaded by <Link href={`/authors/${b.userId}`}>{b.uploader}</Link> ({b.email})</p>
        <p className="m-0 text-[15px] text-[#3D3029]">{b.description}{b.description.length >= 300 ? "…" : ""}</p>
        {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
        <button type="button" disabled={busy} onClick={remove} className="btn btn-outline self-start">Remove from catalog</button>
      </div>
    </article>
  );
}

function RequestCard({ r, focused, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function reject() {
    if (!window.confirm(`Reject the request from ${r.penName}? The publisher link stops working.`)) return;
    setBusy(true); setError(null);
    try { await api(`/api/admin/author-requests/${r.id}/reject`, { method: "POST", body: { note: "Rejected by the BookBridge team" } }); changed(); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  const publisher = r.publisherDecision === "confirmed" ? `Confirmed ${when(r.publisherDecidedAt)}`
    : r.publisherDecision === "declined" ? `Declined ${when(r.publisherDecidedAt)}`
    : r.emailSentAt ? `Emailed ${when(r.emailSentAt)} – waiting` : r.publisherEmail ? "Email not sent (check the server mail settings)" : "– (an older request, before publisher checks)";
  return (
    <article id={`req-${r.id}`} className={`card flex flex-col gap-3 p-5 ${focused ? "ring-2 ring-rust" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 font-serif text-xl font-semibold">
          #{r.id} · {r.linkedCount > 0 ? <Link href={`/authors/${r.userId}`}>{r.penName}</Link> : r.penName}
        </h2>
        <Badge status={r.status} label={r.status === "pending" ? "waiting for publisher" : r.status} />
        <span className="ml-auto text-sm text-muted">{when(r.createdAt)}</span>
      </div>
      <dl className="m-0 grid grid-cols-[7rem_1fr] gap-y-1.5 text-[15px]">
        <dt className="text-muted">Account</dt><dd className="m-0">{r.name} · <a href={`mailto:${r.email}`}>{r.email}</a></dd>
        {r.publisherEmail && (<><dt className="text-muted">Publisher</dt><dd className="m-0">{r.publisherName} · {r.publisherEmail}</dd></>)}
        <dt className="text-muted">Publisher’s answer</dt><dd className="m-0">{publisher}</dd>
        <dt className="text-muted">Books</dt><dd className="m-0 whitespace-pre-wrap break-words">{r.books}</dd>
        {r.message && (<><dt className="text-muted">Message</dt><dd className="m-0 whitespace-pre-wrap break-words">{r.message}</dd></>)}
        {r.note && (<><dt className="text-muted">Note</dt><dd className="m-0">{r.note}</dd></>)}
      </dl>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      {r.status === "pending" && <button type="button" disabled={busy} onClick={reject} className="btn btn-outline self-start">Reject</button>}
    </article>
  );
}

const TABS = [
  { key: "claims", label: "Book claims", url: (all) => `/api/admin/book-claims${all ? "?status=all" : ""}`, list: "claims" },
  { key: "uploads", label: "Uploaded books", url: () => "/api/admin/uploads", list: "uploads" },
  { key: "requests", label: "Author requests", url: (all) => `/api/admin/author-requests${all ? "?status=all" : ""}`, list: "requests" },
];

export default function AuthorRequestsAdmin({ focusId }) {
  const [tab, setTab] = useState(focusId ? "requests" : "claims");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);
  const [signedInAs, setSignedInAs] = useState(null);
  const t = TABS.find((x) => x.key === tab);
  const load = useCallback(() => {
    api(t.url(all)).then((r) => { setData(r[t.list]); setError(null); }).catch((e) => {
      setError(e.message);
      if (e.message.includes("project team")) api("/api/me").then((m) => setSignedInAs(m.email)).catch(() => {});
    });
  }, [t, all]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data && focusId && tab === "requests") document.getElementById(`req-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [data, focusId, tab]);

  return (
    <AppShell width="max-w-[900px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Admin</span>
          <h1 className="m-0 font-serif text-5xl font-semibold">Authors</h1>
          <p className="m-0 text-ink-soft">Authors are confirmed by their publisher through an emailed link. You decide book claims and can remove uploaded books.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-2">
            {TABS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => { if (tab !== x.key) { setData(null); setTab(x.key); } }}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${tab === x.key ? "border-ink bg-ink text-parchment" : "border-line-strong bg-transparent text-ink hover:border-rust hover:text-rust"}`}>
                {x.label}
              </button>
            ))}
          </div>
          {tab !== "uploads" && (
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={all} onChange={(e) => { setData(null); setAll(e.target.checked); }} className="h-4 w-4 accent-[var(--color-rust)]" /> Show decided too
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-rust-dark">
            {error.includes("project team")
              ? <>This page is for the BookBridge project team only. {signedInAs ? <>You are signed in as <strong>{signedInAs}</strong> – sign out and sign in with the project account.</> : "Sign in with the project account."}</>
              : error}
          </p>
        )}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.length === 0 && <p className="text-muted">{tab === "uploads" ? "No uploaded books yet." : all ? "Nothing yet." : "Nothing waiting – all done."}</p>}
        {data && tab === "claims" && data.map((c) => <ClaimCard key={c.id} c={c} onDone={load} />)}
        {data && tab === "uploads" && data.map((b) => <UploadCard key={b.id} b={b} onDone={load} />)}
        {data && tab === "requests" && data.map((r) => <RequestCard key={r.id} r={r} focused={r.id === focusId} onDone={load} />)}
      </div>
    </AppShell>
  );
}
