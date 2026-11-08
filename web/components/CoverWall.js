"use client";

// A slowly drifting wall of real covers from the catalog, behind the landing hero and the
// sign-in panel. Decoration only: if the API can't be reached, plain coloured books stay.
import { useEffect, useState } from "react";
import Cover from "./Cover";
import { api } from "@/lib/api";

const BLANKS = Array.from({ length: 18 }, (_, i) => ({ id: i, title: "" }));
let shared = null; // the landing page and sign-in share one request

export function catalogFavourites(genres = ["fantasy", "mystery-crime", "romance", "classics", "science-fiction"]) {
  return api("/api/onboarding/books", { method: "POST", auth: false, body: { genres } }).then((r) => r.books);
}

export default function CoverWall({ rows = 4, className = "" }) {
  const [books, setBooks] = useState(BLANKS);
  useEffect(() => {
    shared ??= catalogFavourites().catch(() => { shared = null; return null; });
    let alive = true;
    shared.then((list) => { if (alive && list?.length) setBooks(list); });
    return () => { alive = false; };
  }, []);
  const perRow = Math.max(8, Math.floor(books.length / rows));
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 flex -rotate-6 scale-125 flex-col justify-center gap-3.5 overflow-hidden ${className}`}>
      {Array.from({ length: rows }, (_, r) => {
        // each row starts somewhere else in the list; drawn twice so the drift never ends
        const row = Array.from({ length: perRow }, (_, i) => books[(r * perRow + i) % books.length]);
        return (
          <div key={r} className={`wall-row ${r % 2 ? "back" : ""}`}>
            {[...row, ...row].map((b, i) => <Cover key={i} book={b} small className="w-[150px] flex-none md:w-[170px]" />)}
          </div>
        );
      })}
    </div>
  );
}
