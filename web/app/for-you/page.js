"use client";

// The main page, as SHELVES: what the reader is reading now, "Top 10 for you", their TBR, and a
// row per genre - the user's genres first - each scrolling sideways. On top, a personal greeting
// and wax seals: today's picks open as a book (PickStories), the others jump to their shelf.
// All from ONE call to the hybrid model (GET /api/me/recommendations/rows): the
// shelves only change how the list is shown, not what the model recommends.
// The library filter works on every shelf. Rating a book or "Not for me" takes
// it off the shelves at once; the next visit uses the new rating.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import RecCard from "@/components/RecCard";
import ShelfRow from "@/components/ShelfRow";
import PickStories from "@/components/PickStories";
import { Candle, Drift } from "@/components/Seasonal";
import ShelfGallery from "@/components/ShelfGallery";
import BookshelfLoader from "@/components/BookshelfLoader";
import Toast, { useToast } from "@/components/Toast";
import { FlameIcon } from "@/components/Icons";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth/client";
import { scrollToNewItem } from "@/lib/scroll";
import { useWormPage } from "@/lib/worm";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];
const STORY_PICKS = 5;
const hello = (h) => (h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const moment = (h) => (h < 5 ? "One more chapter?" : h < 12 ? "Something for your morning coffee." : h < 18 ? "A little something for your afternoon." : "Blanket on, tea poured. Here's your evening.");

export default function ForYouPage() {
  const { data: session } = authClient.useSession();
  const [me, setMe] = useState(null);
  const [tbr, setTbr] = useState([]);
  const [reading, setReading] = useState([]);
  const [hour, setHour] = useState(null); // the reader's own clock (only known in the browser)
  const [stories, setStories] = useState(false); // today's picks, opened as a book
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [near, setNear] = useState(false);
  const [where, setWhere] = useState("Jerusalem"); // a city, or "here" = my location
  const [mode, setMode] = useState("filter");
  const [coords, setCoords] = useState(null);
  const [hidden, setHidden] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api("/api/me").then((m) => {
      setMe(m);
      if (m.preferredCity) setWhere(m.preferredCity);
    }).catch((e) => setError(e.message));
    setHour(new Date().getHours()); // eslint-disable-line react-hooks/set-state-in-effect
    api("/api/me/shelf").then((r) => { setTbr(r.saved || []); setReading(r.reading || []); }).catch(() => {}); // these shelves are optional
  }, []);

  // the address of the shelves (null while waiting for my location)
  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (near) {
      if (where === "here") {
        if (!coords) return null;
        q.set("lat", coords.lat); q.set("lng", coords.lng); q.set("radiusKm", "10");
      } else q.set("city", where);
      q.set("mode", mode);
    }
    const qs = q.toString();
    return `/api/me/recommendations/rows${qs ? `?${qs}` : ""}`;
  }, [near, where, mode, coords]);

  const load = useCallback(async () => {
    const url = query();
    if (!url) return;
    setLoading(true);
    try {
      const r = await api(url);
      setError(null); setData(r); setHidden([]);
    }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { if (me?.onboarded) load(); }, [me, load]); // eslint-disable-line react-hooks/set-state-in-effect

  // A card was dismissed: it leaves every shelf at once (a rated one stays, with its stars).
  // The message is the "Why not?" slip (components/WhyNot.js).
  function removeCard(id) {
    setHidden((h) => [...h, id]);
  }

  function pickMyLocation() {
    setWhere("here");
    if (coords) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) }),
      () => { setError("Could not get your location – choose a city instead."); setWhere("Jerusalem"); }
    );
  }

  const visible = (list) => (list || []).filter((b) => !hidden.includes(b.id));
  const top = visible(data?.top);
  const saved = visible(tbr).map((b) => ({ ...b, saved: true }));
  const rows = (data?.rows || []).map((r) => ({ ...r, books: visible(r.books) })).filter((r) => r.books.length);
  // "Continue your series" / "Because you looked at <book>" - they change with what you do (server/fresh-rows.js)
  const fresh = (data?.fresh || []).map((r) => ({ ...r, books: visible(r.books) })).filter((r) => r.books.length);
  const card = (b, key = b.id, rank, i = 0) => (
    <div key={key} className="book-w swap-in relative snap-start" style={{ animationDelay: `${Math.min(i, 7) * 50}ms` }}>
      <RecCard book={b} rank={rank} showAvailability={near}
        onDismiss={removeCard}
        onRated={(id, n) => showToast(`Rated ${n}★ – thanks! Your shelves will use it next time.`)} />
    </div>
  );
  const ready = data && !loading;
  useWormPage({ books: [...top, ...rows.flatMap((r) => r.books)], stats: { ratings: me?.ratingsCount, topPick: top[0] } });
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const jumps = ready ? [
    ...(top.length ? [["shelf-top", "Top 10", "top"]] : []),
    ...(saved.length ? [["shelf-tbr", "Bookmarked", "bookmarked"]] : []),
    ...rows.map((r) => [`shelf-${r.key}`, r.label, r.key]),
  ] : [];

  return (
    <AppShell width="max-w-[1400px]">
      <div className="flex flex-col gap-5">
        <div>
        <header className="relative isolate flex flex-col gap-1">
          <Drift />
          <h1 className="m-0 flex items-end gap-3 font-serif text-3xl font-semibold tracking-tight md:text-4xl">
            <Candle />
            <span>{hour === null ? "Welcome back" : hello(hour)}{firstName ? <>, <em className="font-medium text-rust">{firstName}</em></> : ""}</span>
          </h1>
          <p className="m-0 min-h-6 text-ink-soft">{hour !== null && moment(hour)}</p>
          {me?.onboarded && (
            <p className="m-0 text-sm text-muted">
              Picked from your {me.ratingsCount} rating{me.ratingsCount === 1 ? "" : "s"}. <Link href="/rate-more">Rate more</Link>
            </p>
          )}
        </header>
        </div>

        {ready && top.length > 0 && (
          <ShelfGallery items={[
            { id: "picks", icon: "picks", label: "Today's picks", onClick: () => setStories(true) },
            ...jumps.map(([id, label, icon]) => ({ id, label, icon, onClick: () => scrollToNewItem(id, 84) })),
          ]} />
        )}

        {me && !me.onboarded && (
          <div>
            <div className="card flex flex-col items-start gap-4 p-8">
              <h2 className="m-0 font-serif text-2xl font-bold">Let&apos;s get to know your taste</h2>
              <p className="m-0 text-ink-soft">Two quick steps: choose a few genres and rate books you have read.</p>
              <Link href="/onboarding/genres" className="btn btn-primary">Start the 2-minute quiz</Link>
            </div>
          </div>
        )}

        {me?.onboarded && (
          <section aria-label="Libraries and shelves" className="flex flex-col gap-2">
            <div className="shelf-scroll flex items-center gap-2 overflow-x-auto">
              <button type="button" role="switch" aria-checked={near} onClick={() => setNear(!near)} className="flex shrink-0 cursor-pointer items-center gap-2 bg-transparent py-1 pe-2 text-sm text-ink">
                <span className={`relative inline-block h-[22px] w-[38px] rounded-full transition-colors ${near ? "bg-moss" : "bg-line-strong"}`}>
                  <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-ink transition-all ${near ? "left-[19px]" : "left-[3px]"}`} />
                </span>
                <span className="font-semibold">Available at a library near me</span>
              </button>
            </div>
            {near && (
              <div className="flex flex-wrap items-center gap-3 pb-1">
                <label className="flex items-center gap-2 text-sm text-ink-soft">Where
                  <select value={where} onChange={(e) => (e.target.value === "here" ? pickMyLocation() : setWhere(e.target.value))}
                    className="rounded-md border border-line-strong bg-cream px-3 py-1.5 text-ink">
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="here">Near my location (10 km)</option>
                  </select>
                </label>
                <div role="group" aria-label="Show" className="flex overflow-hidden rounded-full border border-line-strong text-sm">
                  {[["filter", "Only available"], ["boost", "Available first"]].map(([m, label]) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                      className={`cursor-pointer px-3.5 py-1.5 ${mode === m ? "bg-rust-soft text-rust-dark" : "bg-cream text-ink"}`}>{label}</button>
                  ))}
                </div>
                <span className="text-xs text-muted">Demo inventory</span>
              </div>
            )}
          </section>
        )}

        <div className="flex flex-col gap-9">
          {error && <p role="alert" className="text-rust-dark">{error}</p>}
          {me?.onboarded && (loading || (!data && !error)) && <BookshelfLoader label="Arranging your shelves…" />}
          {ready && !top.length && !rows.length && !fresh.length && <p className="text-muted">No books match – try another city or “Available first”.</p>}

          {visible(reading).length > 0 && (
            <ShelfRow id="shelf-reading" title="On your nightstand" subtitle="Pick up where you left off" count={reading.length}>
              {visible(reading).map((b, i) => card(b, `reading-${b.id}`, undefined, i))}
            </ShelfRow>
          )}
          {ready && top.length > 0 && (
            <ShelfRow id="shelf-top" title={firstName ? `${firstName}'s top 10` : "Top 10 for you"} subtitle={<>The warmer the <span className="inline-block align-[-2px] text-rust"><FlameIcon /></span>, the closer the match. Tap the little cover to see why.</>} count={top.length}>
              {top.map((b, i) => card(b, b.id, i + 1, i))}
            </ShelfRow>
          )}
          {ready && saved.length > 0 && (
            <ShelfRow id="shelf-tbr" title="Bookmarked" subtitle="The books you saved for later" count={saved.length}>
              {saved.map((b, i) => card(b, `tbr-${b.id}`, undefined, i))}
            </ShelfRow>
          )}
          {ready && fresh.map((r) => (
            <ShelfRow key={r.key} id={`shelf-${r.key}`} count={r.books.length} subtitle={r.subtitle} label={r.label}
              title={r.anchor
                ? <>Because you looked at <Link href={`/books/${r.anchor.id}`} className="italic text-ink no-underline hover:text-rust">{r.anchor.title}</Link></>
                : r.label}>
              {r.books.map((b, i) => card(b, `fresh-${r.key}-${b.id}`, undefined, i))}
            </ShelfRow>
          ))}
          {ready && rows.map((r) => (
            <ShelfRow key={r.key} id={`shelf-${r.key}`} title={r.chosen ? `Because you love ${r.label}` : r.label} count={r.books.length}
              subtitle={r.key === "more" ? "More books that fit your taste" : r.chosen ? "From a genre you chose" : "Also fits your taste"}>
              {r.books.map((b, i) => card(b, b.id, undefined, i))}
            </ShelfRow>
          ))}
        </div>
      </div>
      {stories && <PickStories books={top.slice(0, STORY_PICKS)} onClose={() => setStories(false)} onToast={showToast} />}
      <Toast toast={toast} />
    </AppShell>
  );
}
