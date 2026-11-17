"use client";

// Where to borrow the books of one chat answer: a map (Leaflet + OpenStreetMap
// tiles) with the reader ("near me" only) and, at each branch, the covers of the
// answer's books on its shelf (up to 3, fanned out, "+N" for more; a click shows
// them all with links). The same branches as a list under it (for the keyboard
// and screen readers, and for anyone who prefers a list).
//   places = { here: { lat, lng } | null, branches: [{ id, name, city, address, lat, lng, distanceKm?, books: [ids] }] }
// "Plan your visit" (in a branch's popup and in the list) opens LibraryVisit: getting there, parking,
// opening hours. Leaflet touches `window`, so it is loaded in the browser only (useEffect).
// Its stylesheet is imported by app/chat/page.js.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PinIcon } from "@/components/Icons";
import { coverLook } from "@/components/Cover";
import LibraryVisit from "@/components/LibraryVisit";

const RUST = "#A24B25";
const MOSS = "#5E5A2B";
const CREAM = "#FFFBF4";
const FAN = 3;        // covers shown on a branch
const COVER_W = 40;
const COVER_H = 60;
const STEP = 18;      // px between fanned covers
const PIN_H = 76;     // marker height: cover + the dot under it
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// a cover as HTML for Leaflet (the image as a background: a broken link just shows the cover's colour)
function coverHtml(book, w, h, extra = "") {
  const { url, bg } = coverLook(book);
  const img = url ? `background-image:url('${encodeURI(url).replace(/'/g, "%27")}');background-size:cover;background-position:center;` : "";
  const text = url ? "" : `<span style="display:block;padding:3px;font:600 ${Math.round(w / 6)}px/1.1 serif;color:${CREAM};overflow:hidden">${esc(book.title)}</span>`;
  return `<div style="width:${w}px;height:${h}px;background-color:${bg};${img}border:2px solid ${CREAM};border-radius:3px;box-shadow:0 3px 8px rgba(60,35,15,.35);overflow:hidden;${extra}">${text}</div>`;
}

// the marker: the branch's covers fanned out over a small dot (the exact spot)
function pinHtml(covers, more) {
  const n = covers.length;
  const width = COVER_W + (n - 1) * STEP;
  const fan = covers.map((b, i) => coverHtml(b, COVER_W, COVER_H,
    `position:absolute;left:${i * STEP}px;top:${i === Math.floor(n / 2) ? 0 : 3}px;transform:rotate(${(i - (n - 1) / 2) * 9}deg);z-index:${i === Math.floor(n / 2) ? 3 : 1};`)).join("");
  const badge = more > 0
    ? `<span style="position:absolute;right:-10px;top:-8px;z-index:4;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#2B211C;color:${CREAM};font:700 11px/20px sans-serif;text-align:center">+${more}</span>`
    : "";
  const dot = `<span style="position:absolute;left:${width / 2 - 5}px;bottom:0;width:10px;height:10px;border-radius:999px;background:${RUST};border:2px solid ${CREAM};box-shadow:0 1px 3px rgba(60,35,15,.3)"></span>`;
  return { html: `<div style="position:relative;width:${width}px;height:${PIN_H}px">${fan}${badge}${dot}</div>`, width };
}

