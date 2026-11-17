"use client";

// The author part of the Account page (the "Your books" / "Become an author" section).
// `embedded`: shown as a section of the account settings - always open, no outer margin.
//  - A reader: "Are you an author?" - closed until they open it. The request
//    names the publisher; BookBridge emails the publisher a link to confirm.
//  - An author (confirmed by the publisher): "Your books" - the author page
//    (the VERIFIED name is locked; the shown name, bio and website can be edited),
//    the linked books, "Add a book that's already here" and "Upload a new book".
// Server: GET /api/me/author, PUT /api/me/author/profile, POST /api/me/author-request(/resend),
//         /api/author/... (server/author-verification.js)
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Cover from "@/components/Cover";
import BookPeek, { hasPeek } from "@/components/BookPeek";
import ClaimBooks from "@/components/author/ClaimBooks";
import UploadBook from "@/components/author/UploadBook";
import CoverField from "@/components/author/CoverField";
import { api } from "@/lib/api";

const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// The publisher is chosen from a list (names only - the server knows the emails).
// "My publisher isn't listed" sends the publisher's name to the BookBridge team instead.
// "My publisher isn't listed" -> the team checks it (server/publishers.js) and emails the answer
function PublisherRequestNote({ pr }) {
  if (!pr) return null;
  if (pr.status === "pending") {
    const now = {
      new: <>The BookBridge team will send <b>{pr.publisherName}</b> a short form to join the list (you asked {day(pr.createdAt)}).</>,
      invited: <>We sent <b>{pr.publisherName}</b> a form to join the list – waiting for them to fill it in.</>,
      submitted: <><b>{pr.publisherName}</b> sent its details – the team is checking them.</>,
    }[pr.stage] || <>The BookBridge team is checking <b>{pr.publisherName}</b>.</>;
    return <p className="m-0 rounded-md bg-sand px-4 py-3 text-sm text-ink-soft">{now} We’ll email you when it’s added – then choose it here.</p>;
  }
  if (pr.status === "added") {
    return <p className="m-0 rounded-md bg-moss-soft px-4 py-3 text-sm text-moss-dark"><b>{pr.publisherName}</b> is on the list now{pr.publisherKey ? " – it’s chosen below. Send the form, and we’ll email them to confirm you." : "."}</p>;
  }
  return (
    <p className="m-0 rounded-md bg-rust-soft/50 px-4 py-3 text-sm text-ink">
      We could not add <b>{pr.publisherName}</b>.{pr.note && <> The team wrote: “{pr.note}”</>}
    </p>
  );
}

