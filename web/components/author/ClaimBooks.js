"use client";

// "Add a book that's already here": search the catalog and say "this is my book".
//   name on the book = your verified name -> linked at once
//   another name (co-author, earlier name...) -> a claim the team checks
// Server: GET /api/author/search, POST /api/author/claims (server/author-verification.js)
import { useEffect, useState } from "react";
import Cover from "@/components/Cover";
import { api } from "@/lib/api";

function Row({ b, onLinked }) {
  const [state, setState] = useState(b.mine ? "mine" : b.pending ? "pending" : "idle");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  async function claim(message) {
    setState("busy"); setError(null);
    try {
      const r = await api("/api/author/claims", { method: "POST", body: { bookId: b.id, message } });
      setState(r.linked ? "mine" : "pending");
      setAsking(false);
      onLinked();
    } catch (err) { setError(err.message); setState("idle"); }
  }
  return (
    <li className="flex flex-col gap-2 rounded-md p-2 hover:bg-cream">
      <div className="flex items-center gap-3">
        <Cover book={b} small className="w-10 flex-none" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-bold">{b.title}</span>
          <span className="block text-muted">{b.authors?.join(", ") || "Unknown author"}{b.published_date ? ` · ${String(b.published_date).slice(0, 4)}` : ""}</span>
        </span>
        {state === "mine" && <span className="text-sm font-bold text-moss-dark">✓ Yours</span>}
        {state === "pending" && <span className="text-sm text-ink-soft">Waiting for the team</span>}
        {state === "busy" && <span className="text-sm text-muted">…</span>}
        {state === "idle" && b.matchesYou && <button type="button" onClick={() => claim(null)} className="btn btn-primary !px-4 !py-2 text-sm">This is my book</button>}
        {state === "idle" && !b.matchesYou && !asking && <button type="button" onClick={() => setAsking(true)} className="btn btn-outline !px-4 !py-2 text-sm">This is my book…</button>}
      </div>
      {asking && state === "idle" && (
        <div className="ml-[52px] flex flex-col gap-2">
          <p className="m-0 text-[13px] text-ink-soft">The name on this book is not your verified name, so the BookBridge team will check it. Tell them why it is yours:</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. I am the co-author / my name before 2015" className="field text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={() => claim(note)} className="btn btn-primary !px-4 !py-2 text-sm">Send to the team</button>
            <button type="button" onClick={() => setAsking(false)} className="btn btn-outline !px-4 !py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 ml-[52px] text-sm text-rust-dark">{error}</p>}
    </li>
  );
}

export default function ClaimBooks({ verifiedNames, onChanged }) {
  const [q, setQ] = useState(verifiedNames[0] || "");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = setTimeout(() => {
      api(`/api/author/search?q=${encodeURIComponent(query)}`).then((r) => { setResults(r.books); setError(null); }).catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">Find your book in the catalog
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or author name…" className="field font-normal" />
      </label>
      <p className="m-0 text-[13px] text-muted">Books with your verified name ({verifiedNames.join(" / ")}) are linked at once. For any other book, the team checks first.</p>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      {results && q.trim().length >= 2 && (results.length
        ? <ul className="m-0 flex max-h-[420px] list-none flex-col gap-1 overflow-auto p-0">{results.map((b) => <Row key={b.id} b={b} onLinked={onChanged} />)}</ul>
        : <p className="m-0 text-sm text-muted">No book found. Not in the catalog? Upload it as a new book.</p>)}
    </div>
  );
}