export default function LibraryMap({ places, books }) {
  const box = useRef(null);
  const markers = useRef(new Map()); // branch id -> marker, to open it from the list
  const [active, setActive] = useState(null);
  const [visit, setVisit] = useState(null); // the branch whose "Plan your visit" is open
  const bookOf = new Map(books.map((b) => [b.id, b]));
  const titleOf = new Map(books.map((b) => [b.id, b.title]));

  useEffect(() => {
    let map = null;
    let cancelled = false;
    const byBranch = markers.current;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      // OpenStreetMap's own tiles: free, no key (fine for a project's traffic; the credit line is required)
      // faded to the site's colours, so the covers stand out
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "grayscale-[75%] sepia-[20%] opacity-80",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const points = [];
      if (places.here) {
        // above the covers (a marker, not a circle - circles are drawn under markers)
        const you = `<span style="display:block;width:18px;height:18px;border-radius:999px;background:${MOSS};border:3px solid ${CREAM};box-shadow:0 0 0 6px rgba(85,96,48,.25),0 2px 6px rgba(60,35,15,.35)"></span>`;
        L.marker([places.here.lat, places.here.lng], { icon: L.divIcon({ html: you, className: "", iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 10000, title: "You" })
          .bindTooltip("You", { direction: "top", offset: [0, -10] })
          .addTo(map);
        points.push([places.here.lat, places.here.lng]);
      }
      for (const b of places.branches) {
        const here = b.books.map((id) => bookOf.get(id)).filter(Boolean);
        if (!here.length) continue;
        const { html, width } = pinHtml(here.slice(0, FAN), here.length - FAN);
        const icon = L.divIcon({ html, className: "", iconSize: [width, PIN_H], iconAnchor: [width / 2, PIN_H - 5], popupAnchor: [0, -PIN_H + 8] });
        const shelf = here.map((book) =>
          `<a href="/books/${book.id}" style="display:flex;width:62px;flex-direction:column;gap:4px;color:#2B211C;text-decoration:none">` +
          `${coverHtml(book, 58, 87)}<span style="font-size:11px;line-height:1.25;font-weight:600">${esc(book.title)}</span></a>`).join("");
        // the popup as an element, so its button can open "Plan your visit"
        const popup = document.createElement("div");
        popup.innerHTML =
          `<strong style="font-size:14px">${esc(b.name)}</strong><br><span style="font-size:12px;color:#6B5B4E">${esc(b.address)}${b.distanceKm != null ? ` · ${b.distanceKm} km` : ""}</span>` +
          `<div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0">${shelf}</div>` +
          `<button type="button" data-visit style="cursor:pointer;border:0;background:${RUST};color:${CREAM};font:600 13px/1 inherit;padding:8px 12px;border-radius:5px">Plan your visit →</button>`;
        popup.querySelector("[data-visit]").addEventListener("click", () => setVisit(b));
        const marker = L.marker([b.lat, b.lng], { icon, title: `${b.name}: ${here.length} book${here.length === 1 ? "" : "s"}`, zIndexOffset: here.length * 100 })
          .bindPopup(popup, { minWidth: 160, maxWidth: 260 })
          .on("click", () => setActive(b.id))
          .addTo(map);
        byBranch.set(b.id, marker);
        points.push([b.lat, b.lng]);
      }
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(points, { paddingTopLeft: [40, 80], paddingBottomRight: [30, 20], maxZoom: 15 }); // room for the covers above each spot
    });
    return () => {
      cancelled = true;
      byBranch.clear();
      map?.remove();
    };
  }, [places]); // eslint-disable-line react-hooks/exhaustive-deps

  function show(b) {
    setActive(b.id);
    markers.current.get(b.id)?.openPopup();
  }

  return (
    <section aria-label="Where to borrow these books" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-serif text-xl font-semibold leading-tight">{places.here ? "Libraries near you" : "Where to borrow them"}</h2>
        <span className="text-sm text-muted">{places.here ? "Nearest first · " : ""}Demo inventory – not real-time library data</span>
      </div>
      <div className="card overflow-hidden p-0">
        <div ref={box} style={{ fontFamily: "inherit" }} className="z-0 h-[320px] w-full bg-sand md:h-[380px]" role="img" aria-label="Map of the libraries that have these books" />
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {places.branches.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 ${active === b.id ? "bg-parchment" : ""}`}>
              <button type="button" onClick={() => show(b)} className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-start gap-2 border-0 bg-transparent p-0 text-left text-ink">
                <span className="mt-0.5 text-rust"><PinIcon /></span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-bold">
                    {b.name}{b.distanceKm != null && <span className="font-normal text-muted"> · {b.distanceKm} km</span>}
                  </span>
                  <span className="text-[13px] text-muted">{b.address}, {b.city}</span>
                  <span className="text-[13px] text-ink-soft">
                    {b.books.filter((id) => titleOf.has(id)).map((id, i) => (
                      <span key={id}>{i > 0 && " · "}<Link href={`/books/${id}`} className="text-ink-soft hover:text-rust">{titleOf.get(id)}</Link></span>
                    ))}
                  </span>
                </span>
              </button>
              <button type="button" onClick={() => setVisit(b)} className="ml-6 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-sm font-medium text-rust hover:text-rust-dark sm:ml-0">Plan your visit →</button>
            </li>
          ))}
        </ul>
      </div>
      {visit && <LibraryVisit branch={visit} books={visit.books.filter((id) => titleOf.has(id)).map((id) => ({ id, title: titleOf.get(id) }))} onClose={() => setVisit(null)} />}
    </section>
  );
}
