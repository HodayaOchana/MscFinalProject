"use client";

// Where the bookworm's facts come from, besides lib/bookworm-facts.js - all real, all with a source:
//   wikiBook(book)   the opening of the book's English Wikipedia article - only when the article is
//                    about a book AND names its author (so "Twilight" never turns into the sky)
//   wikiAuthor(name) the opening of the author's article - only when it describes a writer
//   bornToday()      a writer born on this day (Wikimedia's "On this day") with books in our catalog
// Wikipedia gets only a book's title or an author's name - nothing about the reader. Results are kept
// in memory (and "born today" for the day, in this browser).
import { api } from "@/lib/api";

const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const surname = (name) => norm(name).split(" ").pop();
// the first sentence or two, up to ~240 characters ("J. K." does not end a sentence)
function opening(text) {
  const parts = String(text).split(/(?<=[a-z0-9)”"]{2}\.)\s+(?=[A-Z“"])/);
  let out = parts[0];
  if (parts[1] && (out + " " + parts[1]).length <= 240) out += " " + parts[1];
  return out.length > 260 ? `${out.slice(0, 250).replace(/\s+\S*$/, "")}…` : out;
}
async function summary(title) {
  try {
    const r = await fetch(WIKI + encodeURIComponent(title.replace(/ /g, "_")), { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const d = await r.json();
    return d.type === "standard" ? d : null;
  } catch { return null; }
}

const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

export function wikiBook(book) {
  const title = String(book?.title || "").replace(/\s*\(.*\)\s*$/, "").trim();
  const author = book?.authors?.[0];
  if (!title || !author) return Promise.resolve(null);
  return once(`book:${title}`, async () => {
    for (const t of [`${title} (novel)`, `${title} (book)`, title]) {
      const d = await summary(t);
      const about = `${d?.description || ""} ${d?.extract || ""}`;
      if (d && /novel|book|novella|memoir|series|story|play|poem|collection/i.test(d.description || "") && norm(about).includes(surname(author))) {
        return { text: opening(d.extract), source: d.content_urls?.desktop?.page };
      }
    }
    return null;
  });
}

export function wikiAuthor(name) {
  if (!name) return Promise.resolve(null);
  return once(`author:${name}`, async () => {
    const d = await summary(name);
    if (!d || !/writer|novelist|author|poet|playwright|journalist|illustrator/i.test(d.description || "")) return null;
    return { text: opening(d.extract), source: d.content_urls?.desktop?.page };
  });
}

// the books of an author in our catalog (the search looks at titles and authors)
async function booksBy(name) {
  try {
    const r = await api(`/api/books/search?q=${encodeURIComponent(name)}`, { auth: false });
    return r.books.filter((b) => (b.authors || []).some((a) => norm(a) === norm(name)));
  } catch { return []; }
}

export function bornToday() {
  const day = new Date();
  const mmdd = `${String(day.getMonth() + 1).padStart(2, "0")}/${String(day.getDate()).padStart(2, "0")}`;
  const key = `bb-worm-born-${mmdd}`;
  return once(key, async () => {
    try { const kept = sessionStorage.getItem(key); if (kept) return JSON.parse(kept); } catch {}
    let found = null;
    try {
      const r = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/${mmdd}`);
      const births = r.ok ? (await r.json()).births || [] : [];
      const writers = births.filter((b) => /\b(novelist|writer|author|poet|playwright)\b/i.test(b.text)).slice(0, 25);
      for (const w of writers) {
        const name = w.text.split(",")[0].trim();
        const books = await booksBy(name);
        if (books.length) {
          const what = w.text.slice(name.length).replace(/^,\s*/, "");
          found = { name, year: w.year, what, count: books.length, source: w.pages?.[0]?.content_urls?.desktop?.page };
          break;
        }
      }
    } catch {}
    try { sessionStorage.setItem(key, JSON.stringify(found)); } catch {}
    return found;
  });
}
