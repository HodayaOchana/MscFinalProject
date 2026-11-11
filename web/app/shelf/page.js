"use client";

// My shelf, as a reader's profile and their reading journey: Bookmarked ("TBR") ->
// On the nightstand -> The end. A book moves on with its button, or by dragging it to another
// stage. Finishing a book presses a wax seal on it and asks for its stars. Below: every book the reader rated.
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import WaxSeal from "@/components/WaxSeal";
import Toast, { useToast } from "@/components/Toast";
import { XIcon, BookmarkIcon, OpenBookIcon, CheckIcon } from "@/components/Icons";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth/client";
import { leftBasket, addedToBasket, leafBurst } from "@/lib/basket";
import { useWormPage } from "@/lib/worm";

const SOURCE = { onboarding: "From the questionnaire", app: "Rated in the app", chat: "Rated in a chat" };
const EVENT = { saved: "saved", reading: "started", finished: "finished" };
const STAGES = [
  { key: "saved", title: "Bookmarked", icon: <BookmarkIcon />, empty: "No bookmarks yet. Tap the bookmark on any book to keep it here.", next: "reading", nextLabel: "Start reading" },
  { key: "reading", title: "On the nightstand", icon: <OpenBookIcon />, empty: "Your nightstand is empty. Which one will you open tonight?", next: "finished", nextLabel: "Last page turned" },
  { key: "finished", title: "The end", icon: <CheckIcon />, empty: "The books you finish will gather here." },
];
const pretty = (g) => g.replace(/-/g, " ");

