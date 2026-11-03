"use client";

// "Upload a new book": every field a book needs. The book is live at once -
// the server computes its content embedding and its similar books, so it can be
// recommended before anyone rates it. Server: POST /api/author/books.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon } from "@/components/Icons";
import { api } from "@/lib/api";

const MIN_DESC = 150;
const MAX_GENRES = 3;

export default function UploadBook({ verifiedNames, onDone, onCancel }) {
  const [options, setOptions] = useState([]);
  const [genres, setGenres] = useState([]);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(null);

  useEffect(() => {
    api("/api/onboarding/questionnaire", { auth: false })
      .then((q) => setOptions(q.steps.find((s) => s.id === "genres")?.options || []))
      .catch(() => setError("Could not load the genre list – try again in a moment."));
  }, []);

  const toggle = (v) => setGenres((g) => (g.includes(v) ? g.filter((x) => x !== v) : g.length >= MAX_GENRES ? g : [...g, v]));

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!genres.length) { setError("Choose at least one genre."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api("/api/author/books", {
        method: "POST",
        body: {
          title: f.get("title"),
          authors: String(f.get("authors") || "").split(",").map((a) => a.trim()).filter(Boolean),
          description: desc,
          genres,
          publishedDate: f.get("publishedDate"),
          pageCount: f.get("pageCount") ? Number(f.get("pageCount")) : null,
          isbn: f.get("isbn") || null,
          seriesName: f.get("seriesName") || null,
          seriesNumber: f.get("seriesNumber") ? Number(f.get("seriesNumber")) : null,
          coverUrl: f.get("coverUrl") || null,
        },
      });
      setAdded({ id: r.bookId, title: f.get("title"), neighbours: r.neighbours });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (added) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-moss-soft px-5 py-4 text-moss-dark">
        <strong>“{added.title}” is on BookBridge.</strong>
        <span className="text-sm">It already has {added.neighbours} similar books, so readers who like them can be offered yours – even before the first rating.</span>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`/books/${added.id}`}>See the book page →</Link>
          <button type="button" onClick={onCancel} className="cursor-pointer bg-transparent p-0 text-moss-dark underline">Close</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Title
          <input name="title" required maxLength={300} className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"><span>Authors <span className="font-normal text-muted">(comma between names – must include your verified name)</span></span>
          <input name="authors" required defaultValue={verifiedNames[0] || ""} className="field font-normal" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Description
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} required minLength={MIN_DESC} maxLength={5000} rows={6}
          placeholder="What the book is about – the back-cover text. It is what “Similar books” and the recommendations use." className="field resize-y font-normal" />
        <span className={`text-xs font-normal ${desc.trim().length < MIN_DESC ? "text-muted" : "text-moss-dark"}`}>
          {desc.trim().length < MIN_DESC ? `${MIN_DESC - desc.trim().length} more characters needed` : `${desc.trim().length} characters ✓`}
        </span>
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-sm font-medium">Genres <span className="font-normal text-muted">(1 to {MAX_GENRES})</span></legend>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = genres.includes(o.value);
            return (
              <button key={o.value} type="button" aria-pressed={on} onClick={() => toggle(o.value)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm ${on ? "border-rust bg-rust text-cream" : "border-line-strong bg-cream text-ink hover:border-ink"}`}>
                {on && <CheckIcon />}{o.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">Published
          <input name="publishedDate" required pattern="\d{4}(-\d{2}(-\d{2})?)?" placeholder="2026 or 2026-05-14" className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Pages <span className="font-normal text-muted">(optional)</span></span>
          <input name="pageCount" type="number" min={1} max={10000} className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium"><span>ISBN <span className="font-normal text-muted">(optional)</span></span>
          <input name="isbn" maxLength={20} placeholder="978-…" className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"><span>Series <span className="font-normal text-muted">(optional)</span></span>
          <input name="seriesName" maxLength={200} placeholder="e.g. The Drowned City" className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium"><span>Book no. <span className="font-normal text-muted">(optional)</span></span>
          <input name="seriesNumber" type="number" min={0.5} max={999} step={0.5} className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-3"><span>Cover image link <span className="font-normal text-muted">(optional – without it the book gets a designed cover)</span></span>
          <input name="coverUrl" type="url" maxLength={500} placeholder="https://…/cover.jpg" className="field font-normal" />
        </label>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} className="btn btn-primary">{busy ? "Adding your book…" : "Add the book"}</button>
        <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>
        {busy && <span className="text-sm text-muted">Reading the description to find similar books – this can take a few seconds.</span>}
      </div>
    </form>
  );
}
