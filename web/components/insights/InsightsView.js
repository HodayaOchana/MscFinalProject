"use client";

// The Insights page: personal reading analytics from GET /api/me/insights
// (server/insights.js). Every number here is checked against the raw data by
// server/test-insights.js (the proposal's "100% match to the raw event log").
import { useEffect, useState } from "react";
import Link from "next/link";
import BookshelfLoader from "@/components/BookshelfLoader";
import Stars from "@/components/Stars";
import WaxSeal from "@/components/WaxSeal";
import { OpenBookIcon, FilesIcon, StarIcon, BookmarkIcon, SparkIcon, CheckIcon, XIcon, ArrowIcon } from "@/components/Icons";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth/client";
import { useWormPage } from "@/lib/worm";

const MONTH = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const fmt = (n) => (n ?? 0).toLocaleString("en-US");

// A number with its icon; the sentence behind it waits in the hover title
export function Tile({ label, value, sub, icon, wax = "" }) {
  return (
    <div className="card flex flex-col items-start gap-2 p-4 transition-transform sm:flex-row sm:items-center sm:gap-3.5 hover:-translate-y-0.5 motion-reduce:transform-none" title={icon ? sub || undefined : undefined}>
      {icon && <WaxSeal className={`static ${wax}`}>{icon}</WaxSeal>}
      <span className="flex min-w-0 flex-col">
        <span className="font-serif text-[30px] font-semibold leading-none text-ink">{value}</span>
        <span className="mt-1 text-[13px] text-muted">{label}</span>
        {sub && !icon && <span className="text-[13px] text-muted">{sub}</span>}
      </span>
    </div>
  );
}

