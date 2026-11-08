// The floating card shown when hovering a book: overall rating + blurb.
// The server adds blurb / avgRating / ratingCount (server/book-peek.js) on the
// For You shelves, "Similar in spirit" and search.
//
// Put it INSIDE an element with `group relative` (usually the book's link):
//   variant="cover" - floats over the cover and grows a little past its edges
//                     (shelves, the "Similar in spirit" grid)
//   variant="pop"   - for small covers: a fixed-size card centred over the cover
// actions: leave room at the bottom for quick-action buttons laid over the card (RecCard)
// It appears after a short pause (so sweeping across a shelf doesn't flash every
// book), also on keyboard focus; never on touch screens (no hover there).


export const hasPeek = (book) => Boolean(book?.blurb || book?.avgRating != null || book?.series);

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

export default function BookPeek({ book, variant = "cover", actions = false }) {
  if (!hasPeek(book)) return null;
  const author = book.authors?.[0];

  // a page laid over the cover:
  //   cover - a little bigger than the cover on every side (grows taller if the text needs it)
  //   pop   - for SMALL covers: a 240px card centred over the cover
  const place = variant === "pop"
    ? "left-1/2 -ml-[120px] w-[240px] -top-3 min-h-[calc(100%+1.5rem)]"
    : "-left-3 -right-3 -top-3 min-h-[calc(100%+1.5rem)]";
  return (
    <div role="tooltip" id={`peek-${book.id}`}
      className={`${SHOW} ${place} absolute z-[15] flex flex-col gap-2 overflow-hidden rounded-md border border-line bg-cream p-4 ${actions ? "pb-14" : ""} text-left text-ink shadow-[0_18px_40px_rgba(90,60,30,0.3)]`}>
      <div className="relative flex flex-col gap-0.5">
        {/* with actions it's a RecCard: the title and author stay in view just under the cover */}
        {!actions && <span className="line-clamp-2 font-serif text-lg font-semibold leading-tight">{book.title}</span>}
        {!actions && author && <span className="text-xs font-normal text-muted">{author}</span>}
        {book.series && <span className="text-xs font-normal text-muted">{book.series.name}{book.series.number != null ? `, book ${book.series.number}` : ""}</span>}
      </div>
      <div className="relative font-normal"><PeekRating book={book} /></div>
      {book.blurb && <p className={`relative m-0 ${actions ? "line-clamp-4" : "line-clamp-6"} text-[13px] font-normal leading-[1.45]`}>{book.blurb}</p>}
      {!actions && <span className="relative mt-auto pt-1 text-xs font-bold tracking-wide text-rust">Open the book →</span>}
    </div>
  );
}
