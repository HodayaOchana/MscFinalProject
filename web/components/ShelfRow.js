"use client";

// One shelf on the For You page: a title and a row of books that scrolls sideways
// (swipe on a phone; on a computer, arrows ON the books: right = more, left = back,
// like a streaming service).
import { useCallback, useEffect, useRef, useState } from "react";

const Arrow = ({ dir }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

// onReachEnd: called when the user scrolls to the end (load more books); loading: show a spinner there
export default function ShelfRow({ id, title, subtitle, count, children, titleClass = "text-[28px]", onReachEnd, loading = false }) {
  const scroller = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const reachEnd = useRef(onReachEnd);
  useEffect(() => { reachEnd.current = onReachEnd; }, [onReachEnd]);
  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const end = el.scrollLeft >= max - 4;
    setEdges({ start: el.scrollLeft <= 4, end });
    if (el.scrollLeft >= max - el.clientWidth * 0.5) reachEnd.current?.(); // half a screen before the end
  }, []);
  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, count]);

  const move = (dir) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: (dir === "right" ? 1 : -1) * el.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-0">
      <div className="flex items-end gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`${id}-title`} className={`m-0 font-serif ${titleClass} font-semibold leading-tight`}>{title}</h2>
          {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
        </div>
      </div>
      <div className="relative -mx-6 md:-mx-10">
        <div ref={scroller} onScroll={update} tabIndex={0} aria-label={`${title} – scroll for more`}
          className="shelf-scroll flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-6 px-6 pb-4 pt-4 outline-none md:scroll-px-10 md:px-10">
          {children}
          {loading && (
            <div aria-label="Loading more" className="flex w-24 shrink-0 items-center justify-center self-start pt-[130px]">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-line-strong border-t-rust motion-reduce:animate-none" />
            </div>
          )}
        </div>
        {!edges.end && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-parchment to-transparent" />}
        {!edges.start && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-parchment to-transparent" />}
        {/* the arrows sit on the covers (vertical middle of a cover), only where there is more to see */}
        {!edges.start && (
          <button type="button" onClick={() => move("left")} aria-label={`${title}: back`}
            className="absolute left-3 top-[137px] z-20 hidden h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-cream/95 text-ink shadow-[0_6px_18px_rgba(43,33,28,0.25)] hover:bg-parchment md:flex">
            <Arrow dir="left" />
          </button>
        )}
        {!edges.end && (
          <button type="button" onClick={() => move("right")} aria-label={`${title}: more`}
            className="absolute right-3 top-[137px] z-20 hidden h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-cream/95 text-ink shadow-[0_6px_18px_rgba(43,33,28,0.25)] hover:bg-parchment md:flex">
            <Arrow dir="right" />
          </button>
        )}
      </div>
    </section>
  );
}