export default function ShelfPage() {
  const { data: session } = authClient.useSession();
  const [me, setMe] = useState(null);
  const [ratings, setRatings] = useState(null);
  const [shelf, setShelf] = useState({ saved: [], reading: [], finished: [] });
  const [error, setError] = useState(null);
  const [over, setOver] = useState(null); // the stage a book is being dragged over
  const [stamped, setStamped] = useState(null); // the book just finished: its seal is pressed on
  const [toast, showToast] = useToast();

  useEffect(() => {
    api("/api/me/ratings").then((r) => setRatings(r.ratings)).catch((e) => setError(e.message));
    api("/api/me/shelf").then((s) => setShelf({ saved: s.saved, reading: s.reading || [], finished: s.finished })).catch(() => {});
    api("/api/me").then(setMe).catch(() => {});
  }, []);

  const oldestBookmark = [...shelf.saved].sort((a, b) => new Date(a.at) - new Date(b.at))[0];
  useWormPage({
    books: [...shelf.saved, ...shelf.reading, ...shelf.finished, ...(ratings || []).map((r) => ({ id: r.bookId, title: r.title, authors: r.authors }))],
    stats: { oldestBookmark: oldestBookmark?.at ? oldestBookmark : null, nightstand: shelf.reading.length, finished: shelf.finished.length },
  });
  const stageOf = (id) => STAGES.find((s) => shelf[s.key].some((b) => b.id === id))?.key;
  const ratingOf = (id) => ratings?.find((r) => r.bookId === id)?.rating || 0;

  async function move(book, to, where) {
    const from = stageOf(book.id);
    if (!from || from === to) return;
    const place = (a, b) => setShelf((s) => ({ ...s, [a]: s[a].filter((x) => x.id !== book.id), [b]: [book, ...s[b]] }));
    place(from, to); // at once; put back if the server says no
    try {
      await api("/api/me/events", { method: "POST", body: { bookId: book.id, type: EVENT[to] } });
      if (from === "saved") leftBasket();
      if (to === "saved") addedToBasket(null);
      if (to === "finished") {
        setStamped(book.id);
        window.dispatchEvent(new CustomEvent("bb-worm", { detail: { text: `The end of ${book.title}! Give it some stars while it's fresh.` } }));
        if (where) leafBurst(where.x, where.y);
        showToast(`The end of “${book.title}”! How was it?`);
      }
    } catch (e) { place(to, from); showToast(e.message); }
  }
  async function unsave(book) {
    await api("/api/me/events", { method: "POST", body: { bookId: book.id, type: "unsaved" } });
    if (stageOf(book.id) === "saved") leftBasket();
    setShelf((s) => ({ ...s, saved: s.saved.filter((b) => b.id !== book.id), reading: s.reading.filter((b) => b.id !== book.id) }));
  }
  async function rate(book, n) {
    await api("/api/me/ratings", { method: "POST", body: { bookId: book.id, rating: n } });
    // a book already in "My reviews in stars" keeps its place (a changed rating doesn't jump to the top)
    setRatings((r) => (r || []).some((x) => x.bookId === book.id)
      ? r.map((x) => (x.bookId === book.id ? { ...x, rating: n } : x))
      : [{ bookId: book.id, title: book.title, authors: book.authors, thumbnail_url: book.thumbnail_url, rating: n, source: "app" }, ...(r || [])]);
    showToast(`Rated ${n}★ – your picks will use it.`);
  }
  async function removeRating(bookId) {
    await api(`/api/me/ratings/${bookId}`, { method: "DELETE" });
    setRatings((r) => r.filter((x) => x.bookId !== bookId));
  }

  const name = session?.user?.name?.trim() || me?.name || "Reader";
  const stats = [["Bookmarked", shelf.saved.length], ["Nightstand", shelf.reading.length], ["Finished", shelf.finished.length], ["Rated", ratings?.length ?? 0]];

  return (
    <AppShell width="max-w-[1280px]">
      <div className="flex flex-col gap-9">
        <section aria-label="My reading profile" className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
            <h1 className="m-0 flex items-center gap-3 font-serif text-3xl font-semibold tracking-tight md:text-4xl"><WaxSeal className="static lg"><OpenBookIcon /></WaxSeal>{name}&apos;s reading nook</h1>
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1">
              {stats.map(([label, n]) => (
                <div key={label} className="flex items-baseline gap-1.5"><dd className="m-0 text-lg font-extrabold">{n}</dd><dt className="text-sm text-muted">{label}</dt></div>
              ))}
            </dl>
            {me?.genres?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {me.genres.map((g) => <span key={g} className="rounded-md bg-sand px-2.5 py-0.5 text-[13px] capitalize text-ink-soft">{pretty(g)}</span>)}
                <Link href="/onboarding/genres" className="ms-1 text-[13px]">Change</Link>
              </div>
            )}
          </div>
        </section>

        {error && <p role="alert" className="text-rust-dark">{error}</p>}

        <section aria-label="My reading journey" className="grid items-start gap-5 lg:grid-cols-3">
          {STAGES.map((st) => (
            <div key={st.key}
              onDragOver={(e) => { e.preventDefault(); setOver(st.key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault(); setOver(null);
                const id = Number(e.dataTransfer.getData("text/plain"));
                const book = Object.values(shelf).flat().find((b) => b.id === id);
                if (book) move(book, st.key, { x: e.clientX, y: e.clientY });
              }}
              className={`flex min-h-[220px] flex-col gap-3 rounded-md border p-4 transition-colors ${over === st.key ? "border-rust bg-rust-soft" : "border-line bg-sand/50"}`}>
              <h2 className="m-0 flex items-center gap-2 font-serif text-xl font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cream text-rust">{st.icon}</span>
                {st.title}
                <span className="ms-auto rounded-md bg-cream px-2.5 py-0.5 font-sans text-sm font-bold text-ink-soft">{shelf[st.key].length}</span>
              </h2>
              {shelf[st.key].length === 0 && <p className="m-0 p-2 text-sm leading-relaxed text-muted">{st.empty}</p>}
              {shelf[st.key].map((b) => (
                <article key={b.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(b.id))}
                  className="group fresh-in flex cursor-grab gap-3 rounded-md bg-cream p-2.5 shadow-[0_3px_10px_rgba(120,80,40,0.1)] transition-transform hover:-translate-y-0.5 active:cursor-grabbing motion-reduce:transform-none">
                  <Link href={`/books/${b.id}`} aria-label={b.title} className="relative block w-16 flex-none no-underline">
                    <Cover book={b} small />
                    {st.key === "finished" && <WaxSeal className={`static read-seal ${stamped === b.id ? "stamp-in" : ""}`}><CheckIcon /></WaxSeal>}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link href={`/books/${b.id}`} className="line-clamp-2 font-serif text-[17px] font-semibold leading-tight text-ink no-underline hover:text-rust">{b.title}</Link>
                    <span className="truncate text-[13px] text-muted">{(b.authors || [])[0]}</span>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                      {st.next && (
                        <button type="button" onClick={(e) => move(b, st.next, { x: e.clientX, y: e.clientY })}
                          className="cursor-pointer rounded-md bg-rust-soft px-3 py-1 text-[13px] font-bold text-rust-dark transition-colors hover:bg-rust hover:text-cream">{st.nextLabel} →</button>
                      )}
                      {st.key === "finished" && <Stars value={ratingOf(b.id)} onChange={(n) => rate(b, n)} size={18} label={`Rate ${b.title}`} />}
                      {st.next && <button type="button" onClick={() => unsave(b)} aria-label={`Take the bookmark out of ${b.title}`} className="ms-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-transparent text-muted hover:bg-sand hover:text-ink [&_svg]:h-3.5 [&_svg]:w-3.5"><XIcon /></button>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </section>

        {ratings?.length > 0 && (
          <section id="ratings" aria-labelledby="my-ratings" className="flex scroll-mt-28 flex-col gap-4">
            <h2 id="my-ratings" className="m-0 font-serif text-2xl font-semibold tracking-tight">My reviews in stars</h2>
            <div className="book-grid">
              {ratings.map((r) => {
                const b = { id: r.bookId, title: r.title, authors: r.authors, thumbnail_url: r.thumbnail_url };
                return (
                  <article key={b.id} className="hover-host relative flex min-w-0 flex-col gap-2">
                    <Link href={`/books/${b.id}`} aria-label={b.title} className="group block no-underline"><Cover book={b} /></Link>
                    <Link href={`/books/${b.id}`} className="book-title hover:text-rust">{b.title}</Link>
                    <span className="book-line">{b.authors?.[0]}</span>
                    <Stars value={r.rating} onChange={(n) => n !== r.rating && rate(b, n)} size={18} label={`Change your rating of ${b.title}`} />
                    <span className="text-xs text-muted">{SOURCE[r.source] || ""}</span>
                    <div className="rec-actions hover-show !absolute right-2 top-2 !m-0 z-10">
                      <button type="button" onClick={() => removeRating(b.id)} aria-label={`Remove rating of ${b.title}`} className="icon-btn"><XIcon /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <Toast toast={toast} />
    </AppShell>
  );
}
