"use client";

// The top of the For You page: every shelf as a wax seal with its own icon, along a gentle wave.
// A gold ring turns around a seal that hasn't been opened today; opened, it fades. "Today's picks"
// opens as a book (PickStories); every other seal takes you to its shelf. On a phone the seals
// swipe sideways.
// Which seals were opened is a small convenience, kept in this browser. Styles in globals.css.
import { useState } from "react";
import WaxSeal from "./WaxSeal";

const P = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const icon = (d) => <svg {...P}><path d={d} /></svg>;

const ICONS = {
  picks: "M12 3l1.900 5.600L19.500 10.500l-5.600 1.900L12 18l-1.900-5.600L4.500 10.500l5.600-1.900zM19 16.500l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  top: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1 5 3 5.500M17 6h3c0 3-1 5-3 5.500M12 14v3M8 21h8M9.500 21l.5-4h4l.5 4",
  bookmarked: "M6 3h12v18l-6-4-6 4z",
  reading: "M12 6c-2-1.500-5-2-9-2v15c4 0 7 .5 9 2 2-1.500 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v15",
  fantasy: "M15 4l5 5M13 6l5 5L8 21H3v-5zM5 4v3M3.500 5.500h3M19 15v3M17.500 16.500h3",
  "science-fiction": "M12 2c3 2 5 6 5 10l-2 5H9l-2-5c0-4 2-8 5-10zM7 12l-3 4 3.500.5M17 12l3 4-3.500.5M10 20l2 2 2-2M12 8.500v.01",
  "mystery-crime": "M11 11m-6.500 0a6.500 6.500 0 1 0 13 0a6.500 6.500 0 1 0-13 0M16 16l5 5",
  thriller: "M13 2L5 14h6l-1 8 8-12h-6z",
  romance: "M12 20s-7.500-4.600-9-9.200C2 7.400 4.200 5 7 5c2 0 3.800 1.100 5 3 1.200-1.900 3-3 5-3 2.800 0 5 2.400 5 5.800-1.500 4.600-9 9.200-9 9.200z",
  historical: "M4 21h16M6 18h12M7 18V9M12 18V9M17 18V9M3 9l9-6 9 6z",
  contemporary: "M4 21V9l5-3v15M9 21V4l11 4v13M13 11h3M13 15h3M4 21h16",
  classics: "M6 3v18M6 4h9l-1.500 4L15 12H6M18 21H4",
  "young-adult": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.500 10v.01M15.500 10v.01M8 14.500c1 1.500 2.400 2 4 2s3-.5 4-2",
  horror: "M12 3a7 7 0 0 0-7 7v11l2.300-2 2.300 2 2.400-2 2.400 2 2.300-2 2.300 2V10a7 7 0 0 0-7-7zM9.500 10v.01M14.500 10v.01",
  comics: "M4 5h16v11H10l-5 4v-4H4zM8 9h8M8 12h5",
  "poetry-drama": "M20 4c-7 0-12 4-13 11l-2 5M7 15c5 0 9-2 11-6l-5 1 5-3",
  biography: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.500 21c.7-4 3.700-6 7.500-6s6.800 2 7.500 6",
  "history-politics": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.500 2.500 3.500 5.500 3.500 9s-1 6.500-3.500 9c-2.500-2.500-3.500-5.500-3.500-9S9.500 5.500 12 3z",
  "science-nature": "M9 3h6M10 3v6l-5.500 9.500A1.700 1.700 0 0 0 6 21h12a1.700 1.700 0 0 0 1.500-2.500L14 9V3M7.500 15h9",
  psychology: "M9 21v-3H6v-4l-2-1 2-4c1-3 3.500-5 7-5 4 0 7 3 7 7 0 2.500-1 4.500-3 6v4M13 8a2 2 0 0 1 2 2",
  philosophy: "M12 3v4M12 7a5 5 0 0 0-5 5c0 2 1 3 2 4v2h6v-2c1-1 2-2 2-4a5 5 0 0 0-5-5zM10 21h4",
  business: "M3 8h18v12H3zM9 8V5h6v3M3 13h18",
  technology: "M4 5h16v11H4zM2 20h20M9 16v4M15 16v4",
  health: "M4 12h4l2-5 4 10 2-5h4",
  arts: "M12 3a9 9 0 0 0 0 18c1.500 0 2-1 2-2s-1-1.500-1-2.500 1-1.500 2-1.500h3c2 0 3-1.500 3-3 0-5-4-9-9-9zM8 9v.01M12 7v.01M16 9v.01M7 13v.01",
  lifestyle: "M3 12l18-8-8 18-2-8z",
  education: "M2 9l10-5 10 5-10 5zM6 11v5c2 2 10 2 12 0v-5M22 9v6",
  more: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.500 2.500M15.500 15.500L18 18M18 6l-2.500 2.500M8.500 15.500L6 18",
};

const today = () => `bb-seals-${new Date().toISOString().slice(0, 10)}`;
function readOpened() {
  try { return JSON.parse(localStorage.getItem(today())) || []; } catch { return []; }
}

export default function ShelfGallery({ items }) {
  const [opened, setOpened] = useState(readOpened);
  function open(it) {
    const next = [...new Set([...opened, it.id])];
    setOpened(next);
    try { localStorage.setItem(today(), JSON.stringify(next)); } catch {}
    it.onClick();
  }
  return (
    <nav aria-label="Today's picks and shelves">
      <ul className="seals">
        {items.map((it, i) => (
          <li key={it.id} className="swap-in" style={{ animationDelay: `${i * 45}ms` }}>
            <button type="button" onClick={() => open(it)} className={`seal-btn ${i === 0 ? "first" : ""} ${opened.includes(it.id) ? "opened" : ""}`}>
              <WaxSeal>{icon(ICONS[it.icon] || ICONS.reading)}</WaxSeal>
              <span className="seal-name">{it.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
