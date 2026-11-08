"use client";

// "Plan your visit" for one library branch - from a book's page (Where to borrow it) and from the
// chat's library map. A small map of the spot, and the ways to get there: Google Maps by car, by
// public transport or on foot, Waze, and parking near the library (a map search around it). Opening
// hours and borrowing rules are on the library's own site (libraries.source_url) - we don't keep
// them, so we link there instead of guessing. The copies are the demo inventory, and say so.
//   branch = { name, city, address, lat, lng, distanceKm?, sourceUrl?, copiesAvailable?, copiesTotal? }
//   books  = the books of this visit on its shelf (optional): [{ id, title }]
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import Link from "next/link";
import WaxSeal from "./WaxSeal";
import { PinIcon, XIcon } from "./Icons";

const I = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const CarIcon = () => <svg {...I}><path d="M5 16h14v-4l-2-5H7l-2 5zM5 16v2M19 16v2M7.500 13h.01M16.500 13h.01" /></svg>;
const BusIcon = () => <svg {...I}><path d="M6 4h12v12H6zM6 11h12M8 19v-3M16 19v-3M8.500 14h.01M15.500 14h.01" /></svg>;
const WalkIcon = () => <svg {...I}><path d="M13 4.500a1.500 1.500 0 1 0 0-.01M10 21l2-6 3 3v3M9 12l2-4 3 2 3 1M11 8l-2 5" /></svg>;
const WazeIcon = () => <svg {...I}><path d="M5 15c-1.500 0-2-1-2-2 1 0 1.500-.5 1.500-2.500C4.500 6.500 8 4 12 4s8 3 8 7c0 4-3.500 6-7 6H9M9 10h.01M14 10h.01M9.500 13c1.300 1 3.700 1 5 0M7 19a1.500 1.500 0 1 0 0-.01M15 19a1.500 1.500 0 1 0 0-.01" /></svg>;
const ParkIcon = () => <svg {...I}><path d="M4 4h16v16H4zM10 16V8h3a2.500 2.500 0 0 1 0 5h-3" /></svg>;
const ClockIcon = () => <svg {...I}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;

const google = (b, mode) => `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}${mode ? `&travelmode=${mode}` : ""}`;

export default function LibraryVisit({ branch: b, books = [], onClose }) {
  const box = useRef(null);
  const closeRef = useRef(null);
  const placed = b.lat != null && b.lng != null;

  useEffect(() => {
    closeRef.current?.focus();
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  useEffect(() => {
    if (!placed) return;
    let map = null;
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false, zoomControl: true }).setView([b.lat, b.lng], 16);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "grayscale-[60%] sepia-[25%] opacity-85",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const pin = `<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#A2431F;border:3px solid #FFF9EC;box-shadow:0 3px 8px rgba(60,35,15,.45)"></span>`;
      L.marker([b.lat, b.lng], { icon: L.divIcon({ html: pin, className: "", iconSize: [22, 22], iconAnchor: [11, 24] }), title: b.name }).addTo(map);
    });
    return () => { cancelled = true; map?.remove(); };
  }, [b.lat, b.lng, b.name, placed]);

  const ways = placed ? [
    ["By car", google(b, "driving"), <CarIcon key="c" />],
    ["Public transport", google(b, "transit"), <BusIcon key="b" />],
    ["On foot", google(b, "walking"), <WalkIcon key="w" />],
    ["Waze", `https://waze.com/ul?ll=${b.lat},${b.lng}&navigate=yes`, <WazeIcon key="z" />],
  ] : [];

  return (
    <div role="dialog" aria-modal="true" aria-label={`Plan your visit to ${b.name}`} onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(239,221,191,0.85)] backdrop-blur-sm sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="quiet-scroll swap-in relative flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-y-auto rounded-t-lg border border-line-strong bg-cream shadow-[0_24px_50px_rgba(90,60,30,0.3)] sm:rounded-lg">
        <div className="flex items-start gap-3 p-5 pb-4">
          <WaxSeal className="static">{<PinIcon />}</WaxSeal>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="m-0 font-serif text-[26px] font-semibold leading-tight">{b.name}</h2>
            <span className="text-sm text-ink-soft">{[b.address, b.city].filter(Boolean).join(", ")}{b.distanceKm != null ? ` · ${b.distanceKm} km from you` : ""}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="icon-btn flex-none text-ink"><XIcon /></button>
        </div>

        {placed && <div ref={box} role="img" aria-label={`Map: ${b.name}`} className="z-0 h-[220px] w-full border-y border-line bg-sand sm:h-[260px]" />}

        <div className="flex flex-col gap-5 p-5">
          {placed && (
            <section aria-labelledby="visit-way" className="flex flex-col gap-2.5">
              <h3 id="visit-way" className="eyebrow m-0">Getting there</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ways.map(([label, href, icon]) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 rounded-md border border-line-strong bg-parchment px-2 py-3 text-center text-sm font-medium text-ink no-underline transition-[transform,border-color] hover:-translate-y-0.5 hover:border-rust hover:text-rust motion-reduce:transform-none">
                    <span className="text-rust">{icon}</span>{label}
                  </a>
                ))}
              </div>
              <a href={`https://www.google.com/maps/search/parking/@${b.lat},${b.lng},17z`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 self-start text-sm font-medium">
                <ParkIcon />Find parking near the library ↗
              </a>
            </section>
          )}

          <section aria-labelledby="visit-borrow" className="flex flex-col gap-2">
            <h3 id="visit-borrow" className="eyebrow m-0">Borrowing</h3>
            {b.copiesTotal > 0 && (
              <p className="m-0 text-[15px] text-moss-dark"><strong>{b.copiesAvailable} of {b.copiesTotal}</strong> {b.copiesTotal === 1 ? "copy" : "copies"} on the shelf</p>
            )}
            {books.length > 0 && (
              <p className="m-0 text-[15px] text-ink-soft">On the shelf here: {books.map((x, i) => <span key={x.id}>{i > 0 && " · "}<Link href={`/books/${x.id}`}>{x.title}</Link></span>)}</p>
            )}
            {b.sourceUrl && (
              <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 self-start text-sm font-medium">
                <ClockIcon />Opening hours and borrowing rules – on the library&apos;s site ↗
              </a>
            )}
            <p className="m-0 text-xs text-muted">The copies are a demo inventory, not live library data – check with the library before you go.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
