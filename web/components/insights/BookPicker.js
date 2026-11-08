"use client";

// "Which book?" on Author insights: a glass card showing the chosen book (its
// cover, or a fan of covers for "All my books") that opens a list of the author's
// books - each with its cover, year, average rating and a small bar for how many
// ratings it has compared with the others. Type to filter (when there are many),
// ↑ ↓ Enter, Esc. The list rises gently into place, like the hover cards.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Cover from "@/components/Cover";

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
const year = (d) => (d ? String(d).slice(0, 4) : null);
const totalRatings = (b) => (b.ratings || 0) + (b.goodreads?.ratings || 0);
const avg = (b) => b.avgRating ?? b.goodreads?.avgRating ?? null;
const FILTER_FROM = 7; // a search box in the list once there are this many books

const Chevron = ({ open }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"
    className={`transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);

// a fan of up to 3 covers ("All my books")
function Fan({ books, size = 44 }) {
  const shown = books.slice(0, 3);
  return (
    <span className="relative block flex-none" style={{ width: size + 22, height: size * 1.5 }} aria-hidden="true">
      {shown.map((b, i) => (
        <span key={b.id} className="absolute top-0 block transition-transform duration-300 group-hover/pick:-translate-y-0.5"
          style={{ left: i * 11, width: size, transform: `rotate(${(i - (shown.length - 1) / 2) * 7}deg)`, zIndex: 3 - i }}>
          <Cover book={b} small className="shadow-[0_4px_10px_rgba(60,35,15,0.25)]" />
        </span>
      ))}
    </span>
  );
}

function Stars({ value }) {
  if (value == null) return <span className="text-xs text-muted">no ratings yet</span>;
  return (
    <span className="flex items-center gap-1 text-[13px] font-bold text-ink">
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="#B8893B" /></svg>
      {value.toFixed(2)}
    </span>
  );
}

export default function BookPicker({ books, all, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const button = useRef(null);
  const search = useRef(null);
  const listId = useId();

  const options = useMemo(() => [{ ...all, isAll: true }, ...books], [all, books]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? options.filter((o) => !o.isAll && o.title.toLowerCase().includes(f)) : options;
  }, [options, filter]);
  const most = Math.max(1, ...books.map(totalRatings));
  const current = options.find((o) => o.id === value) || options[0];

  // close when clicking anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  // focus the search box (or keep it on the button) when the list opens
  // (a moment later: the list is still turning visible, and a hidden box can't take focus)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  function toggle() {
    if (!open) { setFilter(""); setActive(Math.max(0, options.findIndex((o) => o.id === value))); }
    setOpen(!open);
  }
  function choose(o) {
    onChange(o.id); setOpen(false); setFilter("");
    button.current?.focus();
  }
  function onKey(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); toggle(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && shown[active]) { e.preventDefault(); choose(shown[active]); }
  }
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, listId]);

  const sub = current.isAll
    ? `${books.length} books · ${fmt(totalRatings(current))} ratings in all`
    : [year(current.published_date), avg(current) != null ? `${avg(current).toFixed(2)} ★` : null, `${fmt(totalRatings(current))} ratings`].filter(Boolean).join(" · ");

  return (
    <div ref={box} className="relative z-30 w-full max-w-[640px]" onKeyDown={onKey}>
      <button ref={button} type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        className={`group/pick flex w-full cursor-pointer items-center gap-4 border border-line-strong bg-cream/90 py-3 pl-4 pr-5 text-left text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_12px_30px_rgba(60,35,15,0.12)] backdrop-blur-xl backdrop-saturate-150 transition-[border-radius,background-color] hover:bg-cream/90 ${open ? "rounded-t-md" : "rounded-md"}`}>
        {current.isAll ? <Fan books={books} /> : (
          <span className="block w-11 flex-none transition-transform duration-300 group-hover/pick:-rotate-3 group-hover/pick:scale-105 motion-reduce:transition-none">
            <Cover book={current} small />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Showing</span>
          <span className="truncate font-serif text-[22px] font-semibold leading-tight">{current.title}</span>
          <span className="truncate text-[13px] text-ink-soft">{sub}</span>
        </span>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-rust-soft text-rust-dark"><Chevron open={open} /></span>
      </button>

      {/* the list: rises gently into place */}
      <div className={`absolute inset-x-0 top-full origin-top overflow-hidden rounded-b-md border border-t-0 border-line-strong bg-cream/90 shadow-[0_22px_40px_rgba(60,35,15,0.2)] backdrop-blur-xl backdrop-saturate-150 transition-[opacity,transform,visibility] motion-reduce:transition-none ${open ? "visible translate-y-0 opacity-100 duration-500 ease-[cubic-bezier(.16,1,.3,1)]" : "invisible -translate-y-2 opacity-0 duration-150"}`}>
        <div className="mx-4 border-t border-line" />
        {books.length >= FILTER_FROM && (
          <div className="px-4 pt-3">
            <input ref={search} value={filter} onChange={(e) => { setFilter(e.target.value); setActive(0); }} tabIndex={open ? 0 : -1}
              placeholder="Find one of your books…" aria-label="Find one of your books" aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="w-full rounded-md border border-line-strong bg-cream/80 px-4 py-2 text-sm text-ink outline-none focus:border-ink" />
          </div>
        )}
        <ul id={listId} role="listbox" aria-label="Your books" className="m-0 max-h-[360px] list-none overflow-y-auto p-2">
          {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted">No book matches “{filter}”.</li>}
          {shown.map((o, i) => {
            const selected = o.id === value;
            const n = totalRatings(o);
            return (
              <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={selected}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                className={`group/opt flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${i === active ? "bg-sand" : ""} ${o.isAll ? "mb-1" : ""}`}>
                {o.isAll ? <Fan books={books} size={30} /> : (
                  <span className="block w-[30px] flex-none transition-transform duration-300 group-hover/opt:-rotate-3 group-hover/opt:scale-110 motion-reduce:transition-none">
                    <Cover book={o} small />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={`truncate text-[15px] ${selected ? "font-bold" : "font-medium"}`}>{o.title}</span>
                  {o.isAll ? (
                    <span className="text-xs text-muted">{books.length} books together · {fmt(n)} ratings</span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      {year(o.published_date) && <span className="text-xs text-muted">{year(o.published_date)}</span>}
                      <Stars value={avg(o)} />
                      {/* how many ratings, compared with the author's most-rated book */}
                      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-sand" title={`${fmt(n)} ratings`}>
                        <span className="absolute inset-y-0 left-0 rounded-full bg-rust/80" style={{ width: `${Math.max(4, (n / most) * 100)}%` }} />
                      </span>
                      <span className="text-xs text-muted">{fmt(n)}</span>
                    </span>
                  )}
                </span>
                <span className={`flex-none text-rust ${selected ? "" : "invisible"}`}><Check /></span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
