"use client";

// What the page is showing, for the bookworm (components/Bookworm.js) - a tiny shared store:
//   useWormPage({ book })        on a book's page
//   useWormPage({ books: [...] }) on pages that list books (For You, My shelf, search)
//   ...and stats: what else the page knows (e.g. { nightstand: 2 }) - see Bookworm.js, pageNotes
// The page sets it while it is open; the bookworm reads it to talk about these books.
import { useEffect, useSyncExternalStore } from "react";

let current = {};
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function set(next) { current = next; listeners.forEach((fn) => fn()); }

export function useWormPage(page) {
  const key = `${page.book?.id ?? (page.books || []).map((b) => b.id).join(",")}|${JSON.stringify(page.stats || {})}`;
  useEffect(() => {
    set(page);
    return () => set({});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const useWormContext = () => useSyncExternalStore(subscribe, () => current, () => current);
