"use client";

// The author part of the Account page.
//  - A reader: "Are you an author?" - closed until they open it. The request
//    names the publisher; BookBridge emails the publisher a link to confirm.
//  - An author (confirmed by the publisher): "Your books" - the author page
//    (the VERIFIED name is locked; the shown name, bio and website can be edited),
//    the linked books, "Add a book that's already here" and "Upload a new book".
// Server: GET /api/me/author, PUT /api/me/author/profile, POST /api/me/author-request(/resend),
//         /api/author/... (server/author-verification.js)
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Cover from "@/components/Cover";
import BookPeek, { hasPeek } from "@/components/BookPeek";
import ClaimBooks from "@/components/author/ClaimBooks";
import UploadBook from "@/components/author/UploadBook";
import { api } from "@/lib/api";

const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function RequestForm({ onSent, onCancel, again, penName, ready }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api("/api/me/author-request", {
        method: "POST",
        body: {
          penName: f.get("penName"), books: f.get("books"), publisherName: f.get("publisherName"),
          publisherEmail: f.get("publisherEmail"), message: f.get("message"), confirm: f.get("confirm") === "on",
        },
      });
      onSent();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  if (!ready) return <p className="m-0 text-ink-soft">Author accounts open soon – check back later.</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="m-0 text-ink-soft">
        {again
          ? "Publish under another name too? Your publisher confirms it the same way."
          : "Wrote a book? Your posts in its discussion get an Author badge, you can pin a message for your readers, add new books, and see how readers respond to your books."}
      </p>
      <p className="m-0 rounded-md bg-parchment px-4 py-3 text-sm text-ink-soft">
        <strong>How we confirm it’s you:</strong> we email your publisher a one-time link, and they confirm that you are their author – the way bookstores and streaming services check authors and artists.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Pen name
        <input name="penName" required maxLength={120} defaultValue={again ? "" : penName || ""} placeholder="Exactly as it appears on your books" className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Books you published with them
        <textarea name="books" required maxLength={2000} rows={3} placeholder="One title per line" className="field resize-y font-normal" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">Publisher
          <input name="publisherName" required maxLength={200} placeholder="e.g. Lantern Press" className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">Your contact’s email there
          <input name="publisherEmail" type="email" required maxLength={254} placeholder="editor@publisher.com" className="field font-normal" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Anything else? <span className="font-normal text-muted">(optional)</span></span>
        <textarea name="message" maxLength={2000} rows={2} className="field resize-y font-normal" />
      </label>
      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4 accent-[var(--color-rust)]" />
        <span>I confirm that I am the author of these books, and agree that BookBridge emails my publisher to check it.</span>
      </label>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="btn btn-primary">{busy ? "Sending…" : "Ask my publisher to confirm"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>}
      </div>
    </form>
  );
}

// The author's page details - shown, or edited in place
function ProfileEditor({ userId, profile, verifiedNames, hasBooks, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api("/api/me/author/profile", { method: "PUT", body: { penName: f.get("penName"), bio: f.get("bio"), website: f.get("website") } });
      setEditing(false);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-parchment px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-serif text-2xl font-semibold">{profile.penName}</span>
          {verifiedNames.length > 0 && (
            <span title="Confirmed by your publisher – it can't be changed here" className="rounded-md bg-moss-soft px-2.5 py-0.5 text-xs font-bold text-moss-dark">
              ✓ Verified: {verifiedNames.join(" / ")}
            </span>
          )}
          {profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">{host(profile.website)} ↗</a>}
        </div>
        {profile.bio
          ? <p className="m-0 whitespace-pre-line text-ink-soft">{profile.bio}</p>
          : <p className="m-0 text-sm text-muted">No bio yet – a few lines about you help readers get to know you.</p>}
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {hasBooks ? <Link href={`/authors/${userId}`}>View your author page →</Link> : <span className="text-muted">Your author page opens with your first book</span>}
          <button type="button" onClick={() => setEditing(true)} className="cursor-pointer bg-transparent p-0 text-rust">Edit</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-md bg-parchment px-5 py-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Name on your page <span className="font-normal text-muted">(your verified name stays {verifiedNames.join(" / ") || "–"})</span></span>
        <input name="penName" required maxLength={120} defaultValue={profile.penName} className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium"><span>About you <span className="font-normal text-muted">(optional)</span></span>
        <textarea name="bio" maxLength={2000} rows={4} defaultValue={profile.bio || ""} placeholder="A few lines for your readers" className="field resize-y font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Website <span className="font-normal text-muted">(optional)</span></span>
        <input name="website" maxLength={300} defaultValue={profile.website || ""} placeholder="https://yoursite.com" className="field font-normal" />
      </label>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => { setEditing(false); setError(null); }} className="btn btn-outline">Cancel</button>
      </div>
    </form>
  );
}

function RequestStatus({ r, isAuthor, onResent }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function resend() {
    setBusy(true); setMsg(null);
    try {
      const x = await api("/api/me/author-request/resend", { method: "POST" });
      setMsg(x.emailed ? "Sent again." : "We couldn’t send the email – please try later.");
      onResent();
    } catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  }
  if (r?.status === "pending") {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-sand px-4 py-3 text-ink-soft">
        <p className="m-0">
          {r.emailSentAt
            ? <>We emailed <strong>{r.publisherName || "your publisher"}</strong> ({r.publisherEmail}) on {day(r.emailSentAt)} to confirm you as <strong>{r.penName}</strong>. As soon as they confirm, you’re an author here.</>
            : <>Your request as <strong>{r.penName}</strong> is saved, but we couldn’t email your publisher yet.</>}
        </p>
        {r.canResend && (
          <button type="button" disabled={busy} onClick={resend} className="cursor-pointer self-start bg-transparent p-0 text-sm font-bold text-rust">
            {busy ? "Sending…" : "Send the email again"}
          </button>
        )}
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    );
  }
  if (r?.status === "rejected") {
    return (
      <p className="m-0 rounded-md bg-rust-soft px-4 py-3 text-rust-dark">
        Your request from {day(r.createdAt)} was not confirmed{r.note ? ` – ${r.note}` : ""}. You can send a new one.
      </p>
    );
  }
  if (r?.status === "approved" && !isAuthor) {
    return <p className="m-0 rounded-md bg-moss-soft px-4 py-3 text-moss-dark">Your request was approved{r.note ? ` – ${r.note}` : ""}.</p>;
  }
  return null;
}

