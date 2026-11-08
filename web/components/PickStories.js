"use client";

// "Today's picks" as an open book: the cover on the left page, on the right page how it fits this
// reader, and a page that turns to the next pick (the arrows or ← →). The ribbon is a bookmark:
// it saves the book to the TBR. Esc or a click outside closes the book.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Cover from "./Cover";
import Leaf from "./Leaf";
import { Warmth } from "./BookFit";
import { ArrowIcon, XIcon } from "./Icons";
import { api } from "@/lib/api";
import { addedToBasket, leftBasket } from "@/lib/basket";

export default function PickStories({ books, onClose, onToast }) {
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState([]);
  const closeRef = useRef(null);
  const book = books[index];
  const last = index === books.length - 1;

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, books.length - 1)), [books.length]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [next, back, onClose]);

  const isSaved = saved.includes(book.id);
  async function toggle(e) {
    const from = e.currentTarget.closest("[role=dialog]").querySelector("img");
    try {
      await api("/api/me/events", { method: "POST", body: { bookId: book.id, type: isSaved ? "unsaved" : "saved" } });
      if (isSaved) leftBasket(); else addedToBasket(from);
      setSaved((s) => (isSaved ? s.filter((id) => id !== book.id) : [...s, book.id]));
    } catch (err) { onToast?.(err.message); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Today's picks" className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(239,221,191,0.9)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="book-spread relative my-auto grid w-full max-w-[760px] overflow-hidden rounded-lg border border-line-strong bg-cream shadow-[0_24px_50px_rgba(90,60,30,0.3)] md:grid-cols-2">
        {/* left page: the cover */}
        <div className="relative flex items-center justify-center bg-sand/60 p-6 md:p-8">
          <div aria-hidden="true" className="book-gutter absolute inset-y-0 right-0 hidden w-10 md:block" />
          <div key={book.id} className="swap-in w-[150px] md:w-[240px]"><Cover book={book} /></div>
        </div>
        {/* right page: why it's for you; it turns */}
        <div key={`p-${book.id}`} className="page-turn relative flex min-h-[300px] flex-col gap-3 bg-cream p-6 md:min-h-[440px] md:p-8">
          <button type="button" onClick={toggle} aria-pressed={isSaved} aria-label={isSaved ? "Take the bookmark out" : "Bookmark this book"} title={isSaved ? "Bookmarked" : "Bookmark it"}
            className={`ribbon absolute right-16 top-0 w-8 cursor-pointer ${isSaved ? "h-16 bg-rust" : "h-11 bg-line-strong hover:h-14 hover:bg-gold"}`} />
          <span className="eyebrow mt-2 pe-24">Today&apos;s picks</span>
          <h2 dir="auto" className="m-0 font-serif text-[30px] font-semibold leading-tight">{book.title}</h2>
          <span className="text-sm text-muted">{book.authors?.[0]}</span>
          {book.match > 0 && <Warmth match={book.match} />}
          {book.reasonText && (
            <div className="mt-2 flex items-center gap-3 rounded-md bg-parchment p-3">
              {book.reasonBook && <span className="w-9 flex-none rotate-[-4deg]"><Cover book={book.reasonBook} small className="[&_span]:hidden" /></span>}
              <span dir="auto" className="text-sm leading-snug text-ink-soft">{book.reasonText}</span>
            </div>
          )}
          <Link href={`/books/${book.id}`} className="btn btn-primary mt-auto self-start">Open the book</Link>
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={back} disabled={index === 0} aria-label="Turn back a page" className="icon-btn disabled:opacity-30"><ArrowIcon back /></button>
            {/* a leaf per pick: the ones you've turned are coloured */}
            <span role="img" aria-label={`Page ${index + 1} of ${books.length}`} className="flex gap-1">
              {books.map((b, i) => <Leaf key={b.id} size={15} vein={null} color={i <= index ? "#A2431F" : "#D6BE98"} />)}
            </span>
            <button type="button" onClick={next} disabled={last} aria-label="Turn the page" className="icon-btn disabled:opacity-30"><ArrowIcon /></button>
          </div>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close the book" className="icon-btn absolute right-3 top-3 z-10 text-ink"><XIcon /></button>
      </div>
    </div>
  );
}
