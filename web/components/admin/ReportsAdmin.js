"use client";

// Admin page for reports (project team only - the server checks the signed-in email
// against ADMIN_EMAILS). Server: server/admin-routes.js (/api/admin/reports).
// One card per reported review / discussion message: what it says, who really wrote it
// (also behind a pen name), why and how many readers reported it. After 3 readers it is
// already hidden on its own; here the team decides: Hide it, Keep it, or show it again.
// The first report of an item and the automatic hiding also email the team (server/social-routes.js).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";

const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const REASON = { spoiler: "Spoiler", offensive: "Offensive", spam: "Spam", other: "Other" };
const STATUS = {
  open: ["Waiting for you", "bg-sand text-ink-soft"],
  hidden: ["Hidden", "bg-rust-soft text-rust-dark"],
  dismissed: ["Kept", "bg-moss-soft text-moss-dark"],
};
const changed = () => window.dispatchEvent(new Event("bb-admin-changed")); // the bell in the header updates at once

function ReportCard({ r, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [label, cls] = STATUS[r.status] || STATUS.open;
  async function decide(action) {
    setBusy(true); setError(null);
    try {
      await api("/api/admin/reports/decide", { method: "POST", body: { kind: r.kind, bookId: r.bookId, id: r.id, action } });
      changed(); onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <article className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold uppercase ${cls}`}>{label}</span>
        <span className="text-sm text-ink-soft">
          {r.kind === "review" ? "A review" : "A discussion message"} on <Link href={`/books/${r.bookId}#readers`} className="font-semibold">{r.title}</Link>
        </span>
        <span className="ml-auto text-sm text-muted">{when(r.lastAt)}</span>
      </div>

      {r.deleted
        ? <p className="m-0 text-muted">The writer deleted it meanwhile.</p>
        : <blockquote className="m-0 whitespace-pre-wrap break-words border-l-2 border-rust/50 bg-parchment px-4 py-3 text-[15px] text-ink">{r.body}</blockquote>}

      <dl className="m-0 grid grid-cols-[8rem_1fr] gap-y-1.5 text-[15px]">
        <dt className="text-muted">Reported by</dt>
        <dd className="m-0"><b>{r.readers}</b> {r.readers === 1 ? "reader" : "readers"} · {r.reasons.map((x) => REASON[x] || x).join(", ")}</dd>
        {!r.deleted && (
          <>
            <dt className="text-muted">Written by</dt>
            <dd className="m-0">{r.writer || "?"}{r.email && <> · <a href={`mailto:${r.email}`}>{r.email}</a></>}{r.alias && <span className="text-muted"> · posted as “{r.alias}”</span>}</dd>
            <dt className="text-muted">Now</dt>
            <dd className="m-0">{r.hidden ? "Hidden from readers (the writer still sees it)" : "Shown to readers"}</dd>
          </>
        )}
      </dl>

      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      {!r.deleted && (
        <div className="flex flex-wrap gap-3">
          {r.status === "open" && (
            <>
              <button type="button" disabled={busy} onClick={() => decide("hide")} className="btn btn-primary">Hide it</button>
              <button type="button" disabled={busy} onClick={() => decide("keep")} className="btn btn-outline">{r.hidden ? "Keep it – show it again" : "Keep it"}</button>
            </>
          )}
          {r.status === "hidden" && <button type="button" disabled={busy} onClick={() => decide("restore")} className="btn btn-outline">Show it again</button>}
          {r.status === "dismissed" && <button type="button" disabled={busy} onClick={() => decide("hide")} className="btn btn-outline">Hide it after all</button>}
        </div>
      )}
    </article>
  );
}

export default function ReportsAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);
  const [signedInAs, setSignedInAs] = useState(null);
  const load = useCallback(() => {
    api(`/api/admin/reports${all ? "?status=all" : ""}`).then((r) => { setData(r.reports); setError(null); }).catch((e) => {
      setError(e.message);
      if (e.message.includes("project team")) api("/api/me").then((m) => setSignedInAs(m.email)).catch(() => {});
    });
  }, [all]);
  useEffect(() => { load(); }, [load]);

  return (
    <AppShell width="max-w-[900px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="eyebrow">Admin</span>
            <span className="flex gap-4 text-sm"><Link href="/admin/author-requests">Authors →</Link><Link href="/admin/publishers">Publishers →</Link></span>
          </div>
          <h1 className="m-0 font-serif text-5xl font-semibold">Reports</h1>
          <p className="m-0 text-ink-soft">Reviews and discussion messages that readers reported. After 3 readers, an item is hidden on its own until you decide.</p>
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-ink-soft">
          <input type="checkbox" checked={all} onChange={(e) => { setData(null); setAll(e.target.checked); }} className="h-4 w-4 accent-[var(--color-rust)]" /> Show decided too
        </label>
        {error && (
          <p role="alert" className="text-rust-dark">
            {error.includes("project team")
              ? <>This page is for the BookBridge project team only. {signedInAs ? <>You are signed in as <strong>{signedInAs}</strong> – sign out and sign in with the project account.</> : "Sign in with the project account."}</>
              : error}
          </p>
        )}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.length === 0 && <p className="text-muted">{all ? "No reports yet." : "Nothing waiting – all done."}</p>}
        {data && data.map((r) => <ReportCard key={`${r.kind}-${r.bookId}-${r.id}`} r={r} onDone={load} />)}
      </div>
    </AppShell>
  );
}