const Chevron = ({ open }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
    className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
);

export default function AuthorSection() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false); // the reader's "Are you an author?" box
  const [panel, setPanel] = useState(null); // the author's open panel: "claim" | "upload" | "name"
  const load = useCallback(() => api("/api/me/author").then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (window.location.hash === "#author") setOpen(true); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  if (!data) return null;
  const r = data.request;
  const pendingClaims = data.claims.filter((c) => c.status === "pending");
  const decidedClaims = data.claims.filter((c) => c.status !== "pending");
  const toggle = (p) => setPanel((x) => (x === p ? null : p));

  // ---- an author: "Your books" ----
  if (data.isAuthor) {
    const verified = data.verifiedNames || [];
    return (
      <section id="author" aria-labelledby="author-title" className="card mt-6 flex flex-col gap-5 p-6 text-[15px]">
        <h2 id="author-title" className="m-0 font-serif text-3xl font-semibold">Your books</h2>
        {data.profile && <ProfileEditor userId={data.userId} profile={data.profile} verifiedNames={verified} hasBooks={data.books.length > 0} onSaved={load} />}

        {data.books.length > 0 ? (
          <>
            <p className="m-0 text-ink-soft">
              Your posts in these books’ discussions carry the Author badge.{" "}
              <Link href="/insights#author">See how readers respond →</Link>
            </p>
            <ul className="m-0 grid list-none gap-4 p-0 [grid-template-columns:repeat(auto-fill,minmax(110px,1fr))]">
              {data.books.map((b) => (
                <li key={b.id}>
                  <Link href={`/books/${b.id}`} aria-describedby={hasPeek(b) ? `peek-${b.id}` : undefined} className="group relative flex flex-col gap-1.5 text-sm font-bold text-ink no-underline hover:z-20 hover:text-rust focus-visible:z-20">
                    <div className="relative"><Cover book={b} small /><BookPeek book={b} variant="pop" /></div>{b.title}
                    {data.uploads.includes(b.id) && <span className="text-xs font-normal text-muted">added by you</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="m-0 text-ink-soft">Your publisher confirmed you – welcome! Add your books: find the ones already on BookBridge, or upload a new one.</p>
        )}

        {pendingClaims.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md bg-sand px-4 py-3 text-sm text-ink-soft">
            <strong>Waiting for the team</strong>
            {pendingClaims.map((c) => <span key={c.id}>{c.title} – sent {day(c.createdAt)}</span>)}
          </div>
        )}
        {decidedClaims.map((c) => (
          <p key={c.id} className={`m-0 rounded-md px-4 py-2 text-sm ${c.status === "approved" ? "bg-moss-soft text-moss-dark" : "bg-rust-soft text-rust-dark"}`}>
            {c.title}: {c.status === "approved" ? "linked to you" : "not linked"}{c.note ? ` – ${c.note}` : ""}
          </p>
        ))}

        <div className="flex flex-wrap gap-3">
          <button type="button" aria-expanded={panel === "claim"} onClick={() => toggle("claim")} className={`btn ${panel === "claim" ? "btn-primary" : "btn-outline"}`}>+ Add a book that’s already here</button>
          <button type="button" aria-expanded={panel === "upload"} onClick={() => toggle("upload")} className={`btn ${panel === "upload" ? "btn-primary" : "btn-outline"}`}>+ Upload a new book</button>
        </div>
        {panel === "claim" && <ClaimBooks verifiedNames={verified} onChanged={load} />}
        {panel === "upload" && <UploadBook verifiedNames={verified} onDone={load} onCancel={() => setPanel(null)} />}

        <RequestStatus r={r?.status === "approved" ? null : r} isAuthor onResent={load} />
        {r?.status !== "pending" && (
          panel === "name"
            ? <RequestForm again ready={data.publisherVerification} onCancel={() => setPanel(null)} onSent={() => { setPanel(null); load(); }} />
            : <button type="button" onClick={() => toggle("name")} className="cursor-pointer self-start bg-transparent p-0 text-sm text-rust">Publish under another name too?</button>
        )}
      </section>
    );
  }

  // ---- a reader: "Are you an author?" (closed until opened) ----
  const status = r?.status === "pending" ? "Waiting for publisher" : r?.status === "rejected" ? "Not confirmed" : null;
  return (
    <section id="author" className="card mt-6 text-[15px]">
      <h2 className="m-0">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="author-body"
          className="flex w-full cursor-pointer items-center gap-3 bg-transparent p-6 text-left font-serif text-3xl font-semibold text-ink">
          <span className="flex-1">Are you an author?</span>
          {status && <span className="rounded-md bg-sand px-2.5 py-0.5 font-sans text-xs font-bold uppercase text-ink-soft">{status}</span>}
          <Chevron open={open} />
        </button>
      </h2>
      {open && (
        <div id="author-body" className="flex flex-col gap-4 px-6 pb-6">
          <RequestStatus r={r} isAuthor={false} onResent={load} />
          {r?.status !== "pending" && <RequestForm penName={data.penName} ready={data.publisherVerification} onSent={load} />}
        </div>
      )}
    </section>
  );
}
