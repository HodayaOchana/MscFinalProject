"use client";

// One book (rendered by app/books/[id]/page.js). A calm opening - the book, what readers think, bookmark
// and rate; then "What you need to know" (length, readers, feel, nearby), a few lines readers wrote,
// the readers (reviews + discussion) and similar books.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NotFoundView from "@/components/NotFoundView";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import LibraryVisit from "@/components/LibraryVisit";
import { PinIcon, BookmarkIcon, OpenBookIcon, CheckIcon, ChatIcon } from "@/components/Icons";
import BookPeek, { hasPeek } from "@/components/BookPeek";
import Stars from "@/components/Stars";
import ShelfRow from "@/components/ShelfRow";
import BookshelfLoader from "@/components/BookshelfLoader";
import BookSocial from "@/components/pages/BookSocial";
import { api } from "@/lib/api";
import { useWormPage } from "@/lib/worm";
import { addedToBasket } from "@/lib/basket";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];
const NEAR_KM = 10;          // "Near me": branches this close
const cityPlace = (city) => ({ kind: "city", city, label: city === "Tel Aviv-Yafo" ? "Tel Aviv" : city, query: `city=${encodeURIComponent(city)}` });
const SIMILAR_FIRST = 12; // a shelf that scrolls sideways: 12 first,
const SIMILAR_PAGE = 6;   // then 6 more each time you reach its end (the server stops at 30)
const year = (d) => (d ? String(d).slice(0, 4) : null);

// The book's authors; a name that belongs to an author account on BookBridge links to their page.
// Matched by name (pen name = author name); if no name matches, the first author links to the first account.
function AuthorNames({ names, accounts }) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const used = new Set();
  const linkOf = names.map((n) => {
    const a = accounts.find((x) => !used.has(x.userId) && norm(x.penName) === norm(n));
    if (a) used.add(a.userId);
    return a || null;
  });
  if (accounts.length && !used.size && names.length) linkOf[0] = accounts[0];
  return names.map((n, i) => (
    <span key={n + i}>
      {i > 0 && ", "}
      {linkOf[i]
        ? <Link href={`/authors/${linkOf[i].userId}`} title="Author page on BookBridge" className="text-rust">{n}</Link>
        : n}
    </span>
  ));
}

const MIN_RATINGS = 20;     // fewer ratings than this - no "% loved it"
const PAGES_PER_HOUR = 45;  // an average reading pace, for "~7 h"
const GENERIC_TAGS = new Set(["fiction", "adult fiction", "adult", "classics", "contemporary fiction", "literary fiction", "audible", "books", "novels", "default"]);
const QUOTE_CHARS = 140;

// up to 3 short lines from the reviews: the best rated first, each cut at a word
function pickQuotes(reviews) {
  return reviews.filter((r) => r.body?.trim().length >= 20)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 3)
    .map((r) => {
      const t = r.body.replace(/\s+/g, " ").trim();
      return { ...r, quote: t.length > QUOTE_CHARS ? `${t.slice(0, QUOTE_CHARS).replace(/\s+\S*$/, "")}…` : t };
    });
}

