"use client";

// One recommended book: cover, reason, availability, and quick actions
import { useState } from "react";
import Link from "next/link";
import Cover from "./Cover";
import Stars from "./Stars";
import BookPeek, { hasPeek } from "./BookPeek";
import { Warmth, WhyChip } from "./BookFit";
import { BookmarkIcon, StarIcon, XIcon, PinIcon, ChatIcon } from "./Icons";
import { api } from "@/lib/api";
import { addedToBasket, leftBasket } from "@/lib/basket";

// onAsk: what "Ask about this book" does - by default it opens the chat about this book
// (/chat?book=<id>); the chat itself passes its own (ask in the same conversation)
// A rated book stays on the card with the reader's stars, which they can change.
// ratingSource: where the rating was given, when not the site's pages ("chat")
export default function RecCard({ book, rank, showAvailability, onDismiss, onRated, onAsk, ratingSource }) {
  const [myStars, setMyStars] = useState(book.myRating || 0);
  const [saved, setSaved] = useState(Boolean(book.saved));
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);
  const author = book.authors?.[0] || ""; // first author only (not illustrators / translators)
  const why = book.reasonText || book.reason;

  async function save(e) {
    const from = e.currentTarget.closest(".rec")?.querySelector("img");
    setBusy(true);
    try {
      await api("/api/me/events", { method: "POST", body: { bookId: book.id, type: saved ? "unsaved" : "saved" } });
      if (saved) leftBasket(); else addedToBasket(from);
      setSaved(!saved);
    }
    finally { setBusy(false); }
  }
  async function rate(n) {
    setBusy(true);
    try { await api("/api/me/ratings", { method: "POST", body: { bookId: book.id, rating: n, ...(ratingSource ? { source: ratingSource } : {}) } }); setRating(false); setMyStars(n); onRated?.(book.id, n); }
    finally { setBusy(false); }
  }
  async function dismiss() {
    onDismiss?.(book.id);
    // saved first, then "Why not?" (components/WhyNot.js) - the reason goes on this event
    api("/api/me/events", { method: "POST", body: { bookId: book.id, type: "dismissed" } })
      .then(() => window.dispatchEvent(new CustomEvent("bb-dismissed", { detail: { id: book.id, title: book.title } })))
      .catch(() => {});
  }

  return (
    <article className="rec hover-host relative flex flex-col gap-2 hover:z-20 focus-within:z-20">
      <div className="relative">
        {rank && <span aria-hidden="true" className="absolute left-2 top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-parchment/85 px-1.5 text-sm font-bold text-ink backdrop-blur-sm">{rank}</span>}
        <Link href={`/books/${book.id}`} className="group relative block no-underline" aria-describedby={hasPeek(book) ? `peek-${book.id}` : undefined}>
          <Cover book={book} />
          {book.isNew && <span className="absolute right-2.5 top-2.5 rounded-md bg-moss px-2 py-1 text-[11px] font-bold text-cream">NEW</span>}
          <BookPeek book={book} actions />
        </Link>
        <div className="rec-actions hover-show absolute inset-x-1 bottom-2 z-20 flex justify-center gap-1" data-open={rating ? "" : undefined}>
          {rating ? (
            <div className="stars-plate"><Stars value={0} onChange={rate} size={20} label={`Rate ${book.title}`} /></div>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={save} aria-pressed={saved} aria-label={saved ? "Remove from my TBR" : "Add to my TBR (to be read)"} data-tip={saved ? "Take the bookmark out" : "Bookmark it"} className={`icon-btn ${saved ? "pop !bg-rust !text-cream" : ""}`}><BookmarkIcon filled={saved} /></button>
              <button type="button" disabled={busy} onClick={() => setRating(true)} aria-label="Rate this book" data-tip="I read it – rate it" className={`icon-btn ${myStars > 0 ? "hidden" : ""}`}><StarIcon /></button>
              <button type="button" onClick={dismiss} aria-label="Not for me" data-tip="Not for me – back on the shelf" className="icon-btn"><XIcon /></button>
              {onAsk ? (
                <button type="button" onClick={() => onAsk(book)} aria-label={`Ask BookBridge about ${book.title}`} data-tip="Ask the librarian" className="icon-btn"><ChatIcon /></button>
              ) : (
                <Link href={`/chat?book=${book.id}`} aria-label={`Ask BookBridge about ${book.title}`} data-tip="Ask the librarian" className="icon-btn no-underline"><ChatIcon /></Link>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <Link href={`/books/${book.id}`} title={book.title} className="book-title hover:text-rust">{book.title}</Link>
        <span className="book-line" title={author}>{author}</span>
      </div>
      {(book.match > 0 || why) && (
        <div className="flex h-7 items-center justify-between gap-2">
          {book.match > 0 ? <Warmth match={book.match} /> : <span />}
          {why && <WhyChip why={why} book={book.reasonBook} />}
        </div>
      )}
      {showAvailability && (
        <span className={`flex items-start gap-1.5 text-[13px] ${book.availability ? "text-moss-dark" : "text-muted"}`}>
          <span className="mt-0.5"><PinIcon /></span><span dir="auto">{book.availabilityText}</span>
        </span>
      )}
      {myStars > 0 && !rating && (
        <div className="flex items-center gap-1.5">
          <Stars value={myStars} onChange={rate} size={18} label={`Your rating of ${book.title}`} />
          <span className="text-xs font-bold text-moss-dark">Yours</span>
        </div>
      )}
    </article>
  );
}
