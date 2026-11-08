"use client";

// Questionnaire, step 2: books the reader loves (search by title or writer - each one is a 5★
// rating, the strongest start for the engine), then ~20 books from the chosen genres to rate
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OnboardingHeader from "@/components/OnboardingHeader";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import { api } from "@/lib/api";
import { loadGenres } from "@/lib/onboarding-state";
import { SearchIcon, XIcon } from "@/components/Icons";

const LOVED = "loved"; // the group of books the reader found by search
const MAX_LOVED = 10;

// "A book or writer you love": search the catalog (title or author), pick from the list
function LovedSearch({ onPick, chosen }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const asked = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setResults([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const n = ++asked.current;
    const t = setTimeout(() => {
      api(`/api/books/search?q=${encodeURIComponent(text)}`, { auth: false })
        .then((r) => { if (n === asked.current) { setResults(r.books.slice(0, 7)); setOpen(true); } })
        .catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (b) => { onPick(b); setQ(""); setResults([]); setOpen(false); };
  return (
    <div className="relative w-full max-w-[560px]" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label className="flex items-center gap-2.5 rounded-md border border-line-strong bg-cream px-4 py-3 focus-within:border-rust">
        <span className="text-muted"><SearchIcon /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); pick(results[0]); } if (e.key === "Escape") setOpen(false); }}
          placeholder="A title or a writer…" aria-label="Search a book or writer you love"
          role="combobox" aria-expanded={open && results.length > 0} aria-controls="loved-results" aria-autocomplete="list"
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-muted" />
      </label>
      {open && results.length > 0 && (
        <ul id="loved-results" role="listbox" className="absolute inset-x-0 top-full z-30 m-0 mt-1.5 list-none overflow-hidden rounded-md border border-line-strong bg-cream p-1 shadow-[0_16px_40px_rgba(60,35,15,0.2)]">
          {results.map((b) => {
            const has = chosen.has(b.id);
            return (
              <li key={b.id} role="option" aria-selected={has}>
                <button type="button" disabled={has} onClick={() => pick(b)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2.5 py-2 text-start text-ink hover:bg-sand disabled:cursor-default disabled:opacity-60">
                  <Cover book={b} small className="w-8 flex-none" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-semibold">{b.title}</span>
                    <span className="truncate text-[13px] text-muted">{(b.authors || [])[0]}</span>
                  </span>
                  <span className="ml-auto flex-none text-xs font-bold text-rust">{has ? "Added" : "+ Add"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function RatePage() {
  const router = useRouter();
  const [genres] = useState(() => loadGenres());
  const [labels, setLabels] = useState({});
  const [books, setBooks] = useState(null);
  const [stars, setStars] = useState({}); // bookId -> 1..5 (missing = haven't read)
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const g = genres;
    if (!g.length) { router.replace("/onboarding/genres"); return; }
    api("/api/onboarding/questionnaire", { auth: false }).then((q) => {
      const opts = q.steps.find((s) => s.id === "genres").options;
      setLabels(Object.fromEntries(opts.map((o) => [o.value, o.label])));
    }).catch(() => {});
    api("/api/onboarding/books", { method: "POST", body: { genres: g }, auth: false })
      .then((r) => setBooks(r.books))
      .catch((e) => setError(e.message));
  }, [router, genres]);

  const groups = useMemo(() => {
    if (!books) return [];
    return [LOVED, ...genres].map((g) => ({ key: g, books: books.filter((b) => b.genre === g) })).filter((x) => x.books.length);
  }, [books, genres]);
  const loved = (books || []).filter((b) => b.genre === LOVED);

  // a book found by search: on top, with 5 stars (the reader can change them). Already in the list: just 5★.
  function addLoved(b) {
    if (!books.some((x) => x.id === b.id)) {
      if (loved.length >= MAX_LOVED) return;
      setBooks((bs) => [{ ...b, genre: LOVED }, ...bs]);
    }
    setStars((s) => ({ ...s, [b.id]: s[b.id] || 5 }));
  }
  function removeLoved(id) {
    setBooks((bs) => bs.filter((b) => b.id !== id));
    setStars((s) => ({ ...s, [id]: 0 }));
  }

  const rated = Object.values(stars).filter(Boolean).length;

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/me/onboarding", {
        method: "POST",
        body: { genres, answers: books.map((b) => ({ bookId: b.id, stars: stars[b.id] || null })) },
      });
      router.push("/for-you");
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full">
      <OnboardingHeader step={2} />
      <main className="mx-auto flex max-w-[1120px] flex-col gap-9 px-6 pb-32 pt-6 md:px-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h1 className="m-0 font-serif text-5xl font-semibold md:text-[52px]">Rate the books you have read</h1>
          <p className="m-0 max-w-[640px] text-lg text-ink-soft">Well-known books from your genres. Leave the rest as “Haven&apos;t read” – the more you rate, the sharper your picks.</p>
        </div>
        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {books && (
          <section aria-labelledby="loved-title" className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
            <h2 id="loved-title" className="m-0 font-serif text-2xl font-semibold">Start with books you love</h2>
            <p className="m-0 max-w-[560px] text-ink-soft">Name a few favourites (<em>Pride and Prejudice</em>) or a writer (<em>Le Guin</em>) and pick their books. Each one tells us more than any list.</p>
            <LovedSearch onPick={addLoved} chosen={new Set(loved.map((b) => b.id))} />
            {loved.length >= MAX_LOVED && <span className="text-sm text-muted">That&apos;s plenty – rate the rest below.</span>}
          </section>
        )}
        {!books && !error && <p className="text-center text-muted">Choosing books for you…</p>}
        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-4">
            <h2 className="m-0 border-b border-line pb-2 font-serif text-3xl font-semibold">{g.key === LOVED ? "Books you love" : labels[g.key] || g.key}</h2>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {g.books.map((b) => (
                <article key={b.id} className="card flex gap-3.5 p-3.5">
                  <Cover book={b} small className="w-[72px] flex-none" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h3 className="m-0 text-[15px] font-bold leading-snug">{b.title}</h3>
                    <span className="text-[13px] text-muted">{(b.authors || []).join(", ")}</span>
                    <div className="mt-auto">
                      <Stars value={stars[b.id] || 0} onChange={(n) => setStars((s) => ({ ...s, [b.id]: n }))} label={`Rate ${b.title}`} />
                    </div>
                    {g.key === LOVED ? (
                      <button type="button" onClick={() => removeLoved(b.id)}
                        className="flex cursor-pointer items-center gap-1 self-start rounded-md border border-line-strong bg-cream px-2.5 py-1 text-xs text-ink-soft hover:border-rust hover:text-rust-dark">
                        <XIcon />Remove
                      </button>
                    ) : (
                      <button type="button" aria-pressed={!stars[b.id]} onClick={() => setStars((s) => ({ ...s, [b.id]: 0 }))}
                        className={`cursor-pointer self-start rounded-md border px-2.5 py-1 text-xs text-ink-soft ${stars[b.id] ? "border-line-strong bg-cream" : "border-muted bg-sand"}`}>
                        Haven&apos;t read
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </main>
      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-cream px-6 py-4 md:px-12">
        <span className="text-ink-soft" aria-live="polite">{rated} rated{books ? ` · ${books.length} books` : ""}</span>
        <div className="flex flex-wrap gap-3">
          <Link href="/onboarding/genres" className="btn btn-outline">Back</Link>
          <button type="button" onClick={finish} disabled={!books || saving} className="btn btn-primary">{saving ? "Picking your books…" : "Show my picks"}</button>
        </div>
      </div>
    </div>
  );
}