function RequestForm({ onSent, onCancel, again, penName, ready, publishers = [], publisherRequest = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const listedKey = publisherRequest?.publisherKey && publishers.some((p) => p.key === publisherRequest.publisherKey) ? publisherRequest.publisherKey : "";
  const [publisher, setPublisher] = useState(listedKey); // just added by the team -> chosen already
  const [unlisted, setUnlisted] = useState(false); // the team was told
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const out = await api("/api/me/author-request", {
        method: "POST",
        body: {
          penName: f.get("penName"), books: f.get("books"), publisher,
          publisherName: f.get("publisherName"), publisherContact: f.get("publisherContact"),
          message: f.get("message"), confirm: f.get("confirm") === "on",
        },
      });
      if (out?.unlisted) { setUnlisted(true); setBusy(false); return; }
      onSent();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  if (!ready) return <p className="m-0 text-ink-soft">Author accounts open soon – check back later.</p>;
  if (unlisted) {
    return (
      <div className="flex flex-col gap-3 rounded-md bg-sand px-4 py-3 text-ink-soft">
        <p className="m-0">Thanks! The BookBridge team will check your publisher and email you their answer. Once it’s added, come back and choose it from the list – then we’ll email your publisher to confirm you.</p>
        {onCancel && <button type="button" onClick={onCancel} className="cursor-pointer self-start bg-transparent p-0 text-sm font-bold text-rust">Close</button>}
      </div>
    );
  }
  const other = publisher === "other";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="m-0 text-ink-soft">
        {again
          ? "Publish under another name too? Your publisher confirms it the same way."
          : "Wrote a book? Your posts in its discussion get an Author badge, you can pin a message for your readers, add new books, and see how readers respond to your books."}
      </p>
      {!again && <PublisherRequestNote pr={publisherRequest} />}
      <p className="m-0 rounded-md bg-parchment px-4 py-3 text-sm text-ink-soft">
        <strong>How we confirm it’s you:</strong> we email your publisher a one-time link, and they confirm that you are their author – the way bookstores and streaming services check authors and artists.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Pen name
        <input name="penName" required maxLength={120} defaultValue={again ? "" : penName || ""} placeholder="Exactly as it appears on your books" className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Books you published with them
        <textarea name="books" required maxLength={2000} rows={3} placeholder="One title per line" className="field resize-y font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Your publisher
        <select value={publisher} onChange={(e) => setPublisher(e.target.value)} required className="field font-normal">
          <option value="" disabled>Choose your publisher</option>
          {publishers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          <option value="other" disabled={publisherRequest?.status === "pending"}>My publisher isn’t listed{publisherRequest?.status === "pending" ? " (the team is checking one)" : ""}</option>
        </select>
      </label>
      {other && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">Publisher’s name
            <input name="publisherName" required maxLength={200} placeholder="e.g. Lantern Press" className="field font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Publisher’s email
            <input name="publisherContact" type="email" required maxLength={254} placeholder="rights@lanternpress.com" className="field font-normal" />
          </label>
          <p className="m-0 text-sm text-muted sm:col-span-2">The BookBridge team will send your publisher a short form (company number, ISBN prefix, a document). Once they fill it in and we check it, we add them to the list and email you – then you can ask them to confirm you.</p>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Anything else? <span className="font-normal text-muted">(optional)</span></span>
        <textarea name="message" maxLength={2000} rows={2} className="field resize-y font-normal" />
      </label>
      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4 accent-[var(--color-rust)]" />
        <span>I confirm that I am the author of these books, and agree that BookBridge emails my publisher to check it.</span>
      </label>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || !publisher} className="btn btn-primary">{busy ? "Sending…" : other ? "Send to the BookBridge team" : "Ask my publisher to confirm"}</button>
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
            ? <>We emailed <strong>{r.publisherName || "your publisher"}</strong> on {day(r.emailSentAt)} to confirm you as <strong>{r.penName}</strong>. As soon as they confirm, you’re an author here.</>
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

// Readers' questions on the author's books ("Ask the author" on a book page) - newest first,
// the ones not answered yet marked. Answering = replying in the book's discussion.
function ReaderQuestions() {
  const [data, setData] = useState(null);
  useEffect(() => { api("/api/me/author/questions").then(setData).catch(() => setData({ questions: [], open: 0 })); }, []);
  if (!data) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.15em] text-muted">Questions from readers</h3>
        {data.open > 0 && <span className="rounded-full bg-rust px-2 text-[11px] font-bold text-cream">{data.open} new</span>}
      </div>
      {data.questions.length === 0 ? (
        <p className="m-0 text-sm text-ink-soft">No questions yet. Readers can ask you from your books’ pages (“Ask the author”) – they’ll show up here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.questions.slice(0, 8).map((q) => (
            <li key={q.id} className={`flex flex-col gap-1 rounded-md px-4 py-3 ${q.answered ? "bg-parchment" : "border border-rust/40 bg-cream"}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {!q.answered && <span className="rounded-md bg-rust px-1.5 py-0.5 font-bold uppercase text-cream">New</span>}
                <span>{q.from} · on <em className="font-serif">{q.bookTitle}</em> · {new Date(q.createdAt).toLocaleDateString("en-GB")}</span>
                {q.answered && <span className="text-moss-dark">✓ You answered</span>}
              </div>
              <p className="m-0 line-clamp-3 text-[15px] text-ink">{q.body}</p>
              <Link href={`/books/${q.bookId}#readers`} className="self-start text-sm font-bold">{q.answered ? "See the conversation →" : "Answer it →"}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A pop-up over the page (the same look as "Plan your visit"): Escape, the × or a click outside closes it
function Dialog({ title, subtitle, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind does not scroll
    box.current?.querySelector("input, select, textarea, button")?.focus();
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(239,221,191,0.85)] backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={box} onClick={(e) => e.stopPropagation()}
        className="quiet-scroll swap-in relative flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-y-auto rounded-t-lg border border-line-strong bg-cream shadow-[0_24px_50px_rgba(90,60,30,0.3)] sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-cream px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="m-0 font-serif text-2xl font-semibold">{title}</h2>
            {subtitle && <p className="m-0 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line-strong bg-transparent text-xl leading-none text-ink-soft hover:border-ink hover:text-ink">×</button>
        </div>
        <div className="p-6 text-[15px]">{children}</div>
      </div>
    </div>
  );
}

// Change the cover of a book the author uploaded: a picture file or a link (server/book-covers.js)
function CoverEditor({ book, onSaved, onCancel }) {
  const [cover, setCover] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function save(remove = false) {
    setBusy(true); setError(null);
    try {
      if (remove) await api(`/api/author/books/${book.id}/cover`, { method: "DELETE" });
      else await api(`/api/author/books/${book.id}/cover`, { method: "PUT", body: cover.image ? { image: cover.image } : { url: cover.url } });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-4">
      <CoverField value={cover} onChange={setCover} current={book.thumbnail_url} />
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !(cover.image || cover.url?.trim())} onClick={() => save()} className="btn btn-primary">{busy ? "Saving…" : "Save cover"}</button>
        <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>
        {book.thumbnail_url && <button type="button" disabled={busy} onClick={() => save(true)} className="cursor-pointer bg-transparent p-0 text-sm text-muted underline">Remove the cover</button>}
      </div>
    </div>
  );
}

const Chevron = ({ open }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
    className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
);

export default function AuthorSection({ embedded = false }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false); // the reader's "Are you an author?" box
  const [panel, setPanel] = useState(null); // the author's open panel: "claim" | "upload" | "name"
  const load = useCallback(() => api("/api/me/author").then(setData).catch(() => setData(null)), []);
  const closePanel = useCallback(() => setPanel(null), []); // stable, so the pop-up's effect doesn't re-run
  const [coverOf, setCoverOf] = useState(null); // the book whose cover is being changed
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (window.location.hash === "#author") setOpen(true); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  if (!data) return null;
  const r = data.request;
  const pendingClaims = data.claims.filter((c) => c.status === "pending");
  const decidedClaims = data.claims.filter((c) => c.status !== "pending");

  // ---- an author: "Your books" ----
  if (data.isAuthor) {
    const verified = data.verifiedNames || [];
    return (
      <section id="author" aria-labelledby="author-title" className={`card flex flex-col gap-6 p-6 text-[15px] md:p-8 ${embedded ? "" : "mt-6"}`}>
        <div className="flex flex-col gap-1 border-b border-line pb-4">
          <h2 id="author-title" className="m-0 font-serif text-3xl font-semibold">Your books</h2>
          <p className="m-0 text-ink-soft">Your author page, your books, and how readers respond to them.</p>
        </div>
        {data.profile && (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.15em] text-muted">Your author page</h3>
            <ProfileEditor userId={data.userId} profile={data.profile} verifiedNames={verified} hasBooks={data.books.length > 0} onSaved={load} />
          </div>
        )}

        {data.books.length > 0 && <ReaderQuestions />}

        {data.books.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.15em] text-muted">My books · {data.books.length}</h3>
              <Link href="/insights#author" className="text-sm">See how readers respond →</Link>
            </div>
            <p className="m-0 text-sm text-ink-soft">Your posts in these books’ discussions carry the Author badge.</p>
            <ul className="m-0 grid list-none gap-5 p-0 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
              {data.books.map((b) => (
                <li key={b.id}>
                  <Link href={`/books/${b.id}`} aria-describedby={hasPeek(b) ? `peek-${b.id}` : undefined} className="group relative flex flex-col gap-1.5 text-sm font-bold text-ink no-underline hover:z-20 hover:text-rust focus-visible:z-20">
                    <div className="relative"><Cover book={b} small /><BookPeek book={b} variant="pop" /></div>{b.title}
                    {data.uploads.includes(b.id) && <span className="text-xs font-normal text-muted">added by you</span>}
                  </Link>
                  {data.uploads.includes(b.id) && (
                    <button type="button" aria-haspopup="dialog" onClick={() => { setCoverOf(b); setPanel("cover"); }}
                      className="mt-0.5 cursor-pointer bg-transparent p-0 text-xs text-rust underline">Change cover</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
          <button type="button" aria-haspopup="dialog" onClick={() => setPanel("claim")} className="btn btn-outline">+ Add a book that’s already here</button>
          <button type="button" aria-haspopup="dialog" onClick={() => setPanel("upload")} className="btn btn-outline">+ Upload a new book</button>
        </div>
        {panel === "claim" && (
          <Dialog title="Add a book that’s already here" subtitle="Find your book in the BookBridge catalog and link it to you." onClose={closePanel}>
            <ClaimBooks verifiedNames={verified} onChanged={load} />
          </Dialog>
        )}
        {panel === "cover" && coverOf && (
          <Dialog title="Change the cover" subtitle={coverOf.title} onClose={closePanel}>
            <CoverEditor book={coverOf} onSaved={() => { closePanel(); load(); }} onCancel={closePanel} />
          </Dialog>
        )}
        {panel === "upload" && (
          <Dialog title="Upload a new book" subtitle="It goes live at once – readers who like similar books can be offered it." onClose={closePanel}>
            <UploadBook verifiedNames={verified} onDone={load} onCancel={closePanel} />
          </Dialog>
        )}

        <RequestStatus r={r?.status === "approved" ? null : r} isAuthor onResent={load} />
        {r?.status !== "pending" && (
          <button type="button" aria-haspopup="dialog" onClick={() => setPanel("name")} className="cursor-pointer self-start bg-transparent p-0 text-sm text-rust">Publish under another name too?</button>
        )}
        {panel === "name" && (
          <Dialog title="Publish under another name" onClose={closePanel}>
            <RequestForm again ready={data.publisherVerification} publishers={data.publishers} publisherRequest={data.publisherRequest} onCancel={closePanel} onSent={() => { closePanel(); load(); }} />
          </Dialog>
        )}
      </section>
    );
  }

  // ---- a reader: "Are you an author?" (closed until opened) ----
  const status = r?.status === "pending" ? "Waiting for publisher" : r?.status === "rejected" ? "Not confirmed" : null;
  if (embedded) {
    return (
      <section id="author" aria-labelledby="author-title" className="card flex flex-col gap-5 p-6 text-[15px] md:p-8">
        <div className="flex flex-col gap-1 border-b border-line pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="author-title" className="m-0 font-serif text-3xl font-semibold">Become an author</h2>
            {status && <span className="rounded-md bg-sand px-2.5 py-0.5 text-xs font-bold uppercase text-ink-soft">{status}</span>}
          </div>
          <p className="m-0 text-ink-soft">Wrote a book? Get an author page, an Author badge in its discussions, and see how readers respond.</p>
        </div>
        <RequestStatus r={r} isAuthor={false} onResent={load} />
        {r?.status !== "pending" && <RequestForm penName={data.penName} ready={data.publisherVerification} publishers={data.publishers} publisherRequest={data.publisherRequest} onSent={load} />}
      </section>
    );
  }
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
          {r?.status !== "pending" && <RequestForm penName={data.penName} ready={data.publisherVerification} publishers={data.publishers} publisherRequest={data.publisherRequest} onSent={load} />}
        </div>
      )}
    </section>
  );
}
