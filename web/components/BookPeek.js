// The floating card shown when hovering a book: overall rating + blurb.
// The server adds blurb / avgRating / ratingCount (server/book-peek.js) on the
// For You shelves, "Similar in spirit" and search.
//
// Put it INSIDE an element with `group relative` (usually the book's link):
//   variant="cover" - floats over the cover and grows a little past its edges
//                     (shelves, the "Similar in spirit" grid)
//   variant="pop"   - for small covers: a fixed-size card centred over the cover
//   variant="row"   - the whole search-result row grows into a bigger floating card
//                     (a click anywhere opens the book; an element in `children` with
//                     the class pointer-events-auto - a button - stays clickable)
// It appears after a short pause (so sweeping across a shelf doesn't flash every
// book), also on keyboard focus; never on touch screens (no hover there).

import Link from "next/link";

// the same colours as components/Cover.js (kept here so this file needs nothing new from Cover.js)
const PALETTE = ["#7A3B22", "#3F4A26", "#8C6A2F", "#5B2A1E", "#2F3B33", "#6E4A2A", "#4A3A2E", "#8A4B2A", "#45512B", "#A0612F"];
const coverLook = (book) => ({
  url: book?.thumbnail_url ? String(book.thumbnail_url).replace(/^http:/, "https:") : null,
  bg: PALETTE[Math.abs(Number(book?.id) || 0) % PALETTE.length],
});

export const hasPeek = (book) => Boolean(book?.blurb || book?.avgRating != null);

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function PeekRating({ book, light = false }) {
  if (book.avgRating == null) return <span className={`text-xs ${light ? "opacity-80" : "text-muted"}`}>No ratings yet</span>;
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={light ? "#E9C27A" : "#B8893B"} /></svg>
      <span className="text-[15px] font-bold">{book.avgRating.toFixed(2)}</span>
      <span className={`text-xs ${light ? "opacity-80" : "text-muted"}`}>· {compact(book.ratingCount)} rating{book.ratingCount === 1 ? "" : "s"}</span>
    </span>
  );
}

// shared show / hide: the card RISES gently into place (and fades in); it leaves
// quicker. Hidden & not catching the mouse until the group is hovered.
const SHOW = "pointer-events-none invisible translate-y-4 opacity-0 transition-[opacity,transform,visibility] duration-200 ease-out "
  + "group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 "
  + "group-hover:duration-700 group-hover:delay-150 group-hover:ease-[cubic-bezier(.16,1,.3,1)] "
  + "group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100 "
  + "motion-reduce:translate-y-0 motion-reduce:transition-none";

export default function BookPeek({ book, variant = "cover", children }) {
  if (!hasPeek(book)) return null;
  const author = book.authors?.[0];

  if (variant === "row") {
    // a bigger copy of the row, floating over it (the row itself stays for screen
    // readers and keyboard, so this copy is hidden from them)
    return (
      <div aria-hidden="true"
        className={`${SHOW} absolute -inset-x-3 -top-3 z-30 flex origin-top flex-col gap-3 rounded-2xl border border-white/60 bg-[rgba(255,251,244,0.95)] p-4 text-ink shadow-[0_22px_48px_rgba(43,33,28,0.28)] backdrop-blur-xl backdrop-saturate-150`}>
        <Link href={`/books/${book.id}`} tabIndex={-1} className="absolute inset-0 rounded-2xl" />
        <div className="pointer-events-none relative flex flex-col gap-3">
          {children}
          <div className="flex flex-col gap-1.5">
            <PeekRating book={book} />
            {book.blurb && <p className="m-0 line-clamp-4 text-sm leading-relaxed text-[#3D3029]">{book.blurb}</p>}
          </div>
        </div>
      </div>
    );
  }

  // frosted glass over the cover: the book's OWN colours, blurred (its cover image,
  // enlarged and blurred, as the background), with a light tint so the text reads.
  //   cover - a little bigger than the cover on every side (grows taller if the text needs it)
  //   pop   - for SMALL covers: a 240px card centred over the cover
  const look = coverLook(book);
  const place = variant === "pop"
    ? "left-1/2 -ml-[120px] w-[240px] -top-3 min-h-[calc(100%+1.5rem)]"
    : "-left-3 -right-3 -top-3 min-h-[calc(100%+1.5rem)]";
  return (
    <div role="tooltip" id={`peek-${book.id}`}
      className={`${SHOW} ${place} absolute z-[15] flex flex-col gap-2 overflow-hidden rounded-xl border border-white/30 p-4 text-left text-[#FFFBF4] shadow-[0_24px_50px_rgba(43,33,28,0.4),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]`}>
      <div aria-hidden="true" className="absolute -inset-6 scale-110 opacity-95 blur-2xl saturate-[1.6]"
        style={{ background: look.url ? `${look.bg} url("${look.url}") center / cover` : look.bg }} />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[rgba(20,14,10,0.28)] via-[rgba(20,14,10,0.38)] to-[rgba(20,14,10,0.55)]" />
      <div className="relative flex flex-col gap-0.5">
        <span className="line-clamp-2 font-serif text-[17px] font-semibold leading-tight">{book.title}</span>
        {author && <span className="text-xs font-normal opacity-85">{author}</span>}
      </div>
      <div className="relative font-normal"><PeekRating book={book} light /></div>
      {book.blurb && <p className="relative m-0 line-clamp-6 text-[13px] font-normal leading-[1.45]">{book.blurb}</p>}
      <span className="relative mt-auto pt-1 text-xs font-bold tracking-wide opacity-90">Open the book →</span>
    </div>
  );
}
