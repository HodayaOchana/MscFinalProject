"use client";

// A book cover: the real image from the catalog, or a warm colored cover with the title
import { useState } from "react";

const PALETTE = ["#7A3B22", "#3F4A26", "#8C6A2F", "#5B2A1E", "#2F3B33", "#6E4A2A", "#4A3A2E", "#8A4B2A", "#45512B", "#A0612F"];

// the catalog's links point at a tiny image (98px wide): ask for the large one; the
// original stays as the fallback. "nophoto" is a grey placeholder - our coloured cover is nicer.
const LARGE = /(\/books\/\d+)m\//;

// the cover's image link (or null) and its background colour - also used by the hover card (BookPeek)
export function coverLook(book) {
  const original = book?.thumbnail_url && !/nophoto/.test(book.thumbnail_url) ? String(book.thumbnail_url).replace(/^http:/, "https:") : null;
  return {
    url: original && original.replace(LARGE, "$1l/"),
    original,
    bg: PALETTE[Math.abs(Number(book?.id) || 0) % PALETTE.length],
  };
}

export default function Cover({ book, className = "", small = false }) {
  const [failures, setFailures] = useState(0);
  const look = coverLook(book);
  const url = [...new Set([look.url, look.original])].filter(Boolean)[failures] || null;
  const bg = look.bg;
  const author = Array.isArray(book?.authors) ? book.authors[0] : book?.authors;
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-[3px] shadow-[0_4px_12px_rgba(90,55,25,0.22)] transition-transform duration-300 ease-out group-hover:-translate-y-1 motion-reduce:transform-none ${className}`} style={{ background: bg }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Cover of ${book.title}`} loading="lazy" className="h-full w-full object-cover" onError={() => setFailures((f) => f + 1)} />
      ) : (
        <div className="flex h-full flex-col justify-between p-3 text-[#FBF4E8]">
          <span className={`font-serif font-semibold leading-tight ${small ? "text-[11px]" : "text-xl"}`}>{book?.title}</span>
          {!small && author && <span className="text-[11px] uppercase tracking-wider opacity-85">{author}</span>}
        </div>
      )}
    </div>
  );
}
