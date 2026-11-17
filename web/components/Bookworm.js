"use client";

// Inkling, the bookworm: a friendly worm in spectacles who pops out of a hole it nibbled in a book,
// in the corner of every signed-in page. Once on each page it says one thing; click it for more.
//
// What it says - always true, and where a fact comes from it says so:
//   - about this page: what the page shows right now (the page hands it over with useWormPage),
//     e.g. the book that has waited longest in your bookmarks, the most-rated book on the page
//   - "Did you know?": the opening of the book's or author's Wikipedia article (lib/worm-knowledge.js),
//     a checked fact (lib/bookworm-facts.js), the catalog's own data (readers' tags, series), or a
//     writer born on this day who has books in our catalog
//   - tips: what each page can do
// It remembers what it already said (in this browser) and prefers something new. "Ask Inkling"
// offers a surprise book, help with the page, and shortcuts. It reacts when you bookmark or finish
// a book, and now and then it stretches or looks around by itself.
// "Hide" tucks it away (remembered); a small tab brings it back. It sits a little above the corner,
// clear of the phone's menu bar and of Next.js's dev button.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FACTS, factFor, matches } from "@/lib/bookworm-facts";
import { wikiBook, wikiAuthor, bornToday } from "@/lib/worm-knowledge";
import { useWormContext } from "@/lib/worm";
import { api } from "@/lib/api";
import { XIcon } from "./Icons";

const TIPS = {
  "/for-you": [
    "Tap the first wax seal, Today's picks, and your five strongest picks open like a book.",
    "The little flame shows how close a match is. The tiny cover beside it is a book you loved that led us here – tap it.",
    "Hover a cover to bookmark it, rate it, or put it back on the shelf for good.",
    "Turn on “Available at a library near me” and every shelf shows what you can borrow in your city.",
  ],
  "/shelf": [
    "Started a book? Drag it from Bookmarked onto your nightstand – or press Start reading.",
    "When you turn the last page, a wax seal marks it as read. Then give it some stars – your picks learn from them.",
  ],
  "/search": [
    { text: "Start with # to search by what readers say about a book.", href: "/search?q=%23made%20me%20cry", link: "Try #made me cry" },
    "Click into the search box to see your recent searches again.",
  ],
  "/insights": [
    "Every chapter of your journal is counted from your own ratings and shelf – nothing else.",
    { text: "Rate a few more books and your journal fills up.", href: "/rate-more", link: "Rate more books" },
  ],
  "/books/": [
    "Tap a library under Where to borrow it – you'll get directions, parking and its opening hours.",
    "Click a #tag under Readers say to find more books readers described the same way.",
  ],
  "/chat": [
    "The librarian answers only with real books from our catalog. Try “a cozy mystery I can borrow in Jerusalem”.",
    "Under each answer, Translate shows it in Hebrew or another language.",
  ],
  "": ["Lost? The round button in the corner opens the librarian – ask anything about books."],
};
const tipsFor = (path) => (TIPS[Object.keys(TIPS).find((k) => k && path.startsWith(k)) || ""]).map((t) => (typeof t === "string" ? { text: t } : t));
const GO = [["/for-you", "For you"], ["/shelf", "My shelf"], ["/insights", "Reading journal"], ["/search", "Search"], ["/chat", "The librarian"]];

