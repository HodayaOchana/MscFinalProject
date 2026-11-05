"use client";

// Search the catalog by title or author - or by a READER TAG with # ("#dystopian"):
// typing # shows tag suggestions. /search?q=%23vampires opens with that search
// (the #chips on a book page link here). Your searches are saved (server/search-history.js)
// and shown like Google: click into the box and your recent searches drop down
// under it (filtered by what you type). Click one to search again, × to remove
// it, "Clear all" to remove them all; ↑ ↓ Enter and Esc work too. The × inside
// the box clears it and the results. Opening a result is saved with its search (for the
// recommender later).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import BookPeek from "@/components/BookPeek";
import { SearchIcon, XIcon, ChatIcon } from "@/components/Icons";
import { api } from "@/lib/api";

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const norm = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n) => (n ?? 0).toLocaleString("en-US");
const TagIcon = () => <span aria-hidden="true" className="w-4 text-center font-bold">#</span>;

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState("");
  const [recent, setRecent] = useState([]);
  const [searchId, setSearchId] = useState(null); // the saved search the results belong to
  const [open, setOpen] = useState(false);       // the recent-searches list under the box
  const [active, setActive] = useState(-1);      // highlighted item (arrow keys)
  const [tags, setTags] = useState([]);          // tag suggestions while typing "#..."
  const [mode, setMode] = useState(null);        // the last results: "text" | "tag"
  const [foundTag, setFoundTag] = useState(null);
  const input = useRef(null);
  const box = useRef(null);

  const loadRecent = () => api("/api/me/searches").then((r) => setRecent(r.searches)).catch(() => {});
  useEffect(() => { loadRecent(); }, []);

  // /search?q=...  (e.g. a #tag chip on a book page): search at once
  useEffect(() => {
    const first = new URLSearchParams(window.location.search).get("q");
    if (first) run(first);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "#..." -> tag suggestions (a short pause after typing, so not every key asks the server)
  const tagMode = q.trimStart().startsWith("#");
  useEffect(() => {
    if (!tagMode) return;
    const t = setTimeout(() => {
      api(`/api/books/tags?q=${encodeURIComponent(q.trim().replace(/^#+/, ""))}`, { auth: false })
        .then((r) => setTags(r.tags)).catch(() => setTags([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q, tagMode]);

  // close the list when clicking anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // what the list shows: all recent searches, or those containing what is typed
  const typed = norm(q);
  const shown = recent.filter((r) => !typed || (norm(r.query).includes(typed) && norm(r.query) !== typed));
  // one list for the keyboard: tag suggestions (only after "#"), then recent searches
  const tagItems = tagMode ? tags.filter((t) => norm(`#${t.tag}`) !== typed) : [];
  const items = [...tagItems.map((t) => ({ kind: "tag", query: `#${t.tag}`, books: t.books })), ...shown.map((r) => ({ kind: "recent", query: r.query }))];

  async function run(text) {
    const term = text.trim();
    setOpen(false); setActive(-1);
    const isTag = term.startsWith("#");
    if ((isTag ? term.replace(/^#+/, "").trim() : term).length < 2) { setError(isTag ? "Type at least 2 letters after #." : "Type at least 2 letters."); return; }
    setError(null); setQ(term);
    try {
      const r = await api(`/api/books/search?q=${encodeURIComponent(term)}`, { auth: false });
      setResults(r.books); setSearched(term); setSearchId(null); setMode(r.mode || "text"); setFoundTag(r.tag || null);
      // the address shows the search, so Back and a shared link return to it
      window.history.replaceState(null, "", `/search?q=${encodeURIComponent(term)}`);
      // save it - only if it found something (a failure here never blocks the search itself)
      if (r.books.length > 0) {
        api("/api/me/searches", { method: "POST", body: { query: term, resultsCount: r.books.length, topBookIds: r.books.slice(0, 3).map((b) => b.id) } })
          .then((s) => { setSearchId(s.id); loadRecent(); })
          .catch(() => {});
      }
    } catch (err) { setError(err.message); }
  }
  const search = (e) => { e.preventDefault(); run(active >= 0 && items[active] ? items[active].query : q); };

  function onKey(e) {
    if (e.key === "Escape") { setOpen(false); setActive(-1); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const n = items.length;
      if (!n) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
    }
  }
  // the × in the box: empty the box AND the results under it, back to a fresh search
  function clearBox() {
    setQ(""); setActive(-1); setOpen(true);
    setResults(null); setSearched(""); setSearchId(null); setError(null); setMode(null);
    window.history.replaceState(null, "", "/search");
    input.current?.focus();
  }

  function opened(bookId) {
    if (searchId) api(`/api/me/searches/${searchId}/click`, { method: "POST", body: { bookId } }).catch(() => {});
  }
  async function forget(query) {
    setRecent((r) => r.filter((x) => x.query !== query)); setActive(-1);
    input.current?.focus();
    await api(`/api/me/searches?query=${encodeURIComponent(query)}`, { method: "DELETE" }).catch(() => loadRecent());
  }
  async function clearAll() {
    setRecent([]); setOpen(false);
    await api("/api/me/searches", { method: "DELETE" }).catch(() => loadRecent());
  }

  const listOpen = open && items.length > 0;

  return (
    <AppShell width="max-w-[1000px]">
      <div className="flex flex-col gap-6">
        <div className="relative isolate z-40 flex flex-col gap-6"> {/* z-40: the recent-searches list opens OVER the results */}
        {/* soft warm colours behind the box, so its frosted glass has something to blur */}
        <div aria-hidden="true" className="pointer-events-none absolute -inset-x-6 -bottom-16 -top-10 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_72%)]">
          <div className="absolute left-[8%] top-[38%] h-44 w-72 rounded-full bg-[#C8673A] opacity-35 blur-3xl" />
          <div className="absolute left-[42%] top-[50%] h-40 w-64 rounded-full bg-[#D9A54A] opacity-35 blur-3xl" />
          <div className="absolute right-[6%] top-[30%] h-44 w-72 rounded-full bg-[#6F8247] opacity-30 blur-3xl" />
        </div>
        <h1 className="m-0 font-serif text-5xl font-semibold">Find a book</h1>
        <div ref={box} className="relative z-40">
          <form onSubmit={search} role="search"
            className={`flex items-center gap-3 border border-white/70 bg-[rgba(255,251,244,0.45)] py-1.5 pl-5 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_30px_rgba(43,33,28,0.10)] backdrop-blur-xl backdrop-saturate-150 transition-[border-color,background-color] focus-within:border-white focus-within:bg-[rgba(255,251,244,0.6)] focus-within:ring-2 focus-within:ring-[rgba(162,75,37,0.35)] ${listOpen ? "rounded-t-[26px] border-b-transparent" : "rounded-full"}`}>
            <span className="text-muted"><SearchIcon /></span>
            <label htmlFor="q" className="sr-only">Search by title, author or #tag</label>
            <input id="q" ref={input} value={q} autoComplete="off" placeholder="Title, author or #tag"
              onChange={(e) => { setQ(e.target.value); setActive(-1); setOpen(true); }}
              onFocus={() => setOpen(true)} onKeyDown={onKey}
              role="combobox" aria-expanded={listOpen} aria-controls="recent-list" aria-autocomplete="list"
              aria-activedescendant={listOpen && active >= 0 ? `recent-${active}` : undefined}
              className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-[17px] text-ink outline-none" style={{ outline: "none" }} /* the whole box shows the focus ring instead */ />
            {q && (
              <button type="button" onClick={clearBox} aria-label="Clear the search box"
                className="flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full bg-transparent text-muted hover:bg-sand hover:text-ink">
                <XIcon />
              </button>
            )}
            <button className="btn btn-dark px-5 py-2.5">Search</button>
          </form>
          {listOpen && (
            <div className="absolute inset-x-0 top-full overflow-hidden rounded-b-[26px] border border-t-0 border-white/70 bg-[rgba(255,251,244,0.82)] pb-2 shadow-[0_18px_30px_rgba(43,33,28,0.18)] backdrop-blur-xl backdrop-saturate-150">
              <div className="mx-5 border-t border-[rgba(43,33,28,0.12)]" />
              <ul id="recent-list" role="listbox" aria-label={tagMode ? "Tags and recent searches" : "Recent searches"} className="m-0 list-none p-0 pt-1">
                {items.map((it, i) => (
                  <li key={`${it.kind}-${it.query}`} id={`recent-${i}`} role="option" aria-selected={i === active}
                    className={`group/item flex items-center gap-3 pl-5 pr-2 ${i === active ? "bg-white/50" : "hover:bg-white/35"}`}>
                    <span className={it.kind === "tag" ? "text-rust" : "text-muted"}>{it.kind === "tag" ? <TagIcon /> : <ClockIcon />}</span>
                    <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => run(it.query)}
                      className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 bg-transparent py-2.5 text-left text-[16px] text-ink">
                      <span className="truncate">{it.kind === "tag" ? it.query.slice(1) : it.query}</span>
                      {it.kind === "tag" && <span className="flex-none text-xs text-muted">{fmt(it.books)} book{it.books === 1 ? "" : "s"}</span>}
                    </button>
                    {it.kind === "recent" && (
                      <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => forget(it.query)}
                        aria-label={`Remove “${it.query}” from recent searches`}
                        className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full bg-transparent text-muted opacity-60 hover:bg-cream hover:text-ink hover:opacity-100 group-hover/item:opacity-100 [&_svg]:h-4 [&_svg]:w-4">
                        <XIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!typed && shown.length > 0 && (
                <div className="flex justify-end px-5 pt-1">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clearAll}
                    className="cursor-pointer bg-transparent p-0 text-xs text-muted underline underline-offset-2 hover:text-rust">Clear all recent searches</button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
        {error && <p role="alert" className="m-0 text-rust-dark">{error}</p>}
        {results && (
          <span className="text-sm text-muted">
            {mode === "tag"
              ? <>{results.length} book{results.length === 1 ? "" : "s"} readers tagged <strong className="text-rust">#{foundTag}</strong>{results.length === 30 ? " (the 30 most tagged)" : ""}</>
              : <>{results.length} result{results.length === 1 ? "" : "s"} for “{searched}” – by title or author</>}
          </span>
        )}
        {!results && !error && <p className="m-0 text-sm text-muted">Tip: type <strong>#</strong> to search by what readers say about a book – #dystopian, #coming of age, #made me cry.</p>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(results || []).map((b) => (
            <li key={b.id} onClickCapture={(e) => { if (e.target.closest("a")) opened(b.id); }} className="group card relative flex flex-wrap items-center gap-4 px-4 py-3.5 hover:z-30">
              <Cover book={b} small className="w-[52px] flex-none" />
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                <Link href={`/books/${b.id}`} className="text-[17px] font-bold text-ink no-underline hover:text-rust">{b.title}</Link>
                <span className="text-sm text-muted">{(b.authors || []).join(", ")}</span>
                {b.match === "tag" && <span className="self-start rounded-full bg-rust-soft px-2.5 py-0.5 text-xs text-rust-dark">#{b.tag} · {fmt(b.tag_count)} readers</span>}
              </div>
              {/* ask the chatbot: is it for me, what is similar, where to borrow it */}
              <Link href={`/chat?book=${b.id}&ask=1`} aria-label={`Ask BookBridge about ${b.title}`} className="flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2.5 text-sm text-ink no-underline hover:border-ink"><ChatIcon />Ask</Link>
              <Link href={`/books/${b.id}`} className="rounded-full border border-line-strong px-4 py-2.5 text-sm text-ink no-underline hover:border-ink">View</Link>
              {/* on hover the row grows into a floating card: bigger cover, rating, blurb */}
              <BookPeek book={b} variant="row">
                <div className="flex items-center gap-4">
                  <Cover book={b} small className="w-[72px] flex-none" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-serif text-xl font-semibold leading-tight">{b.title}</span>
                    <span className="text-sm text-muted">{(b.authors || []).join(", ")}</span>
                  </div>
                  <Link href={`/chat?book=${b.id}&ask=1`} tabIndex={-1} className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line-strong bg-cream px-4 py-2.5 text-sm text-ink no-underline hover:border-ink"><ChatIcon />Ask BookBridge</Link>
                  <span className="rounded-full bg-ink px-4 py-2.5 text-sm text-parchment">View</span>
                </div>
              </BookPeek>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
