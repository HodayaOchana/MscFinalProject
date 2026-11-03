"use client";

// The main page, as SHELVES (like a streaming service): "Top 10 for you" first,
// then a row per genre - the user's genres first - each scrolling sideways.
// All from ONE call to the hybrid model (GET /api/me/recommendations/rows): the
// shelves only change how the list is shown, not what the model recommends.
// The library filter works on every shelf. Rating a book or "Not for me" takes
// it off the shelves at once; the next visit uses the new rating.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import RecCard from "@/components/RecCard";
import ShelfRow from "@/components/ShelfRow";
import BookshelfLoader from "@/components/BookshelfLoader";
import Toast, { useToast } from "@/components/Toast";
import { api } from "@/lib/api";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];

export default function ForYouPage() {
  const [me, setMe] = useState(null);
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

  // A card was rated / dismissed: it leaves every shelf at once
  function removeCard(id, message) {
    setHidden((h) => [...h, id]);
    showToast(message);
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
  const rows = (data?.rows || []).map((r) => ({ ...r, books: visible(r.books) })).filter((r) => r.books.length);
  const card = (b, rank) => (
    <div key={b.id} className="relative w-[176px] shrink-0 snap-start sm:w-[190px]">
      {rank && <span aria-hidden="true" className="absolute -right-1.5 -top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-ink px-1.5 text-sm font-bold text-parchment">{rank}</span>}
      <RecCard book={b} showAvailability={near}
        onDismiss={(id) => removeCard(id, "Hidden – we won't suggest it again.")}
        onRated={(id, n) => removeCard(id, `Rated ${n}★ – thanks! Your shelves will use it next time.`)} />
    </div>
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Picked for you</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-tight md:text-[54px]">Your shelves for a slow autumn evening</h1>
          {me && (
            <p className="m-0 text-ink-soft">
              Based on {me.ratingsCount} book{me.ratingsCount === 1 ? "" : "s"} you rated{me.genres.length ? ` and your genres` : ""}. <Link href="/rate-more">Rate more</Link> to sharpen them.
            </p>
          )}
        </div>

        {me && !me.onboarded && (
          <div className="card flex flex-col items-start gap-4 p-8">
            <h2 className="m-0 font-serif text-3xl font-semibold">Let&apos;s get to know your taste</h2>
            <p className="m-0 text-ink-soft">Two quick steps: choose a few genres and rate books you have read.</p>
            <Link href="/onboarding/genres" className="btn btn-primary">Start the 2-minute quiz</Link>
          </div>
        )}

        {me?.onboarded && (
          <section aria-label="Libraries" className="card flex flex-wrap items-center gap-5 rounded-[18px] px-5 py-4">
            <button type="button" role="switch" aria-checked={near} onClick={() => setNear(!near)} className="flex cursor-pointer items-center gap-3 bg-transparent p-0 text-ink">
              <span className={`relative inline-block h-[26px] w-[46px] rounded-full transition-colors ${near ? "bg-moss" : "bg-[#CBBBA3]"}`}>
                <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-cream transition-all ${near ? "left-[23px]" : "left-[3px]"}`} />
              </span>
              <span className="font-bold">Available at a library near me</span>
            </button>
            {near && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-soft">Where
                  <select value={where} onChange={(e) => (e.target.value === "here" ? pickMyLocation() : setWhere(e.target.value))}
                    className="rounded-[10px] border border-line-strong bg-parchment px-3 py-2 text-ink">
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="here">Near my location (10 km)</option>
                  </select>
                </label>
                <div role="group" aria-label="Show" className="flex overflow-hidden rounded-full border border-line-strong text-sm">
                  {[["filter", "Only available"], ["boost", "Available first"]].map(([m, label]) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                      className={`cursor-pointer px-3.5 py-2 ${mode === m ? "bg-ink text-parchment" : "bg-cream text-ink"}`}>{label}</button>
                  ))}
                </div>
                <span className="text-xs text-muted">Demo inventory</span>
              </div>
            )}
          </section>
        )}

        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {me?.onboarded && (loading || (!data && !error)) && <BookshelfLoader label="Arranging your shelves…" />}
        {data && !loading && !top.length && !rows.length && <p className="text-muted">No books match – try another city or “Available first”.</p>}

        {data && !loading && (
          <div className="flex flex-col gap-10">
            {top.length > 0 && (
              <ShelfRow id="shelf-top" title="Top 10 for you" subtitle="Our strongest picks, from everything you rated" count={top.length}>
                {top.map((b, i) => card(b, i + 1))}
              </ShelfRow>
            )}
            {rows.map((r) => (
              <ShelfRow key={r.key} id={`shelf-${r.key}`} title={r.label} count={r.books.length}
                subtitle={r.key === "more" ? "More books that fit your taste" : r.chosen ? "From a genre you chose" : "Also fits your taste"}>
                {r.books.map((b) => card(b))}
              </ShelfRow>
            ))}
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </AppShell>
  );
}