// chapter: a small "Chapter 1" over the title, as in a book
export function Section({ id, title, intro, chapter, children }) {
  return (
    <section aria-labelledby={id} className="card flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-col gap-1">
        {chapter && <span className="font-serif text-sm italic text-rust">Chapter {chapter}</span>}
        <h2 id={id} className="m-0 font-serif text-2xl font-semibold tracking-tight">{title}</h2>
        {intro && <p className="m-0 text-sm text-ink-soft">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

// Grouped columns per month: finished (rust) + rated in the app (blue). Hover/focus shows the values.
function ActivityChart({ data }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.finished, d.rated]));
  const empty = data.every((d) => !d.finished && !d.rated);
  if (empty) return <p className="m-0 text-muted">No pages turned yet. Finish or rate a book and your year starts filling up.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-5 text-[13px] text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-1)" }} />Finished</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-2)" }} />Rated</span>
      </div>
      <div className="relative flex h-[170px] items-end gap-1.5 border-b border-[var(--chart-grid)] sm:gap-3" aria-hidden="true">
        {data.map((d, i) => (
          <div key={d.month} tabIndex={0} className="bar-hit relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] outline-none">
            {[["finished", "var(--chart-1)"], ["rated", "var(--chart-2)"]].map(([k, c]) => (
              <div key={k} className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${(d[k] / max) * 100}%`, minHeight: d[k] ? 3 : 0, background: c }} />
            ))}
            {/* the tip opens inward at the edges, so it never sticks out of the page */}
            <div className={`bar-tip absolute -top-14 z-10 whitespace-nowrap rounded-lg border border-line-strong bg-cream px-2.5 py-1.5 text-xs text-ink shadow-[0_6px_14px_rgba(90,55,25,0.2)] ${i < 3 ? "left-0" : i > data.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
              {MONTH(d.month)}: {d.finished} finished · {d.rated} rated
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 sm:gap-3" aria-hidden="true">
        {data.map((d) => (
          <span key={d.month} className="min-w-0 flex-1 text-center text-[11px] text-muted">
            <span className="hidden sm:inline">{MONTH(d.month)}</span><span className="sm:hidden">{MONTH(d.month).charAt(0)}</span>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Books finished and rated per month</caption>
        <thead><tr><th>Month</th><th>Finished</th><th>Rated in the app</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.finished}</td><td>{d.rated}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// Horizontal bars, one series. Value label at the end of each bar (text in ink, not the bar color).
export function HBars({ rows, max, label, value, tag }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => (
        <li key={label(r)} className="grid grid-cols-[minmax(120px,220px)_1fr] items-center gap-3">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-snug">{label(r)}{tag?.(r)}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (value(r) / max) * 100)}%`, background: "var(--chart-1)" }} />
            <span className="text-sm text-ink-soft">{value(r)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Genres as bubbles, the ones you love most the biggest; a check = you picked it at sign-up
function GenreBubbles({ genres }) {
  const max = Math.max(...genres.map((g) => g.count));
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {genres.map((g) => {
        const big = g.count / max;
        return (
          <li key={g.key} title={`${g.count} loved ${g.count === 1 ? "book" : "books"}${g.chosen ? " · you picked this at sign-up" : ""}`}
            className={`flex items-center gap-1.5 rounded-md font-semibold transition-transform hover:scale-105 motion-reduce:transform-none ${big > 0.66 ? "bg-rust px-4 py-2.5 text-lg text-cream" : big > 0.33 ? "bg-rust-soft px-3.5 py-2 text-rust-dark" : "bg-sand px-3 py-1.5 text-sm text-ink-soft"}`}>
            {g.chosen && <CheckIcon />}{g.label}<span className="font-normal opacity-80">{g.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

// A series as a row of spines: the coloured ones are read
function SeriesSpines({ s }) {
  const shown = Math.min(s.total, 16);
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/series/${encodeURIComponent(s.name)}`} className="font-bold text-ink no-underline hover:text-rust">{s.name}</Link>
        <span className="text-sm text-ink-soft">{s.read}/{s.total}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="spine-bar min-w-0 flex-1" role="progressbar" aria-label={`${s.name}: ${s.read} of ${s.total} read`} aria-valuenow={s.read} aria-valuemin={0} aria-valuemax={s.total}>
          {Array.from({ length: shown }, (_, i) => <span key={i} className={i < Math.round((s.read / s.total) * shown) ? "read" : ""} />)}
        </div>
        {s.nextBookId && <Link href={`/books/${s.nextBookId}`} aria-label={`Next book in ${s.name}`} title="Next in the series" className="icon-btn flex-none text-rust no-underline"><ArrowIcon /></Link>}
      </div>
    </li>
  );
}

export default function InsightsView({ preview = null }) {
  const { data: session } = authClient.useSession();
  const [data, setData] = useState(preview); // preview: sample data for a design check, never in the app
  const [error, setError] = useState(null);
  useEffect(() => { if (!preview) api("/api/me/insights").then(setData).catch((e) => setError(e.message)); }, [preview]);
  const nextSeries = data?.series?.inProgress?.find((s) => s.nextBookId);
  useWormPage({ stats: data ? { topGenre: data.taste?.loved?.[0]?.label, nextInSeries: nextSeries ? { name: nextSeries.name, id: nextSeries.nextBookId } : null } : {} });

  if (error) return <p role="alert" className="text-rust-dark">Could not load your insights: {error}</p>;
  if (!data) return <BookshelfLoader label="Counting your shelves…" />;

  const { totals, activity, taste, ratingStyle, series, notForMe, topAuthors } = data;
  const topLoved = taste.loved[0];
  const chosenLabels = taste.chosen.map((c) => c.label);
  const surprise = topLoved && !topLoved.chosen;
  const distMax = Math.max(1, ...ratingStyle.distribution.map((d) => d.count));
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];

  if (!totals.read && !totals.tbr) {
    return (
      <div className="card flex flex-col items-start gap-4 p-8">
        <h1 className="m-0 font-serif text-4xl font-semibold">Your reading journal is still blank</h1>
        <p className="m-0 text-ink-soft">Rate a few books and write its first page.</p>
        <Link href="/rate-more" className="btn btn-primary">Rate some books</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-4">
          <WaxSeal className="static lg"><OpenBookIcon /></WaxSeal>
          <h1 className="m-0 font-serif text-4xl font-semibold tracking-tight md:text-5xl">{firstName ? `${firstName}'s reading journal` : "Your reading journal"}</h1>
        </div>
        {topLoved && <p className="m-0 flex items-center gap-2 text-lg text-ink-soft"><span className="text-gold"><SparkIcon /></span>A {topLoved.label} reader at heart</p>}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={<OpenBookIcon />} label="Books read" value={fmt(totals.read)} sub={`${fmt(totals.rated)} rated · ${fmt(totals.finished)} finished`} />
        <Tile icon={<FilesIcon />} wax="olive" label="Pages turned" value={fmt(totals.pagesRead)} sub={totals.booksWithPages < totals.read ? `${totals.booksWithPages} of ${totals.read} books have a page count` : "across your read books"} />
        <Tile icon={<StarIcon />} wax="ochre" label="Average stars" value={totals.avgRating ?? "–"} sub={totals.avgRating ? "out of 5 stars" : "no ratings yet"} />
        <Tile icon={<BookmarkIcon />} label="Bookmarked" value={fmt(totals.tbr)} sub={totals.oldestTbr ? `waiting longest: ${totals.oldestTbr.title}` : "nothing saved yet"} />
      </div>

      <Section id="taste" chapter="1" title="The genres you really love">
        {surprise && chosenLabels.length > 0 && (
          <p className="m-0 flex items-center gap-2 text-[15px] text-rust-dark"><span className="flex-none"><SparkIcon /></span><span>A plot twist: you picked {chosenLabels.join(", ")}, but your heart says <strong>{topLoved.label}</strong>.</span></p>
        )}
        {taste.loved.length > 0
          ? <GenreBubbles genres={taste.loved} />
          : <p className="m-0 text-muted">Give a few books 4–5 stars and your favourites will appear here.</p>}
      </Section>

      <Section id="activity" chapter="2" title="Your year in pages">
        <ActivityChart data={activity} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="rating" chapter="3" title="You, the critic"
          intro={ratingStyle.generousThan !== null ? `More generous than ${ratingStyle.generousThan}% of readers · your average ${ratingStyle.avg}, theirs ${ratingStyle.readersAvg}` : null}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[...ratingStyle.distribution].reverse().map((d) => (
              <li key={d.stars} className="flex items-center gap-3">
                <span className="flex-none"><Stars value={d.stars} size={15} /></span>
                <span className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1, (d.count / distMax) * 55)}%`, background: "var(--chart-1)" }} />
                <span className="text-sm text-ink-soft">{d.count}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="authors" chapter="4" title="Your favourite authors">
          {topAuthors.length === 0 ? <p className="m-0 text-muted">Love a few books and your favourite authors appear here.</p> : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {topAuthors.map((a) => (
                <li key={a.name} className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-moss-soft font-serif font-semibold text-moss-dark">{a.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                  <span className="text-sm text-ink-soft" title={`${a.count} loved ${a.count === 1 ? "book" : "books"}`}>{a.count} ♥</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {(series.inProgress.length > 0 || series.completed > 0) && (
        <Section id="series" chapter="5" title="Sagas to be continued" intro={series.completed ? `${series.completed} finished!` : null}>
          <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-2">
            {series.inProgress.map((s) => <SeriesSpines key={s.name} s={s} />)}
          </ul>
        </Section>
      )}

      {notForMe.count > 0 && (
        <p className="m-0 flex items-center gap-2 text-sm text-muted" title={notForMe.genres.length ? `Mostly ${notForMe.genres.slice(0, 2).map((g) => g.label).join(" and ")}` : undefined}>
          <XIcon />{notForMe.count} {notForMe.count === 1 ? "book" : "books"} put back on the shelf as “Not for me”. We won’t suggest them again.
        </p>
      )}
    </div>
  );
}