// "Nearby": search a city or a branch, or use the reader's location
let librariesOnce = null; // the branch list (27 branches), loaded once
function PlaceSearch({ place, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [libraries, setLibraries] = useState([]);
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState(false);
  // ready before the search opens - typing "baka" + Enter right away still finds the branch
  useEffect(() => {
    (librariesOnce ??= api("/api/libraries", { auth: false }).then((r) => r.libraries).catch(() => { librariesOnce = null; return []; }))
      .then(setLibraries);
  }, []);

  const t = q.trim().toLowerCase();
  const hit = (...words) => !t || words.some((w) => String(w || "").toLowerCase().includes(t));
  const options = [
    ...(hit("near me", "my location", "here") ? [{ key: "near", label: "📍 Near me", hint: `within ${NEAR_KM} km` }] : []),
    ...CITIES.filter((c) => hit(c, cityPlace(c).label)).map((c) => ({ key: `c-${c}`, label: cityPlace(c).label, hint: "all branches", pick: cityPlace(c) })),
    ...libraries.filter((l) => hit(l.name, l.city, l.address)).slice(0, 8).map((l) => ({
      key: `l-${l.id}`, label: l.name, hint: l.city === "Tel Aviv-Yafo" ? "Tel Aviv" : l.city,
      pick: { kind: "library", id: l.id, label: l.name, query: `city=${encodeURIComponent(l.city)}` },
    })),
  ];
  function choose(o) {
    if (!o) return;
    setOpen(false); setQ("");
    if (o.pick) return onPick(o.pick);
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocating(false); onPick({ kind: "near", label: "near you", query: `lat=${coords.latitude.toFixed(4)}&lng=${coords.longitude.toFixed(4)}&radiusKm=${NEAR_KM}` }); },
      () => setLocating(false),
      { timeout: 10000, maximumAge: 600000 }
    );
  }
  return (
    <span className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="cursor-pointer bg-transparent p-0 text-xs text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink">
        {locating ? "Locating…" : place.label} ▾
      </button>
      {open && (
        <span className="absolute -left-[150px] top-full z-40 mt-2 flex w-[260px] flex-col gap-1 md:left-0 rounded-md border border-line-strong bg-cream p-2 shadow-[0_10px_30px_rgba(60,35,15,0.18)]">
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="A city or a library…" aria-label="Search a city or a library"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
              if (e.key === "Escape") setOpen(false);
            }}
            className="field !px-2.5 !py-1.5 text-sm" />
          <span role="listbox" aria-label="Places" className="quiet-scroll flex max-h-[240px] flex-col overflow-y-auto">
            {options.length === 0 && <span className="px-2.5 py-2 text-xs text-muted">No branch by that name – BookBridge has libraries in Jerusalem and Tel Aviv.</span>}
            {options.map((o, i) => (
              <button key={o.key} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm ${i === active ? "bg-rust-soft text-rust-dark" : "bg-transparent text-ink"}`}>
                <span className="truncate">{o.label}</span><span className="shrink-0 text-[11px] text-muted">{o.hint}</span>
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

// one tile of "What you need to know": a small label, one big value, a short note
function Fact({ label, value, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line bg-cream px-4 py-3.5">
      <span className="flex items-center text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="truncate font-serif text-xl font-semibold leading-tight text-ink md:text-2xl">{value}</span>
      <span className="text-xs leading-snug text-ink-soft">{note}</span>
    </div>
  );
}

export default function BookDetails({ id }) {
  const [book, setBook] = useState(null);
  const [similar, setSimilar] = useState(null); // null = loading
  const [similarMore, setSimilarMore] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const similarBusy = useRef(false); // scroll events come fast: load the next 6 only once
  const [myRating, setMyRating] = useState(0);
  const [place, setPlace] = useState(() => cityPlace("Jerusalem")); // where to look: a city, one branch, or near the reader
  const [avail, setAvail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [social, setSocial] = useState(null); // the reviews and discussion (BookSocial loads them) - for the rating at the top
  useWormPage({ book });
  const [visit, setVisit] = useState(null); // the branch whose "Plan your visit" is open
  const [stage, setStage] = useState(null); // the book on the reader's shelf: saved | reading | finished | null

  useEffect(() => {
    api(`/api/books/${id}`, { auth: false }).then(setBook).catch((e) => setError(e));
    api(`/api/books/${id}/similar?count=${SIMILAR_FIRST}`, { auth: false })
      .then((r) => { setSimilar(r.books); setSimilarMore(r.hasMore); })
      .catch(() => setSimilar([]));
    api("/api/me/ratings").then((r) => setMyRating(r.ratings.find((x) => String(x.bookId) === String(id))?.rating || 0)).catch(() => {});
    // where the book is on the reader's shelf - the buttons show it (after a refresh too)
    api("/api/me/shelf").then((sh) => {
      const on = (list) => list?.some((b) => String(b.id) === String(id));
      setStage(on(sh.finished) ? "finished" : on(sh.reading) ? "reading" : on(sh.saved) ? "saved" : null);
    }).catch(() => {});
    api("/api/me").then((m) => m.preferredCity && setPlace(cityPlace(m.preferredCity))).catch(() => {});
  }, [id]);

  // A visit = the page was open (and on screen) for 8 seconds. For "Because you looked at" on For You.
  // The server counts a book again only 30 minutes later; signed-out visitors are simply not counted.
  useEffect(() => {
    let seen = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++seen < 8) return;
      clearInterval(timer);
      api("/api/me/book-views", { method: "POST", body: { bookId: Number(id) } }).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    api(`/api/books/${id}/availability?${place.query}`, { auth: false })
      .then((r) => setAvail({ query: place.query, ...r }))
      .catch(() => setAvail({ query: place.query, availability: null }));
  }, [id, place.query]);

  async function moreSimilar() {
    if (similarBusy.current || !similarMore) return;
    similarBusy.current = true;
    setLoadingSimilar(true);
    try {
      const r = await api(`/api/books/${id}/similar?count=${SIMILAR_PAGE}&offset=${similar.length}`, { auth: false });
      setSimilar((s) => [...s, ...r.books.filter((b) => !s.some((x) => x.id === b.id)).map((b) => ({ ...b, fresh: true }))]); // fresh: fade in softly
      setSimilarMore(r.hasMore);
    } catch { setSimilarMore(false); }
    finally { setLoadingSimilar(false); similarBusy.current = false; }
  }

  async function rate(n) {
    await api("/api/me/ratings", { method: "POST", body: { bookId: Number(id), rating: n } });
    setMyRating(n);
    setMsg("Thanks – your picks will use this rating.");
  }
  // One stage per book, as the shelf counts it (server/me-routes.js /shelf): saved, reading or finished.
  // "unsaved" takes it off the shelf; a finished book stays finished (it teaches the recommendations).
  const STAGE_OF = { saved: "saved", started: "reading", finished: "finished", unsaved: null };
  async function event(type, text) {
    const before = stage;
    setStage(type === "unsaved" && before === "finished" ? before : STAGE_OF[type]); // at once - back if it fails
    try {
      await api("/api/me/events", { method: "POST", body: { bookId: Number(id), type } });
      setMsg(text);
      return true;
    } catch {
      setStage(before);
      setMsg("Couldn't save that – please try again.");
      return false;
    }
  }

  if (error && [400, 404].includes(error.status)) return <AppShell><NotFoundView what="book" /></AppShell>;
  if (error) return <AppShell><p role="alert" className="text-rust-dark">Could not load this book: {error.message}. Try again in a moment.</p></AppShell>;
  if (!book) return <AppShell><BookshelfLoader label="Taking the book off the shelf…" /></AppShell>;

  // What you can do with the book - all in sight: bookmark it (the main one), reading it now,
  // finished it, ask the librarian; your stars on the line under them
  // a chosen one is marked (filled, with a check); pressing Bookmarked / Reading now again takes it off the shelf
  const btn = (on) => `btn flex items-center gap-2 px-4 py-2 text-sm ${on ? "border border-rust bg-rust-soft text-rust-dark" : "btn-outline"}`;
  const actions = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={stage === "saved"}
          onClick={(e) => {
            if (stage === "saved") return event("unsaved", "Taken off your bookmarks.");
            const from = e.currentTarget.closest("section").querySelector("img");
            event("saved", "Bookmarked – find it on My shelf.").then((ok) => ok && addedToBasket(from));
          }}
          className={stage === "saved" ? btn(true) : "btn btn-primary flex items-center gap-2 px-5 py-2 text-sm"}>
          <BookmarkIcon filled={stage === "saved"} />{stage === "saved" ? "Bookmarked" : "Bookmark it"}
        </button>
        <button type="button" aria-pressed={stage === "reading"} className={btn(stage === "reading")}
          onClick={() => (stage === "reading" ? event("unsaved", "Taken off your nightstand.") : event("started", "Enjoy! It's on your nightstand."))}>
          {stage === "reading" ? <CheckIcon /> : <OpenBookIcon />}Reading now
        </button>
        <button type="button" aria-pressed={stage === "finished"} className={btn(stage === "finished")}
          onClick={() => (stage === "finished" ? setMsg("You finished it – rate it to sharpen your picks.") : event("finished", "Marked as finished – rate it to improve your picks."))}>
          <CheckIcon />Finished
        </button>
        <Link href={`/chat?book=${book.id}`} className={`${btn(false)} no-underline text-ink hover:text-ink`}><ChatIcon />Ask the librarian</Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-soft">{myRating ? "Your rating" : "Rate it"}</span>
        <Stars value={myRating} onChange={rate} size={22} label="Your rating" />
      </div>
    </div>
  );

  const genres = book.main_genres?.length ? book.main_genres : book.categories || [];
  const desc = book.description || "";
  const checked = avail?.query === place.query;
  const inArea = avail?.availability?.branches || [];
  // one branch chosen: is it there? (the others in its city are the fallback)
  const branches = place.kind === "library" ? inArea.filter((b) => b.libraryId === place.id) : inArea;
  const others = place.kind === "library" ? inArea.filter((b) => b.libraryId !== place.id) : [];
  const goTo = (to) => document.getElementById(to)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // what readers think: the share who liked it (the dataset), else BookBridge's own reviews
  const loved = book.ratings_count >= MIN_RATINGS ? Math.round((book.liked_count / book.ratings_count) * 100) : null;
  const reviews = social?.reviews || [];
  // "feels like": the readers' words that are not just the genre again
  const genreWords = new Set(genres.map((g) => g.replace(/-/g, " ").toLowerCase()));
  const feels = (book.readerTags || []).filter((t) => !genreWords.has(t) && !GENERIC_TAGS.has(t)).slice(0, 3);
  const quotes = pickQuotes(reviews);

  return (
    <AppShell>
      <div className="flex flex-col gap-12">
        {/* The opening: only what you need first - the book, what readers think, bookmark and rate */}
        <section className="flex flex-col gap-5">
          <Link href="/for-you" className="self-start text-sm text-ink-soft no-underline hover:text-ink">← Back to your picks</Link>
          <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-5 gap-y-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-x-12">
            <div className="md:row-span-2"><Cover book={book} /></div>

            <div className="flex flex-col gap-3 md:gap-4">
              <div className="flex flex-col gap-1.5">
                <h1 className="m-0 font-serif text-[26px] font-semibold leading-[1.08] tracking-tight md:text-5xl">{book.title}</h1>
                <span className="text-[15px] text-ink-soft md:text-lg"><AuthorNames names={book.authors || []} accounts={book.authorAccounts || []} /></span>
                {book.series && (
                  <Link href={`/series/${encodeURIComponent(book.series.name)}`} className="self-start text-sm italic text-rust md:text-base">
                    {book.series.number !== null ? `Book ${book.series.number} of ${book.series.total} in ${book.series.name}` : `Part of ${book.series.name}`} →
                  </Link>
                )}
              </div>
              {(book.avgRating > 0 || loved !== null) && (
                <button type="button" onClick={() => goTo("readers")} className="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 self-start bg-transparent p-0 text-sm text-ink-soft hover:text-ink">
                  {book.avgRating > 0 && <span className="flex items-center gap-1.5"><span className="font-serif text-xl font-semibold text-ink">{book.avgRating.toFixed(1)}</span><Stars value={Math.round(book.avgRating)} size={15} /></span>}
                  {loved !== null && <span><b className="text-ink">{loved}%</b> of readers loved it</span>}
                </button>
              )}
              <div className="hidden md:block">{actions}</div>
            </div>

            <div className="col-span-2 flex flex-col gap-4 md:col-span-1 md:col-start-2">
              <div className="md:hidden">{actions}</div>
              {msg && <p role="status" className="m-0 text-sm text-moss-dark">{msg}</p>}
              {desc && (
                <div className="flex max-w-[680px] flex-col items-start gap-1">
                  <p className="m-0 font-serif text-[17px] leading-relaxed text-ink md:text-[18px]"
                    style={showAll ? undefined : { WebkitLineClamp: 3, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{desc}</p>
                  {desc.length > 200 && <button type="button" onClick={() => setShowAll(!showAll)} className="cursor-pointer bg-transparent p-0 text-sm font-medium text-rust">{showAll ? "Show less" : "Read more"}</button>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* What you need to know - one look each, no paragraphs */}
        <section aria-labelledby="know" className="flex flex-col gap-4">
          <h2 id="know" className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-muted">What you need to know</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Fact label="Length" value={book.page_count ? `~${Math.max(1, Math.round(book.page_count / PAGES_PER_HOUR))} h` : "–"}
              note={[book.page_count && `${book.page_count} pages`, year(book.published_date)].filter(Boolean).join(" · ")} />
            <Fact label="Readers" value={loved !== null ? `${loved}%` : reviews.length ? `${reviews.length}` : "–"}
              note={loved !== null ? `loved it · ${book.ratings_count.toLocaleString()} ratings` : reviews.length ? (reviews.length === 1 ? "review here" : "reviews here") : "no ratings yet"} />
            <Fact label="Feels like" value={<span className="capitalize">{genres[0]?.replace(/-/g, " ") || "–"}</span>}
              note={feels.length ? feels.map((t) => (
                <Link key={t} href={`/search?q=${encodeURIComponent(`#${t}`)}`} className="text-ink-soft no-underline hover:text-rust">#{t}</Link>
              )).reduce((a, x, i) => (i ? [...a, " · ", x] : [x]), []) : genres.slice(1).join(" · ")} />
            <Fact label={<span className="flex items-center gap-1"><PinIcon />Nearby</span>}
              value={!checked ? "…" : branches.length ? "On the shelf" : "Not now"}
              note={
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <PlaceSearch place={place} onPick={setPlace} />
                  {checked && (branches.length > 0 || others.length > 0) && (
                    <button type="button" onClick={() => setVisit((branches[0] || others[0]))} className="cursor-pointer bg-transparent p-0 text-left text-rust">
                      · {branches.length ? `${branches[0].name}${branches.length > 1 ? ` +${branches.length - 1}` : ""}` : `try ${others[0].name}`} →
                    </button>
                  )}
                </span>
              } />
          </div>
          {visit && <LibraryVisit branch={visit} books={[{ id: book.id, title: book.title }]} onClose={() => setVisit(null)} />}
        </section>

        {/* What readers say - a few short lines; the rest is below */}
        {quotes.length > 0 && (
          <section aria-labelledby="say" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="say" className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-muted">What readers say</h2>
              <button type="button" onClick={() => goTo("readers")} className="cursor-pointer bg-transparent p-0 text-sm font-medium text-rust">
                All {reviews.length} {reviews.length === 1 ? "review" : "reviews"}{social?.posts.length ? " & the discussion" : ""} →
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {quotes.map((r, i) => (
                <figure key={i} className={`m-0 flex flex-col justify-between gap-3 border-l-2 border-rust/40 py-1 pl-4 ${i > 1 ? "hidden md:flex" : ""}`}>
                  <blockquote className="m-0 font-serif text-[17px] italic leading-snug text-ink">“{r.quote}”</blockquote>
                  <figcaption className="flex items-center gap-2 text-xs text-muted">— {r.name}{r.rating > 0 && <Stars value={r.rating} size={12} />}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <BookSocial bookId={id} myRating={myRating} onRate={rate} onData={setSocial} />

        {similar === null && <BookshelfLoader label="Finding similar books…" />}
        {similar?.length > 0 && (
          <ShelfRow id="similar" title="Similar in spirit" count={similar.length} titleClass="text-[28px]"
            onReachEnd={similarMore ? moreSimilar : undefined} loading={loadingSimilar}>
            {similar.map((s) => (
              <Link key={s.id} id={`sim-${s.id}`} href={`/books/${s.id}`} aria-describedby={hasPeek(s) ? `peek-${s.id}` : undefined}
                className={`${s.fresh ? "fresh-in " : ""}group book-w relative flex snap-start flex-col gap-1 text-ink no-underline hover:z-20 hover:text-rust focus-visible:z-20`}>
                <div className="relative"><Cover book={s} /><BookPeek book={s} /></div>
                <span className="book-title">{s.title}</span>
                <span className="book-line">{s.authors?.[0]}</span>
              </Link>
            ))}
          </ShelfRow>
        )}
      </div>
    </AppShell>
  );
}