const SEEN = "bb-worm-seen"; // pages it already spoke on, this visit
const SAID = "bb-worm-said"; // what it has said lately (so it says something new)
const OFF = "bb-worm-off";   // tucked away
const store = (s, k, v) => { try { if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { return null; } };
const said = () => { try { return JSON.parse(localStorage.getItem(SAID)) || []; } catch { return []; } };
const remember = (id) => store(localStorage, SAID, JSON.stringify([...said().filter((x) => x !== id), id].slice(-300)));
const idOf = (n) => n.text.slice(0, 80);
const fmt = (n) => Number(n).toLocaleString("en-US");
const when = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

// a catalog book for a fact (by exact title), once per title
const found = new Map();
function inCatalog(fact) {
  if (!found.has(fact.title)) {
    found.set(fact.title, api(`/api/books/search?q=${encodeURIComponent(fact.title)}`, { auth: false })
      .then((r) => r.books.find((b) => matches(fact, b.title)) || null)
      .catch(() => null));
  }
  return found.get(fact.title);
}

// what the page itself shows, as notes (no waiting)
function pageNotes(page) {
  const out = [];
  const b = page.book;
  if (b) {
    const f = factFor(b);
    if (f) out.push({ fact: true, text: f.text, source: f.source });
    if (b.readerTags?.length) out.push({ fact: true, text: `Readers' favourite tag for ${b.title} is #${b.readerTags[0]}.`, href: `/search?q=${encodeURIComponent(`#${b.readerTags[0]}`)}`, link: "Books with this tag", from: "readers' tags in our catalog" });
    if (b.series?.total > 1 && b.series.number != null) out.push({ fact: true, text: `${b.title} is book ${b.series.number} of ${b.series.total} in ${b.series.name}.`, href: `/series/${encodeURIComponent(b.series.name)}`, link: "See the whole series", from: "our catalog" });
  }
  const books = (page.books || []).filter((x) => x?.title);
  for (const x of books) {
    const f = factFor(x);
    if (f && !out.some((o) => o.text === f.text)) out.push({ fact: true, text: f.text, source: f.source, href: `/books/${x.id}`, link: `Open ${x.title}` });
  }
  const rated = books.filter((x) => x.ratingCount > 0);
  if (rated.length > 2) {
    const most = rated.reduce((a, c) => (c.ratingCount > a.ratingCount ? c : a));
    out.push({ fact: true, text: `Of the books on this page, ${most.title} has the most ratings in our data – ${fmt(most.ratingCount)} of them.`, href: `/books/${most.id}`, link: "Open it", from: "the goodbooks-10k ratings in our catalog" });
    const best = rated.filter((x) => x.ratingCount >= 1000 && x.avgRating).sort((p, q) => q.avgRating - p.avgRating)[0];
    if (best) out.push({ fact: true, text: `The best-loved book on this page is ${best.title}: ${best.avgRating.toFixed(2)}★ on average from ${fmt(best.ratingCount)} ratings.`, href: `/books/${best.id}`, link: "Open it", from: "the goodbooks-10k ratings in our catalog" });
  }
  const st = page.stats || {};
  if (st.topPick?.match > 0) out.push({ text: `Your strongest pick right now is ${st.topPick.title} – a ${st.topPick.match}% match.`, href: `/books/${st.topPick.id}`, link: "Open it" });
  if (st.ratings != null) out.push({ text: `Your picks are built from the ${fmt(st.ratings)} book${st.ratings === 1 ? "" : "s"} you rated. Every rating makes them sharper.`, href: "/rate-more", link: "Rate a few more" });
  if (st.oldestBookmark) out.push({ text: `${st.oldestBookmark.title} has waited in your bookmarks the longest – since ${when(st.oldestBookmark.at)}. Tonight, perhaps?`, href: `/books/${st.oldestBookmark.id}`, link: "Open it" });
  if (st.nightstand > 0) out.push({ text: `${st.nightstand} book${st.nightstand === 1 ? " is" : "s are"} on your nightstand. A chapter before bed?` });
  if (st.finished > 0) out.push({ text: `You've reached the end of ${st.finished} book${st.finished === 1 ? "" : "s"} here – each one still has a wax seal on its cover.` });
  if (st.topGenre) out.push({ text: `By your 4–5★ ratings, your heart belongs to ${st.topGenre}.` });
  if (st.nextInSeries) out.push({ text: `The next book in ${st.nextInSeries.name} is waiting for you.`, href: `/books/${st.nextInSeries.id}`, link: "See it" });
  if (st.searched) out.push({ text: `${fmt(st.searched.count)} book${st.searched.count === 1 ? "" : "s"} found for “${st.searched.q}”. Hover a cover for a quick look.` });
  return out;
}

export default function Bookworm() {
  const path = usePathname();
  const page = useWormContext();
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState(false);
  const [note, setNote] = useState(null);
  const [menu, setMenu] = useState(false);
  const [extra, setExtra] = useState([]);   // notes that arrive later (Wikipedia, born today, the catalog)
  const [mood, setMood] = useState("");     // a short animation: cheer, look, stretch
  const queue = useRef([]);
  const quietTimer = useRef(null);

  useEffect(() => { setOff(store(localStorage, OFF) === "1"); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  // everything it could say here, the kinds taking turns: what this page shows, a fact about it,
  // something from Wikipedia or the catalog, a tip
  const notes = useMemo(() => {
    const here = pageNotes(page);
    const groups = [here.filter((n) => !n.fact), here.filter((n) => n.fact), extra, tipsFor(path)];
    const all = [];
    for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (g[i]) all.push(g[i]);
    return all.filter((n, i) => all.findIndex((m) => m.text === n.text) === i);
  }, [page, extra, path]);
  useEffect(() => { queue.current = notes; }, [notes]);
  // the next thing to say: the first it hasn't said lately, else the one it said longest ago
  const pick = (current) => {
    const seen = said();
    const q = queue.current.filter((n) => idOf(n) !== current);
    return q.find((n) => !seen.includes(idOf(n))) || [...q].sort((a, b) => seen.indexOf(idOf(a)) - seen.indexOf(idOf(b)))[0] || queue.current[0];
  };

  // facts that need a moment: Wikipedia about this book and its author, a writer born today, and
  // a checked fact about another book of the catalog
  const bookKey = page.book?.id ?? (page.books || []).slice(0, 6).map((b) => b.id).join(",");
  useEffect(() => {
    let alive = true;
    setExtra([]); // eslint-disable-line react-hooks/set-state-in-effect
    const add = (n) => { if (alive && n) setExtra((x) => (x.some((y) => y.text === n.text) ? x : [...x, n])); };
    const main = page.book || (page.books || [])[Math.floor(Math.random() * Math.min(6, (page.books || []).length))];
    if (main) {
      wikiBook(main).then((w) => w && add({ fact: true, text: w.text, source: w.source, ...(page.book ? {} : { href: `/books/${main.id}`, link: `Open ${main.title}` }) }));
      wikiAuthor(main.authors?.[0]).then((w) => w && add({ fact: true, text: w.text, source: w.source, ...(main.authors?.[0] ? { href: `/search?q=${encodeURIComponent(main.authors[0])}`, link: `Books by ${main.authors[0]}` } : {}) }));
    }
    bornToday().then((b) => b && add({ fact: true, title: "Born on this day", text: `${b.name} was born on this day in ${b.year} – ${b.what}.`, source: b.source, href: `/search?q=${encodeURIComponent(b.name)}`, link: `Books by ${b.name} in our catalog` }));
    const f = FACTS[Math.floor(Math.random() * FACTS.length)];
    inCatalog(f).then((book) => book && add({ fact: true, text: f.text, source: f.source, href: `/books/${book.id}`, link: `Open ${book.title}` }));
    return () => { alive = false; };
  }, [bookKey, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = useCallback((n, { quiet = false } = {}) => {
    if (!n) return;
    setNote(n); setOpen(true); setMenu(false);
    remember(idOf(n));
    clearTimeout(quietTimer.current);
    if (quiet) quietTimer.current = setTimeout(() => setOpen(false), 7000); // a reaction closes by itself
  }, []);
  const next = useCallback(() => say(pick(note && idOf(note))), [note, say]);

  // speak once on each page, a few seconds after it opens
  useEffect(() => {
    setOpen(false); setMenu(false); // eslint-disable-line react-hooks/set-state-in-effect
    if (off) return;
    const seen = JSON.parse(store(sessionStorage, SEEN) || "[]");
    const where = path.startsWith("/books/") ? "/books/" : path;
    if (seen.includes(where)) return;
    const t = setTimeout(() => { store(sessionStorage, SEEN, JSON.stringify([...seen, where])); say(pick(null)); }, 4000);
    return () => clearTimeout(t);
  }, [path, off, say]);

  // reactions: a bookmark, a finished book (lib/basket.js, the shelf)
  const play = (m) => { setMood(m); setTimeout(() => setMood(""), 1200); };
  useEffect(() => {
    if (off) return;
    const bookmarked = (e) => { if (e.detail > 0) { play("cheer"); say({ react: true, text: "Into your bookmarks it goes! I'll keep it warm for you." }, { quiet: true }); } };
    const finished = (e) => { play("cheer"); say({ react: true, text: e.detail?.text || "The end! Give it some stars while it's fresh." }, { quiet: true }); };
    window.addEventListener("bb-basket", bookmarked);
    window.addEventListener("bb-worm", finished);
    return () => { window.removeEventListener("bb-basket", bookmarked); window.removeEventListener("bb-worm", finished); };
  }, [off, say]);

  // now and then, all by itself: a look around, a stretch
  useEffect(() => {
    if (off) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") play(Math.random() < 0.5 ? "look" : "stretch"); }, 38000);
    return () => clearInterval(t);
  }, [off]);

  function surprise() {
    const pool = (page.books || []).filter((b) => b.id !== page.book?.id);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      play("cheer");
      say({ text: `How about ${pick.title}${pick.authors?.[0] ? ` by ${pick.authors[0]}` : ""}?${pick.reasonText ? ` ${pick.reasonText}.` : ""}`, href: `/books/${pick.id}`, link: "Open it" });
      wikiBook(pick).then((w) => w && setExtra((x) => [...x, { fact: true, text: w.text, source: w.source, href: `/books/${pick.id}`, link: `Open ${pick.title}` }]));
      return;
    }
    const f = FACTS[Math.floor(Math.random() * FACTS.length)];
    inCatalog(f).then((book) => book ? say({ text: `How about ${book.title}? ${f.text}`, source: f.source, href: `/books/${book.id}`, link: "Open it" }) : next());
  }

  if (off) {
    return (
      <button type="button" onClick={() => { setOff(false); store(localStorage, OFF, null); next(); }} aria-label="Bring back the bookworm" title="Bring back the bookworm"
        className="worm-tab fixed bottom-[8.5rem] left-0 z-40 flex h-11 w-9 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-line-strong bg-cream text-[18px] lg:bottom-16">
        <WormFace />
      </button>
    );
  }

  return (
    <div className="worm fixed bottom-[8.5rem] left-3 z-40 flex items-end gap-2 lg:bottom-16 lg:left-5" onMouseEnter={() => clearTimeout(quietTimer.current)}>
      <button type="button" onClick={() => (open ? setOpen(false) : next())} aria-expanded={open} aria-label={open ? "Close the bookworm's note" : "What does the bookworm say?"}
        className={`worm-btn flex-none cursor-pointer bg-transparent p-0 ${mood ? `worm-${mood}` : ""}`}>
        <WormArt />
      </button>
      {open && note && (
        <div role="status" key={note.text} className="worm-note swap-in relative mb-8 w-[min(310px,calc(100vw-7.5rem))] rounded-md border border-line-strong bg-cream p-3.5 pr-8 shadow-[0_12px_28px_rgba(90,55,25,0.22)]">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-transparent text-muted hover:bg-sand hover:text-ink [&_svg]:h-3.5 [&_svg]:w-3.5"><XIcon /></button>
          <span className="eyebrow block text-[14px]">{note.title || (note.react ? "Hooray!" : note.fact ? "Did you know?" : "Inkling says")}</span>
          <p className="m-0 mt-1 font-serif text-[16px] leading-snug text-ink">{note.text}</p>
          {(note.href || note.source || note.from) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              {note.href && <Link href={note.href} onClick={() => setOpen(false)} className="font-medium">{note.link} →</Link>}
              {note.source && <a href={note.source} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-rust">Source: Wikipedia ↗</a>}
              {note.from && <span className="text-muted">From {note.from}</span>}
            </div>
          )}
          {menu ? (
            <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={surprise} className="worm-chip">Surprise me with a book</button>
                <button type="button" onClick={() => say(tipsFor(path)[Math.floor(Math.random() * tipsFor(path).length)])} className="worm-chip">Help with this page</button>
                {page.book && <button type="button" onClick={() => say(queue.current.find((n) => n.fact) || queue.current[0])} className="worm-chip">About this book</button>}
              </div>
              <span className="text-[12px] text-muted">Take me to</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                {GO.filter(([href]) => !path.startsWith(href)).map(([href, label]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="font-medium">{label}</Link>)}
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[13px]">
              <button type="button" onClick={next} className="cursor-pointer bg-transparent p-0 font-medium text-rust hover:text-rust-dark">Tell me something new</button>
              <button type="button" onClick={() => setMenu(true)} className="cursor-pointer bg-transparent p-0 font-medium text-ink-soft hover:text-ink">Ask Inkling…</button>
            </div>
          )}
          <button type="button" onClick={() => { setOff(true); setOpen(false); store(localStorage, OFF, "1"); }} className="mt-1.5 cursor-pointer bg-transparent p-0 text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">Hide the bookworm</button>
        </div>
      )}
    </div>
  );
}

// Inkling, drawn like an illustration from an old children's book: sepia ink lines (roughened a
// little by an SVG filter, so they look drawn by hand), flat faded watercolours and hatching for
// shade. A plump worm with spectacles, antennae and a knitted scarf pops out of a hole it nibbled
// in an old leather-bound book. Each part is a group the CSS animates (globals.css, .worm-*).
const INK = "#3B2416";
const ink = { stroke: INK, strokeWidth: 1.3, strokeLinejoin: "round", strokeLinecap: "round" };
const hatch = { fill: "none", stroke: INK, strokeWidth: 0.7, strokeLinecap: "round", opacity: 0.45 };

function WormArt() {
  return (
    <svg width="92" height="92" viewBox="0 0 100 100" aria-hidden="true" className="worm-art">
      <defs>
        <filter id="worm-hand" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
      </defs>
      <g filter="url(#worm-hand)">
        {/* the old book: leather top cover with a gilt frame and brass corners, raised bands on the spine,
            yellowed pages */}
        <path d="M14 63 H86 L94 73 H6Z" fill="#9A4424" {...ink} />
        <path d="M20 65 H80 L85.500 71 H14.500Z" fill="none" stroke="#C99A45" strokeWidth=".9" />
        <path d="M14 63 L20 63 L14 69Z M86 63 L80 63 L86.800 69Z" fill="#C99A45" {...ink} strokeWidth=".8" />
        <path d="M6 73 H94 V77 H6Z" fill="#7A3018" {...ink} />
        <path d="M8 77 H92 V88 H8Z" fill="#F1E1BF" {...ink} />
        <path d="M11 80 Q50 79 89 80 M11 82.700 Q50 81.800 89 82.700 M11 85.400 Q50 84.600 89 85.400" {...hatch} opacity=".35" />
        <path d="M5 88 H95 Q95 93 91 93 H9 Q5 93 5 88Z" fill="#7A3018" {...ink} />
        <path d="M6 73 Q2 81 5 92" fill="none" {...ink} strokeWidth="3.200" stroke="#5E2412" />
        <path d="M3.500 78 l3 .4 M3.300 84 l3 .3" {...ink} stroke="#C99A45" strokeWidth="1.200" />
        <path d="M60 66 l9 0 M64 68.500 l9 0" {...hatch} />
        {/* the nibbled hole, with a ragged edge and crumbs */}
        <path d="M38.500 68.300 Q39 65.500 44 65.300 Q51 64.400 58 65.200 Q63.500 66 63.200 68.300 Q57 71.300 51 71.200 Q43 71.300 38.500 68.300Z" fill="#2E170D" {...ink} />
        <path d="M39.500 67 l1.800 -1 l.8 1.300 l1.700 -1.200 M57.500 65.700 l1.800 1.100 l1.200 -.9 l1.300 1.200" fill="none" stroke="#F1E1BF" strokeWidth="1" strokeLinejoin="round" />
        <g className="worm-crumbs" fill="#F1E1BF" stroke="#8A6A4A" strokeWidth=".5" strokeLinejoin="round">
          <path d="M33 60.500 l2.400 -.8 l-.4 2.400z" /><path d="M66.500 59 l2.400 .8 l-1.600 1.800z" /><path d="M63.500 63.500 l1.900 -.3 l-.6 1.600z" />
        </g>

        <g className="worm-body">
          {/* two plump segments, with a pale belly stripe and hatched shade on the right */}
          <path d="M42.500 63.500 Q42 55 51.500 54 Q61.500 54.500 61.500 63.500 Q57 69.500 52 69.300 Q46 69.500 42.500 63.500Z" fill="#A7AE6E" {...ink} />
          <path d="M45.500 64 Q51.500 67.500 58.500 64" fill="none" stroke="#E7E4B8" strokeWidth="1.800" strokeLinecap="round" />
          <path d="M57 58 l2.500 2 M57.800 61.300 l2 1.600 M55.800 55.800 l2.400 1.900" {...hatch} />
          <path d="M45.800 53.500 Q46 44.500 55.500 44 Q65 44.300 65.500 53 Q61 59 55.500 58.800 Q49.500 59 45.800 53.500Z" fill="#AEB475" {...ink} />
          <path d="M48.800 54 Q55 57.500 62 54" fill="none" stroke="#E7E4B8" strokeWidth="1.800" strokeLinecap="round" />
          <path d="M61 47.500 l2.500 2 M61.500 50.800 l2 1.600" {...hatch} />
          {/* the knitted scarf: a band with stripes and stitches, a tail with a fringe */}
          <g className="worm-scarf">
            <path d="M58 45 Q63.500 53 59.800 61.500 L53.800 60.200 Q56.800 53.500 54 47Z" fill="#A2431F" {...ink} strokeWidth="1.100" />
            <path d="M54.800 51.500 l5.600 .4 M55.200 55 l5 .4" stroke="#D9A84E" strokeWidth="1.500" />
            <path d="M54 60.500 l-.8 3.200 M56 61 l-.4 3.300 M58 61.300 l.1 3.300" {...ink} strokeWidth=".9" />
          </g>
          <path d="M35.500 42 Q50 50.500 64.500 42.500 L66 47.500 Q50 56.500 34 47Z" fill="#A2431F" {...ink} strokeWidth="1.100" />
          <path d="M40 45.200 l1.700 3.800 M46 47.500 l1.200 3.800 M52.500 47.800 l.7 3.800 M59 46 l.2 3.800" stroke="#D9A84E" strokeWidth="1.400" strokeLinecap="round" />
          <path d="M37.500 45.800 q1 .8 2 0 M43.500 48.300 q1 .8 2 0 M50 49.300 q1 .8 2 0 M56.300 48.300 q1 .8 2 0" {...hatch} opacity=".5" />

          <g className="worm-head">
            <g className="worm-antennae">
              <path d="M42 14 Q38.500 8 34.800 6.800 M55.500 14 Q59 8 62.800 6.800" fill="none" {...ink} strokeWidth="1.500" />
              <circle cx="34" cy="6.300" r="2.800" fill="#A2431F" {...ink} strokeWidth="1.100" />
              <circle cx="63.500" cy="6.300" r="2.800" fill="#A2431F" {...ink} strokeWidth="1.100" />
            </g>
            {/* the head: a slightly uneven round, a lighter wash on the upper left, hatching low right */}
            <path d="M30.500 29 Q30 12 48.500 11.200 Q67 11.500 66.800 29 Q66.500 45.500 48.500 46.300 Q31 45.800 30.500 29Z" fill="#B3B97C" {...ink} />
            <path d="M35 22 Q38 15.500 46 14.500" fill="none" stroke="#E2E3B4" strokeWidth="2.400" strokeLinecap="round" opacity=".8" />
            <path d="M60 37 l3 2 M57.500 40.200 l2.800 1.800 M62 33.300 l2.800 1.700" {...hatch} />
            {/* watercolour cheeks */}
            <ellipse cx="37.500" cy="36.200" rx="3.600" ry="2.400" fill="#D9846A" opacity=".45" />
            <ellipse cx="59.500" cy="36.200" rx="3.600" ry="2.400" fill="#D9846A" opacity=".45" />
            <g className="worm-eyes">
              <ellipse cx="42.800" cy="28.400" rx="2.700" ry="3.300" fill={INK} />
              <ellipse cx="54.300" cy="28.400" rx="2.700" ry="3.300" fill={INK} />
              <circle cx="43.700" cy="27.200" r="1" fill="#FFF9EC" /><circle cx="55.200" cy="27.200" r="1" fill="#FFF9EC" />
            </g>
            {/* wire spectacles */}
            <circle cx="42.800" cy="28.400" r="6.300" fill="rgba(255,249,236,.18)" stroke="#8A6420" strokeWidth="1.300" />
            <circle cx="54.300" cy="28.400" r="6.300" fill="rgba(255,249,236,.18)" stroke="#8A6420" strokeWidth="1.300" />
            <path d="M47.300 27.400 q1.300 -1.200 2.500 0 M36.500 27.500 l-4.500 -1.200 M60.600 27.500 l4.300 -1.200" fill="none" stroke="#8A6420" strokeWidth="1.100" strokeLinecap="round" />
            {/* a small open smile */}
            <path d="M44.800 37 Q48.600 41.800 52.400 37 Q48.600 38.400 44.800 37Z" fill="#7A3018" {...ink} strokeWidth="1.100" />
          </g>
        </g>
      </g>
    </svg>
  );
}
const WormFace = () => (
  <svg width="24" height="24" viewBox="28 2 42 42" aria-hidden="true">
    <path d="M42 15 Q38 8 34.500 6.500 M55 15 Q59 8 63 6.500" fill="none" stroke="#3B2416" strokeWidth="1.500" strokeLinecap="round" />
    <circle cx="34" cy="6" r="3" fill="#A2431F" stroke="#3B2416" /><circle cx="63.500" cy="6" r="3" fill="#A2431F" stroke="#3B2416" />
    <circle cx="48.500" cy="29" r="15" fill="#B3B97C" stroke="#3B2416" strokeWidth="1.300" />
    <ellipse cx="43" cy="28.500" rx="2.400" ry="3" fill="#3B2416" /><ellipse cx="54" cy="28.500" rx="2.400" ry="3" fill="#3B2416" />
    <circle cx="43" cy="28.500" r="5.500" fill="none" stroke="#8A6420" strokeWidth="1.300" /><circle cx="54" cy="28.500" r="5.500" fill="none" stroke="#8A6420" strokeWidth="1.300" />
    <path d="M45 37 Q48.500 41.500 52 37Z" fill="#7A3018" stroke="#3B2416" strokeWidth="1" />
  </svg>
);
