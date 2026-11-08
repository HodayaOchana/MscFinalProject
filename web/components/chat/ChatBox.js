"use client";

// "Ask BookBridge" - the chat with AI model 2 (server/chat.js).
// The answer marks every book as [[book:ID]]; here a marker becomes the
// book's title (a link to its page), and the books show under the answer as a
// shelf, exactly like the For You page: ShelfRow + RecCard (hover card, save
// to TBR, rate, "not for me").
// Every conversation is saved (server/chat.js): the history list on the side
// opens an old one, and the address (/chat?c=<id>) keeps it after a refresh.
// "Use my location": the browser's location goes with each message, for "near me"
// (only while it is on; the server does not save it).
// "Ask about this book" from another page (a book page, a search result, a For You
// card - /chat?book=<id>) opens a NEW chat; on a book card inside the chat it stays in the
// same conversation. Either way the book goes above the message box and the reader writes
// their own question, or picks an idea that goes into the box for them to edit and send - nothing
// is sent for them. The message tells the server which book it is about.
// "Use my location" is remembered in this browser (only that it is on - not the place).
// Answers STREAM: the text appears while it is written, and the waiting line says what
// the bot is doing ("Searching the catalog…"). "Contact the team" under the chat reaches
// a person (the project's email). The chat is in English, like the rest of the site. Each answer can be translated on
// request ("Translate" under it - server: POST /api/chat/translate) and copied, and the
// latest answer offers 2-3 follow-up questions as buttons.
// Hashtags: "#" in the box suggests reader tags (#cozy-mystery), and every hashtag in a message is a
// must-have for that answer's searches; the #tags under an answer's shelf add one to the message.
import { Fragment, useEffect, useRef, useState } from "react";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import ShelfRow from "@/components/ShelfRow";
import RecCard from "@/components/RecCard";
import LibraryMap from "./LibraryMap";
import Reply from "./Reply";
import BookshelfLoader from "@/components/BookshelfLoader";
import WaxSeal from "@/components/WaxSeal";
import Toast, { useToast } from "@/components/Toast";
import { XIcon, PinIcon, OpenBookIcon } from "@/components/Icons";
import { api, apiStream } from "@/lib/api";
import { SITE } from "@/lib/site";

// The start of a new chat - also how a new reader finds out what the chat can do
const STARTERS = [
  ["Find a book", ["What should I read next?", "Something like Dune, but shorter", "I'm bored – surprise me", "A cozy mystery I can borrow in Jerusalem"]],
  ["My reading", ["What's on my reading list?", "How much have I read this year?", "Let me rate a few books", "Change my favorite genres"]],
  ["The site", ["What can you do here?", "How do I get better recommendations?"]],
];

// The texts around the conversation
const T = {
  shelf: (n) => (n === 1 ? "The book in this answer" : `${n} books in this answer`),
  shelfHint: "Hover a cover for more · save it, rate it, or hide it",
};

const LOCATION_KEY = "bb-chat-location";

// the waiting line while the bot works - what each of its tools is doing
const DOING = {
  search_books: "Searching the catalog…",
  compare_books: "Putting the books side by side…",
  find_book: "Looking up the book…",
  get_book_details: "Reading about the book…",
  check_availability: "Checking the library shelves…",
  list_libraries: "Looking at the libraries…",
  recommend_for_me: "Asking the recommendation engine…",
  get_my_taste: "Looking at what you love…",
  get_my_shelf: "Looking at your shelf…",
  get_series: "Looking up the series…",
  get_my_searches: "Looking at your searches…",
  start_rating_round: "Finding books for you to rate…",
  get_my_insights: "Going over your reading…",
  get_book_community: "Reading what readers say…",
  propose_action: "Getting that ready…",
  remember_preference: "Making a note of that…",
};
// while streaming, the "<<followups: …>>" line (still being written) is not shown
const visibleText = (text) => text.replace(/<<followups:[^>]*>>?/i, "").replace(/<<[^>]*$/, "").trimEnd();
const HELP_LINK = `mailto:${SITE.contactEmail}?subject=${encodeURIComponent("BookBridge chat – I need help")}`;

// "Translate" offers these (the site itself stays in English)
const LANGUAGES = [["he", "עברית", true], ["ar", "العربية", true], ["ru", "Русский"], ["fr", "Français"], ["es", "Español"], ["de", "Deutsch"]];
const LANGUAGE_NAME = { he: "Hebrew", ar: "Arabic", ru: "Russian", fr: "French", es: "Spanish", de: "German" };
const RTL = new Set(LANGUAGES.filter((l) => l[2]).map((l) => l[0]));

const GlobeIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></svg>;
const CopyIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
const ThumbIcon = ({ down, filled }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: "scaleY(-1)" } : undefined}>
    <path d="M7 10v10H4V10zM7 10l4-7c1.4 0 2.300 1 2 2.400L12.300 9H19a2 2 0 0 1 2 2.300l-1.200 6.800A2 2 0 0 1 17.800 20H7" />
  </svg>
);
// 👎 - what went wrong (saved with the answer, read by the team on /admin/feedback)
const MISSED = [["missed_question", "Didn't answer my question"], ["not_my_taste", "Books not my taste"], ["wrong_info", "Wrong or made-up info"], ["too_long", "Too long"]];

// the answer as plain text, for "Copy": book titles instead of markers, no ** marks
const plainText = (text, books) => text.replace(/\[\[book:(\d+)\]\]/g, (m, id) => books.get(Number(id))?.title || "").replace(/\[([^[\]]+)\]\(\/[^)\s]*\)/g, "$1").replace(/\*\*/g, "");

function UserMessage({ text }) {
  // the hashtags stand out - they are the search's must-haves (server/chat.js)
  const parts = text.split(/((?:^|(?<=\s))#[\p{L}\p{N}][\p{L}\p{N}-]{1,39})/u);
  return (
    <div className="flex flex-col items-end gap-1 self-end">
      <span className="px-1 text-xs font-bold uppercase tracking-wider text-muted">You</span>
      <div dir="auto" className="max-w-[min(80vw,560px)] whitespace-pre-wrap rounded-md bg-rust-soft px-4 py-3 text-ink">
        {parts.map((p, i) => (i % 2 ? <span key={i} className="font-semibold text-rust-dark">{p}</span> : p))}
      </div>
    </div>
  );
}

// Hashtags: "#" in the message box suggests reader tags (#cozy-mystery); a hashtag in the
// message is a must-have for the search. The list comes once (GET /api/chat/tags) and is
// filtered here, so typing costs no request.
const HASHTAG_AT_CARET = /(?:^|\s)#([\p{L}\p{N}-]*)$/u;
const MAX_SUGGESTIONS = 6;
// the most used tags, so the first "#" shows something at once (and if the list can't be loaded)
const COMMON_TAGS = ["fantasy", "romance", "young-adult", "historical-fiction", "classics", "adventure", "nonfiction",
  "thriller", "science-fiction", "humor", "suspense", "crime", "paranormal", "children", "chick-lit", "history",
  "contemporary-fiction", "magic", "supernatural", "literary-fiction", "urban-fantasy", "horror", "biography",
  "contemporary-romance", "realistic-fiction", "drama", "memoir", "middle-grade", "paranormal-romance", "british",
  "dystopian", "detective", "vampires", "mystery", "cozy-mystery", "coming-of-age", "time-travel", "dragons",
  "war", "short-stories"].map((tag) => ({ tag }));
let tagsOnce = null;
const loadTags = () => (tagsOnce ??= api("/api/chat/tags").then((r) => r.tags).catch(() => { tagsOnce = null; return []; }));

function suggestTags(list, typed) {
  const tags = list.length ? list : COMMON_TAGS;
  const starts = [], inside = [];
  for (const t of tags) {
    if (t.tag.startsWith(typed)) starts.push(t);
    else if (typed && t.tag.includes(typed)) inside.push(t);
    if (starts.length >= MAX_SUGGESTIONS) break;
  }
  return [...starts, ...inside].slice(0, MAX_SUGGESTIONS);
}

// the "#…" word the caret is in: { typed, from } or null
function hashtagAt(value, caret) {
  const m = value.slice(0, caret).match(HASHTAG_AT_CARET);
  return m ? { typed: m[1].toLowerCase(), from: caret - m[1].length - 1 } : null;
}

function TagSuggestions({ id, items, active, onPick }) {
  return (
    <ul id={id} role="listbox" aria-label="Hashtags"
      className="absolute bottom-full left-0 z-40 m-0 mb-2 flex w-[min(100%,340px)] list-none flex-col overflow-hidden rounded-md border border-line-strong bg-cream p-1 shadow-[0_10px_30px_rgba(60,35,15,0.16)]">
      {items.map((t, i) => (
        <li key={t.tag} id={`${id}-${i}`} role="option" aria-selected={i === active}
          onMouseDown={(e) => { e.preventDefault(); onPick(t.tag); }}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm ${i === active ? "bg-rust-soft text-rust-dark" : "text-ink hover:bg-parchment"}`}>
          <span className="font-medium">#{t.tag}</span>
          {t.books > 0 && <span className="text-xs text-muted">{t.books.toLocaleString()} books</span>}
        </li>
      ))}
    </ul>
  );
}

// under an answer's shelf: its books' most common tags - press one to add it to the message
function AnswerTags({ books, onPick }) {
  const count = new Map();
  for (const b of books) for (const t of b.tags || []) count.set(t, (count.get(t) || 0) + 1);
  const tags = [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  if (!tags.length) return null;
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">More like these:</span>
      {tags.map((t) => <button key={t} type="button" onClick={() => onPick(t)} className={TOOL}>#{t}</button>)}
    </div>
  );
}

// small buttons under an answer, and the suggestion chips - one look for all of them
const TOOL = "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-parchment px-3 text-[13px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-60";
const CHIP = "inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-cream px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-rust hover:bg-rust-soft/40 hover:text-rust-dark";
const ArrowIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

// What the reader is asked to confirm under an answer (propose_action, remember_preference). Nothing
// happens before they press Yes, and then through the site's own API - like the buttons on a book card.
const ACTIONS = {
  add_to_reading_list: { ask: (a) => <>Add <strong>{a.title}</strong> to your TBR?</>, yes: "Yes, add it", done: "Added to your TBR", url: "/api/me/events", body: (a) => ({ bookId: a.bookId, type: "saved" }) },
  remove_from_reading_list: { ask: (a) => <>Remove <strong>{a.title}</strong> from your TBR?</>, yes: "Yes, remove it", done: "Removed from your TBR", url: "/api/me/events", body: (a) => ({ bookId: a.bookId, type: "unsaved" }) },
  delete_rating: { ask: (a) => <>Delete your rating of <strong>{a.title}</strong>?</>, yes: "Yes, delete it", done: "Rating deleted", method: "DELETE", url: (a) => `/api/me/ratings/${a.bookId}` },
  write_review: {
    ask: (a) => <>Publish your review of <strong>{a.title}</strong>{a.stars ? <>, with {a.stars}★</> : null}?</>, yes: "Publish", done: "Review published on the book’s page", editable: true,
    first: (a) => (a.stars ? api("/api/me/ratings", { method: "POST", body: { bookId: a.bookId, rating: a.stars, source: "chat" } }) : null), // a review goes with stars
    method: "PUT", url: (a) => `/api/social/books/${a.bookId}/review`, body: (a, text) => ({ body: text }),
  },
  delete_review: { ask: (a) => <>Delete your review of <strong>{a.title}</strong>?</>, yes: "Yes, delete it", done: "Review deleted", method: "DELETE", url: (a) => `/api/social/books/${a.bookId}/review` },
  post_in_discussion: {
    ask: (a) => <>{a.parentId ? "Post this reply" : "Post this"} in the discussion of <strong>{a.title}</strong>?</>, yes: "Post", done: "Posted on the book’s page", editable: true,
    url: (a) => `/api/social/books/${a.bookId}/posts`, body: (a, text) => ({ body: text, ...(a.parentId ? { parentId: a.parentId } : {}) }),
  },
  delete_post: { ask: (a) => <>Delete your post “{a.text}”?</>, yes: "Yes, delete it", done: "Post deleted", method: "DELETE", url: (a) => `/api/social/posts/${a.postId}` },
  set_genres: { ask: (a) => <>Set your favorite genres to <strong>{a.labels.join(", ")}</strong>?</>, yes: "Yes, change them", done: "Genres updated – your recommendations will follow", method: "PUT", url: "/api/me/genres", body: (a) => ({ genres: a.genres }) },
  set_city: { ask: (a) => <>Set your city to <strong>{a.city}</strong>?</>, yes: "Yes, change it", done: "City updated", method: "PATCH", url: "/api/me", body: (a) => ({ preferredCity: a.city }) },
  clear_search_history: { ask: () => <>Clear your search history?</>, yes: "Yes, clear it", done: "Search history cleared", method: "DELETE", url: "/api/me/searches" },
  mark_finished: { ask: (a) => <>Mark <strong>{a.title}</strong> as finished?</>, yes: "Yes, mark it", done: "Marked as finished", url: "/api/me/events", body: (a) => ({ bookId: a.bookId, type: "finished" }) },
  not_for_me: { ask: (a) => <>Hide <strong>{a.title}</strong> from your recommendations?</>, yes: "Yes, hide it", done: "Hidden – we won't suggest it again", url: "/api/me/events", body: (a) => ({ bookId: a.bookId, type: "dismissed" }) },
  rate: { ask: (a) => <>Rate <strong>{a.title}</strong> {a.stars}★?</>, yes: "Yes, rate it", done: "Rating saved", url: "/api/me/ratings", body: (a) => ({ bookId: a.bookId, rating: a.stars, source: "chat" }) },
  remember: { ask: (a) => <>Remember this for later chats: <strong dir="auto">{a.note}</strong>?{a.replaces ? <> It replaces “{a.replaces}”.</> : null}</>, yes: "Yes, remember", done: "Saved – see “What I remember”", url: "/api/chat/memory", body: (a) => ({ note: a.note, replaces: a.replaces }) },
};

function ConfirmAction({ action, onDone }) {
  const [state, setState] = useState("ask"); // ask | busy | done | error | no
  const [text, setText] = useState(action.text || "");
  const kind = ACTIONS[action.type];
  if (!kind || state === "no") return null;
  if (state === "done") return <p role="status" className="m-0 text-sm font-bold text-moss-dark">✓ {kind.done}</p>;
  async function confirm() {
    setState("busy");
    try {
      if (kind.first) await kind.first(action);
      const url = typeof kind.url === "function" ? kind.url(action) : kind.url;
      onDone?.(action, await api(url, { method: kind.method || "POST", ...(kind.body ? { body: kind.body(action, text.trim()) } : {}) }));
      setState("done");
    } catch { setState("error"); }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line-strong bg-parchment px-4 py-3">
      <span className="min-w-0 flex-[1_1_220px] text-[15px] text-ink">{kind.ask(action)}</span>
      {kind.editable && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} dir="auto" aria-label="Your text – edit it before it is published" className="field w-full resize-y" />
          <span className="w-full text-xs text-muted">Public on the book’s page, under your name. You can edit it first.</span>
        </>
      )}
      <div className="flex flex-none items-center gap-2">
        <button type="button" disabled={state === "busy" || (kind.editable && !text.trim())} onClick={confirm} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60">{kind.yes}</button>
        <button type="button" disabled={state === "busy"} onClick={() => setState("no")} className="btn btn-outline">Not now</button>
      </div>
      {state === "error" && <span role="alert" className="w-full text-sm text-rust-dark">That didn’t work – try again.</span>}
    </div>
  );
}

// A round of quick ratings under the answer (start_rating_round): the books and the saving are
// the Rate more page's - each press saves one rating, "Haven't read it" moves on
const ROUND_SIZE = 5;
function RatingRound() {
  const [books, setBooks] = useState(null);
  const [mine, setMine] = useState({}); // book id -> the stars given here (the book stays, with its stars)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const shown = useRef([]);
  const add = (r) => {
    const next = r.books.slice(0, ROUND_SIZE);
    shown.current.push(...next.map((b) => b.id));
    setBooks((bs) => [...(bs || []), ...next]);
  };
  async function more() {
    setLoading(true); setError(null);
    try { add(await api("/api/me/rate-more", { method: "POST", body: { skip: shown.current } })); }
    catch (err) { setError(err.message); }
    setLoading(false);
  }
  useEffect(() => {
    let alive = true;
    api("/api/me/rate-more", { method: "POST", body: { skip: [] } })
      .then((r) => { if (alive) add(r); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function rate(id, n) {
    setError(null);
    try {
      await api("/api/me/ratings", { method: "POST", body: { bookId: id, rating: n, source: "chat" } });
      setMine((m) => ({ ...m, [id]: n }));
    } catch (err) { setError(err.message); }
  }
  const rated = Object.keys(mine).length;
  const waiting = books?.filter((b) => !mine[b.id]).length || 0;
  if (closed && !rated) return null;
  const list = closed ? books.filter((b) => mine[b.id]) : books;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line-strong bg-parchment p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-bold text-ink">
          {closed ? `✓ ${rated} rated – your recommendations will use them` : `Rate the ones you’ve read${rated ? ` · ${rated} so far` : ""}`}
        </span>
        {!closed && <button type="button" onClick={() => setClosed(true)} className="cursor-pointer border-0 bg-transparent p-0 text-sm text-ink-soft underline hover:text-rust">Done</button>}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error === "choose your genres first" ? "Tell me a few favorite genres first, and I’ll find books to rate." : "That didn’t work – try again."}</p>}
      {list?.map((b) => (
        <div key={b.id} className="flex flex-wrap items-center gap-3">
          <Cover book={b} small className="w-[38px] flex-none" />
          <span className="min-w-0 flex-[1_1_160px] text-sm text-ink"><strong>{b.title}</strong>{b.authors?.[0] ? ` · ${b.authors[0]}` : ""}</span>
          <Stars value={mine[b.id] || 0} onChange={closed ? undefined : (n) => rate(b.id, n)} size={20} label={`Rate ${b.title}`} />
          {!closed && !mine[b.id] && <button type="button" onClick={() => setBooks((bs) => bs.filter((x) => x.id !== b.id))} className="cursor-pointer border-0 bg-transparent p-0 text-sm text-ink-soft underline hover:text-rust">Haven’t read it</button>}
          {!closed && mine[b.id] > 0 && <span role="status" className="text-sm font-bold text-moss-dark">✓ Saved</span>}
        </div>
      ))}
      {loading && <p className="m-0 text-sm text-muted">Finding books…</p>}
      {!closed && !loading && !waiting && !(error && !books) && <button type="button" onClick={more} className="btn btn-outline self-start">More books</button>}
    </div>
  );
}

// A few words about a book, in the reader's own text - it goes straight to the book's page
function ReviewBox({ offer, onDone }) {
  const [body, setBody] = useState("");
  const [state, setState] = useState("write"); // write | busy | error
  async function post() {
    setState("busy");
    try {
      await api(`/api/social/books/${offer.bookId}/review`, { method: "PUT", body: { body: body.trim() } });
      onDone();
    } catch { setState("error"); }
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} autoFocus dir="auto"
        placeholder={`What did you think of ${offer.title}?`} className="field resize-y" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!body.trim() || state === "busy"} onClick={post} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">Post review</button>
        <span className="text-xs text-muted">Public on the book’s page, under your name.</span>
        {state === "error" && <span role="alert" className="text-sm text-rust-dark">That didn’t work – try again.</span>}
      </div>
    </div>
  );
}

// Under an answer: the book the reader asked about or compared to. Stars, then a review if they
// want; if they rated it already, only the review. The press is the confirmation.
function RatingOffer({ offer }) {
  const [rated, setRated] = useState(offer.myRating || 0);
  const [state, setState] = useState("ask"); // ask | busy | review | done | error | no
  if (state === "no") return null;
  if (state === "done") return <p role="status" className="m-0 text-sm font-bold text-moss-dark">✓ Thanks – it’s on the book’s page</p>;
  async function rate(n) {
    setState("busy");
    try {
      await api("/api/me/ratings", { method: "POST", body: { bookId: offer.bookId, rating: n, source: "chat" } });
      setRated(n);
      setState("ask");
    } catch { setState("error"); }
  }
  const justRated = rated && !offer.myRating;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-parchment px-4 py-2.5">
      <span className="min-w-0 flex-[1_1_180px] text-[15px] text-ink">
        {justRated ? <>✓ Rated <strong>{offer.title}</strong> – your recommendations will use it.</>
          : rated ? <>You rated <strong>{offer.title}</strong>.</>
          : <>Already read <strong>{offer.title}</strong>? How was it?</>}
      </span>
      <Stars value={rated} onChange={state === "busy" ? undefined : rate} label={`Rate ${offer.title}`} />
      {rated > 0 && state !== "review" && <button type="button" onClick={() => setState("review")} className="btn btn-outline">Add a review</button>}
      <button type="button" disabled={state === "busy"} onClick={() => setState("no")} className="cursor-pointer border-0 bg-transparent p-0 text-sm text-ink-soft underline hover:text-rust">{rated ? "Not now" : "Haven’t read it"}</button>
      {state === "review" && <ReviewBox offer={offer} onDone={() => setState("done")} />}
      {state === "error" && <span role="alert" className="w-full text-sm text-rust-dark">That didn’t work – try again.</span>}
    </div>
  );
}

// Under an answer: its books, one press from the reading list
function QuickSave({ books }) {
  const [saved, setSaved] = useState([]);
  const [failed, setFailed] = useState(false);
  async function save(b) {
    setFailed(false);
    try {
      await api("/api/me/events", { method: "POST", body: { bookId: b.bookId, type: "saved" } });
      setSaved((s) => [...s, b.bookId]);
    } catch { setFailed(true); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-bold text-ink-soft">Add to my TBR:</span>
      {books.map((b) => saved.includes(b.bookId)
        ? <span key={b.bookId} role="status" className="inline-flex h-8 items-center rounded-md bg-moss-soft px-3 text-[13px] font-medium text-moss-dark">✓ {b.title}</span>
        : <button key={b.bookId} type="button" onClick={() => save(b)} className={TOOL}>+ <span className="max-w-[200px] truncate">{b.title}</span></button>)}
      {failed && <span role="alert" className="text-rust-dark">That didn’t work – try again.</span>}
    </div>
  );
}

// What the chatbot remembers between chats - the reader can see all of it and delete any of it
function ReaderMemory({ notes, onForget }) {
  if (!notes.length) return null;
  return (
    <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="m-0 px-1 text-xs font-bold uppercase tracking-wider text-muted">What I remember</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-2 rounded-md px-1 py-1 text-sm leading-snug text-ink-soft">
            <span dir="auto">{n.note}</span>
            <button type="button" onClick={() => onForget(n.id)} aria-label={`Forget “${n.note}”`} title="Forget this"
              className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sand hover:text-ink"><XIcon /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One answer: who is talking, the text (or its translation), Translate / Copy, and -
// on the latest answer - the questions the reader may ask next
function Answer({ m, index, followUps, onActionDone, onSend, onTranslate, onToggleOriginal, onCopy, onFeedback }) {
  const [menu, setMenu] = useState(false);
  const fb = m.feedback?.value || 0;
  const books = new Map((m.books || []).map((b) => [b.id, b]));
  const tr = m.translation;
  const showTr = tr?.text && !tr.showOriginal;
  if (m.streaming && !m.text) return null; // nothing written yet - the waiting line shows instead
  const native = (code) => LANGUAGES.find((l) => l[0] === code)?.[1];
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-3 self-start">
      <div className="flex items-center gap-2.5">
        <WaxSeal className="static sm"><OpenBookIcon /></WaxSeal>
        <span className="text-sm font-bold text-ink">The librarian</span>
        {showTr && <span className="rounded-md bg-moss-soft px-2.5 py-0.5 text-xs font-bold text-moss-dark">Translated · <span lang={tr.to}>{native(tr.to)}</span></span>}
      </div>

      <div className={`rounded-md border bg-cream shadow-[0_2px_12px_rgba(60,35,15,0.05)] ${m.error ? "border-rust/40" : "border-line"}`}>
        <div dir={showTr && RTL.has(tr.to) ? "rtl" : "ltr"} lang={showTr ? tr.to : "en"}
          className={`flex flex-col gap-3 px-6 pb-4 pt-5 text-[16px] leading-[1.7] ${m.error ? "text-rust-dark" : "text-ink"}`}>
          <Reply text={showTr ? tr.text : m.streaming ? visibleText(m.text) : m.text} books={books} />
          {m.streaming && <span aria-hidden="true" className="inline-block h-4 w-2 animate-pulse rounded-sm bg-rust/60 motion-reduce:animate-none" />}
          {m.error && <span className="text-sm text-ink-soft">Still stuck? <a href={HELP_LINK}>Contact the BookBridge team</a>.</span>}
        </div>
        {!m.error && !m.streaming && (
          <div className="relative flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            <button type="button" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)} disabled={tr?.loading} className={TOOL}>
              <GlobeIcon />{tr?.loading ? "Translating…" : "Translate"}
            </button>
            {tr?.text && (
              <button type="button" onClick={() => onToggleOriginal(index)} className={TOOL}>
                {tr.showOriginal ? <>Show <span lang={tr.to}>{native(tr.to)}</span></> : "Show original"}
              </button>
            )}
            <button type="button" onClick={() => onCopy(plainText(showTr ? tr.text : m.text, books))} className={TOOL}>
              <CopyIcon />Copy
            </button>
            {tr?.error && <span role="alert" className="text-[13px] text-rust-dark">{tr.error}</span>}
            {m.turn && (
              <span className="ml-auto flex items-center gap-1" role="group" aria-label="Was this answer helpful?">
                <button type="button" aria-pressed={fb === 1} aria-label="Helpful" title="Helpful" onClick={() => onFeedback(index, fb === 1 ? 0 : 1)}
                  className={`${TOOL} !px-2 ${fb === 1 ? "pop !border-moss !bg-moss-soft !text-moss-dark" : ""}`}><ThumbIcon filled={fb === 1} /></button>
                <button type="button" aria-pressed={fb === -1} aria-label="Not helpful" title="Not helpful" onClick={() => onFeedback(index, fb === -1 ? 0 : -1)}
                  className={`${TOOL} !px-2 ${fb === -1 ? "pop !border-rust !bg-rust-soft !text-rust-dark" : ""}`}><ThumbIcon down filled={fb === -1} /></button>
              </span>
            )}
            {menu && (
              <div role="menu" className="absolute bottom-full left-3 z-40 mb-2 w-[220px] overflow-hidden rounded-md border border-line-strong bg-cream p-1.5 shadow-[0_16px_40px_rgba(60,35,15,0.2)]">
                <span className="block px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Translate this answer to</span>
                {LANGUAGES.map(([code, name]) => (
                  <button key={code} type="button" role="menuitem" onClick={() => { setMenu(false); onTranslate(index, code); }}
                    className="flex w-full cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-3 py-2 text-start text-sm text-ink hover:bg-sand">
                    <span lang={code} className="font-medium">{name}</span>
                    <span className="text-xs text-muted">{tr?.to === code && tr?.text ? "✓" : LANGUAGE_NAME[code]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {fb === 1 && m.feedback.fresh && <p role="status" className="m-0 border-t border-line px-5 py-2.5 text-[13px] text-moss-dark">Thank you – glad it helped.</p>}
        {fb === -1 && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
            {m.feedback.reason ? (
              <p role="status" className="m-0 text-[13px] text-ink-soft">Thanks – noted: <strong>{MISSED.find(([k]) => k === m.feedback.reason)?.[1]}</strong>. Ask again in other words and I’ll try better.</p>
            ) : (
              <>
                <span className="text-[13px] text-ink-soft">Sorry about that. What went wrong?</span>
                <div className="flex flex-wrap gap-1.5">
                  {MISSED.map(([k, label]) => (
                    <button key={k} type="button" onClick={() => onFeedback(index, -1, k)}
                      className="cursor-pointer rounded-md border border-line-strong bg-parchment px-3 py-1.5 text-[13px] text-ink hover:border-rust hover:text-rust-dark">{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {!m.streaming && m.actions?.length > 0 && (
        <div className="flex flex-col gap-2">
          {m.actions.map((a) => <ConfirmAction key={`${a.type}-${a.bookId || a.postId || a.note || ""}`} action={a} onDone={onActionDone} />)}
        </div>
      )}
      {!m.streaming && m.quickSave?.length > 0 && <QuickSave books={m.quickSave} />}
      {!m.streaming && m.ratingOffer && <RatingOffer offer={m.ratingOffer} />}
      {!m.streaming && m.ratingRound && <RatingRound />}

      {followUps?.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="Suggested follow-ups">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Ask next</span>
          <div className="flex flex-wrap gap-2">
            {followUps.map((q) => (
              <button key={q} type="button" onClick={() => onSend(q)} className={CHIP}>{q}<span className="text-muted"><ArrowIcon /></span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "X or Y?": the books side by side (compare_books on the server) - the answer says which fits
function CompareTable({ comparison }) {
  const { books, city } = comparison;
  const rows = [
    ["Pages", (b) => b.pages ?? "–"],
    ["Published", (b) => b.year ?? "–"],
    ["Readers", (b) => (b.rating != null ? <span className="whitespace-nowrap"><span className="text-gold">★</span> {Number(b.rating).toFixed(1)} <span className="text-muted">· {Number(b.ratings).toLocaleString("en")}</span></span> : "–")],
    ["Readers say", (b) => (b.tags.length ? b.tags.map((t) => `#${t}`).join(" ") : "–")],
    ["For you", (b) => (b.lovedLike ? <>Close to <em className="font-serif">{b.lovedLike.title}</em> ({b.lovedLike.stars}★)</> : "–")],
    ...(city ? [[`In ${city}`, (b) => (b.available ? <span className="font-medium text-moss-dark">On the shelf</span> : <span className="text-muted">Not now</span>)]] : []),
  ];
  return (
    <div className="quiet-scroll w-full max-w-[760px] self-start overflow-x-auto rounded-md border border-line bg-cream">
      <table className="w-full min-w-[420px] border-collapse text-left text-[14px]">
        <caption className="sr-only">The books side by side</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="w-[7.5rem] px-4 py-3 align-bottom text-xs font-bold uppercase tracking-wider text-muted">Side by side</th>
            {books.map((b) => (
              <th key={b.id} scope="col" className="px-3 py-3 align-bottom font-normal">
                <a href={`/books/${b.id}`} className="flex items-end gap-2.5 text-ink no-underline hover:text-rust">
                  <Cover book={b} small className="w-9 flex-none" />
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 font-serif text-[15px] font-semibold leading-tight">{b.title}</span>
                    {b.author && <span className="truncate text-xs text-muted">{b.author}</span>}
                  </span>
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cell]) => (
            <tr key={label} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-2.5 align-top text-[13px] font-semibold text-ink-soft">{label}</th>
              {books.map((b) => <td key={b.id} className="px-3 py-2.5 align-top text-ink">{cell(b)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The books of one answer, as a For You shelf
function AnswerShelf({ m, index, onRemove, onRated, onAsk }) {
  const showAvailability = m.books.some((b) => b.availabilityText);
  return (
    <ShelfRow id={`chat-shelf-${index}`} title={T.shelf(m.books.length)} subtitle={T.shelfHint} titleClass="text-lg" count={m.books.length}>
      {m.books.map((b) => (
        <div key={b.id} className="book-w relative snap-start">
          <RecCard book={b} showAvailability={showAvailability} ratingSource="chat"
            onDismiss={(id) => onRemove(index, id)}
            onRated={onRated}
            onAsk={onAsk} />
        </div>
      ))}
    </ShelfRow>
  );
}

// The book the next message is about, with ready questions
function AskingAbout({ book, located, onPick, onClear }) {
  const title = book.title;
  const ideas = [
    ["Is it for me?", `Is “${title}” for me?`],
    ["What's it about?", `What is “${title}” about, without spoilers?`],
    ["What do readers say?", `What do readers say about “${title}”?`],
    ["Similar books", `Which books are similar to “${title}”?`],
    located ? ["On a shelf near me?", `Is “${title}” on a shelf near me?`] : ["Where can I borrow it?", `Where can I borrow “${title}”?`],
  ];
  return (
    <div className="card flex items-start gap-4 p-4">
      <Cover book={book} small className="w-[46px] flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="text-sm text-ink-soft">You&apos;re asking about <strong className="text-ink">{title}</strong>{book.authors?.[0] ? ` by ${book.authors[0]}` : ""} – write your question below, or pick one to start from.</span>
        <div className="flex flex-wrap gap-2">
          {ideas.map(([label, question]) => (
            <button key={label} type="button" onClick={() => onPick(question)} className="cursor-pointer rounded-md border border-line-strong bg-parchment px-3.5 py-1.5 text-sm text-ink hover:border-ink">{label}</button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onClear} aria-label="Don't ask about this book" title="Don't ask about this book"
        className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sand hover:text-ink"><XIcon /></button>
    </div>
  );
}

// "Today", "Yesterday", "Mon", "12 Oct"
function when(date) {
  const d = new Date(date);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// The saved conversations, newest first, under Today / Yesterday / This week / Earlier, as small
// catalog cards. The open one carries a rust edge and a wax seal; × (on hover or focus) deletes one.
// With more than 6 chats a box on top finds one by its title.
const dayGroup = (date) => {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
};
const ChatIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>;

function ChatHistory({ conversations, activeId, onOpen, onDelete }) {
  const [find, setFind] = useState("");
  if (!conversations) return <p className="m-0 px-1 text-sm text-muted">Loading…</p>;
  if (!conversations.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
        <WaxSeal className="static sm ochre"><ChatIcon /></WaxSeal>
        <p className="m-0 font-serif text-[15px] italic leading-snug text-muted">Your conversations with the librarian will be kept here.</p>
      </div>
    );
  }
  const shown = find.trim() ? conversations.filter((c) => c.title.toLowerCase().includes(find.trim().toLowerCase())) : conversations;
  const groups = [];
  for (const c of shown) {
    const g = dayGroup(c.updatedAt);
    if (groups[groups.length - 1]?.name !== g) groups.push({ name: g, chats: [] });
    groups[groups.length - 1].chats.push(c);
  }
  return (
    <div className="flex flex-col gap-3">
      {conversations.length > 6 && (
        <label className="flex items-center gap-2 rounded-md border border-line-strong bg-cream px-2.5 focus-within:border-rust">
          <span className="sr-only">Find a chat</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-muted"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a chat" className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-ink" style={{ outline: "none" }} />
        </label>
      )}
      {!shown.length && <p className="m-0 px-1 text-sm text-muted">No chat by that name.</p>}
      {groups.map((g) => (
        <section key={g.name} aria-label={g.name} className="flex flex-col gap-1">
          <h3 className="chat-group">{g.name}<span aria-hidden="true" className="old-rule" /></h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {g.chats.map((c) => {
              const on = c.id === activeId;
              return (
                <li key={c.id} className="group relative">
                  <button type="button" onClick={() => onOpen(c.id)} aria-current={on ? "true" : undefined} className="chat-card">
                    {on ? <WaxSeal className="static xs"><ChatIcon /></WaxSeal> : <span className="mt-0.5 flex-none text-muted group-hover:text-rust"><ChatIcon /></span>}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span dir="auto" className={`line-clamp-2 font-serif text-[16px] leading-tight ${on ? "font-semibold text-ink" : "text-ink-soft group-hover:text-ink"}`}>{c.title}</span>
                      <span className="text-xs text-muted">{when(c.updatedAt)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => onDelete(c)} aria-label={`Delete the chat “${c.title}”`} title="Delete chat"
                    className="absolute right-1.5 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted opacity-0 hover:bg-sand hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60">
                    <XIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// the open conversation is kept in the address: /chat?c=<id>
function setAddress(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id); else url.searchParams.delete("c");
  url.searchParams.delete("book"); // used once, when the page opens
  window.history.replaceState(null, "", url);
}

export default function ChatBox() {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const [conversations, setConversations] = useState(null);
  const [notes, setNotes] = useState([]); // what the chatbot remembers about the reader
  const [opening, setOpening] = useState(false);
  const [location, setLocation] = useState(null); // { lat, lng } while "Use my location" is on
  const [locating, setLocating] = useState(false);
  const [about, setAbout] = useState(null); // the book the next message is about
  const [busyLabel, setBusyLabel] = useState("");
  const [start, setStart] = useState(null); // a personal start for an empty chat (GET /api/chat/start)
  const lastAnswer = messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1] : null;
  const [showHistory, setShowHistory] = useState(false); // phones: the list opens above the chat
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const [tags, setTags] = useState([]);
  const [hashtag, setHashtag] = useState(null); // { typed, from, items, active } while "#…" is being typed

  // follow the conversation: a new message, the answer as it is written, the end of an answer -
  // but stay in place on a change inside an old message (a translation, a book hidden from a shelf)
  const lastMessage = messages[messages.length - 1];
  const writtenSoFar = lastMessage?.streaming ? lastMessage.text.length : 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, writtenSoFar, busy]);

  // the history list, and the conversation in the address (after a refresh / from a link).
  // Runs again each time the reader comes back to this page (it is kept alive, not remounted).
  useEffect(() => {
    api("/api/chat").then((r) => setConversations(r.conversations)).catch(() => setConversations([]));
    api("/api/chat/memory").then((r) => setNotes(r.notes)).catch(() => {});
    api("/api/chat/start").then(setStart).catch(() => {}); // only an extra - the general starters stay
    const params = new URLSearchParams(window.location.search);
    if (params.get("c")) open(params.get("c"));
    let remembered = false;
    try { remembered = localStorage.getItem(LOCATION_KEY) === "on"; } catch {}
    if (remembered) locate(true);
    const bookId = Number(params.get("book"));
    if (bookId > 0) {
      // "Ask about this book" always opens a NEW chat. (Next.js keeps this page alive when
      // you leave it - <Activity> - so the last chat may still be open here; it stays in the history.)
      startNew();
      api(`/api/books/${bookId}`, { auth: false })
        .then((b) => { setAbout(b); setAddress(params.get("c")); inputRef.current?.focus(); })
        .catch(() => showToast("That book was not found."));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(id) {
    setShowHistory(false);
    if (id === conversationId) return;
    setOpening(true);
    try {
      const r = await api(`/api/chat/${id}`);
      setConversationId(r.id);
      setMessages(r.turns.flatMap((t) => [{ role: "user", text: t.message }, { role: "assistant", text: t.reply, books: t.books, places: t.places, comparison: t.comparison, turn: t.turn, feedback: t.feedback }]));
      setAddress(r.id);
    } catch (err) {
      setAddress(null);
      showToast(err.message === "conversation not found" ? "That chat was deleted." : err.message);
    } finally {
      setOpening(false);
    }
  }

  function typed(value, caret) {
    setInput(value);
    const at = hashtagAt(value, caret);
    if (!at) { setHashtag(null); return; }
    if (!tags.length) loadTags().then((list) => { if (!list.length) return; setTags(list); setHashtag((h) => h && { ...h, items: suggestTags(list, h.typed) }); });
    setHashtag({ ...at, items: suggestTags(tags, at.typed), active: 0 });
  }

  function pickTag(tag) {
    const box = inputRef.current;
    const caret = box?.selectionStart ?? input.length;
    const at = hashtagAt(input, caret);
    const value = at
      ? `${input.slice(0, at.from)}#${tag} ${input.slice(caret).replace(/^\s+/, "")}`
      : `${input.trimEnd()}${input.trim() ? " " : ""}#${tag} `; // from the tags under an answer
    const end = at ? at.from + tag.length + 2 : value.length;
    setInput(value);
    setHashtag(null);
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(end, end); });
  }

  // the suggestions take the arrows, Enter and Tab while they are open
  function keyDown(e) {
    const open = hashtag?.items.length > 0;
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = hashtag.items.length, step = e.key === "ArrowDown" ? 1 : -1;
      setHashtag({ ...hashtag, active: (hashtag.active + step + n) % n });
    } else if (open && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pickTag(hashtag.items[hashtag.active].tag);
    } else if (open && e.key === "Escape") {
      setHashtag(null);
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setHashtag(null);
    setMessages((ms) => [...ms, { role: "user", text: message }]);
    const bookId = about?.id;
    setAbout(null);
    setBusyLabel(bookId ? "Looking into the book, your taste and the shelves…" : "Searching the shelves…");
    setBusy(true);
    // the answer, as it is written: one message that grows, then becomes the final one
    const live = { role: "assistant", text: "", streaming: true, books: [] };
    setMessages((ms) => [...ms, live]);
    const update = (change) => setMessages((ms) => ms.map((m) => (m.streaming ? { ...m, ...change(m) } : m)));
    try {
      let r = null;
      let found = 0;
      await apiStream("/api/chat", {
        body: { message, conversationId, location: location || undefined, bookId },
        onEvent: (event, data) => {
          if (event === "delta") update((m) => ({ text: m.text + data.text }));
          else if (event === "reset") update(() => ({ text: "" }));
          else if (event === "status") setBusyLabel(DOING[data.tools?.[0]] || "Searching the shelves…");
          else if (event === "books") {
            update((m) => ({ books: [...m.books, ...data.books.filter((b) => !m.books.some((x) => x.id === b.id))] }));
            // the wait feels shorter when it says what it found
            found += data.books.length;
            if (found > 1) setBusyLabel(`Found ${found} books – picking the best ones for you…`);
          }
          else if (event === "done") r = data;
          else if (event === "error") throw new Error(data.error);
        },
      });
      if (!r) throw new Error("The answer was cut off – please try again.");
      setMessages((ms) => ms.map((m) => (m.streaming ? { role: "assistant", text: r.reply, turn: r.turn, books: r.books, places: r.places, comparison: r.comparison, followUps: r.followUps, actions: r.actions, ratingOffer: r.ratingOffer, quickSave: r.quickSave, ratingRound: r.ratingRound } : m)));
      if (r.conversationId) {
        setConversationId(r.conversationId);
        setAddress(r.conversationId);
        // this chat goes to the top of the history list
        setConversations((cs) => [{ id: r.conversationId, title: r.title, updatedAt: new Date().toISOString() }, ...(cs || []).filter((c) => c.id !== r.conversationId)]);
      }
    } catch (err) {
      // fetch() itself failed: the BookBridge server is not running or not reachable
      const text = err instanceof TypeError ? "I can't reach the BookBridge server right now – please try again in a moment." : err.message;
      setMessages((ms) => [...ms.filter((m) => !m.streaming), { role: "assistant", text, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // 👍 / 👎 on an answer (0 = take it back), and for 👎 why. Shown at once; put back if it failed.
  async function feedback(index, value, reason = null) {
    const m = messages[index];
    if (!m.turn || !conversationId) return;
    const before = m.feedback || null;
    patch(index, { feedback: value ? { value, reason, fresh: true } : null });
    try {
      await api(`/api/chat/${conversationId}/turns/${m.turn}/feedback`, { method: "POST", body: { value, reason } });
    } catch {
      patch(index, { feedback: before });
      showToast("Couldn't save that – try again.");
    }
  }

  // "Translate" on an answer: ask once per language, then switch between it and the original
  async function translate(index, to) {
    const m = messages[index];
    if (m.translation?.to === to && m.translation.text) { patch(index, { translation: { ...m.translation, showOriginal: false } }); return; }
    patch(index, { translation: { to, loading: true } });
    try {
      const r = await api("/api/chat/translate", { method: "POST", body: { text: m.text, to } });
      patch(index, { translation: { to, text: r.text } });
    } catch (err) {
      patch(index, { translation: { to, error: err instanceof TypeError ? "Couldn't reach the server – try again." : err.message } });
    }
  }
  const patch = (index, change) => setMessages((ms) => ms.map((x, i) => (i === index ? { ...x, ...change } : x)));
  const toggleOriginal = (index) => setMessages((ms) => ms.map((x, i) => (i === index ? { ...x, translation: { ...x.translation, showOriginal: !x.translation.showOriginal } } : x)));
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); showToast("Copied."); } catch { showToast("Couldn't copy – select the text instead."); }
  }

  // "not for me" / rated on a card: it leaves that answer's shelf
  // a card's "Not for me": it leaves the answer; the "Why not?" slip says it's hidden (components/WhyNot.js)
  function removeBook(index, id) {
    setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, books: m.books.filter((b) => b.id !== id) } : m)));
  }

  const remember = (on) => { try { if (on) localStorage.setItem(LOCATION_KEY, "on"); else localStorage.removeItem(LOCATION_KEY); } catch {} };

  // quiet: turned on by itself (remembered from last time) - no messages, and forget it if it fails
  function locate(quiet = false) {
    if (!navigator.geolocation) { if (!quiet) showToast("This browser can't share a location – name a city or a branch instead."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({ lat: Number(p.coords.latitude.toFixed(4)), lng: Number(p.coords.longitude.toFixed(4)) });
        setLocating(false);
        remember(true);
        if (!quiet) showToast("Location on – ask for books at a library near you.");
      },
      () => {
        setLocating(false);
        remember(false);
        if (!quiet) showToast("Couldn't get your location – name a city or a branch instead.");
      },
      { timeout: 10000 }
    );
  }

  function toggleLocation() {
    if (location) { setLocation(null); remember(false); showToast("Location off."); return; }
    locate();
  }

  // "Ask about this book" on a card IN the chat (a book it suggested): ask in this same
  // conversation - the book goes above the message box with ready questions
  function askAbout(book) {
    setAbout(book);
    inputRef.current?.focus();
  }

  // a new, empty chat - the current one stays in the history
  function startNew() {
    setConversationId(null);
    setMessages([]);
    setAbout(null);
    setAddress(null);
    setShowHistory(false);
    inputRef.current?.focus();
  }

  async function remove(c) {
    if (!window.confirm(`Delete the chat “${c.title}”?`)) return;
    try {
      await api(`/api/chat/${c.id}`, { method: "DELETE" });
      setConversations((cs) => cs.filter((x) => x.id !== c.id));
      if (c.id === conversationId) startNew();
      showToast("Chat deleted.");
    } catch (err) {
      showToast(err.message);
    }
  }

  async function forget(id) {
    try {
      await api(`/api/chat/memory/${id}`, { method: "DELETE" });
      setNotes((ns) => ns.filter((n) => n.id !== id));
      showToast("Forgotten.");
    } catch (err) { showToast(err.message); }
  }

  // a confirmed note appears in "What I remember" at once
  const actionDone = (action, saved) => {
    if (action.type !== "remember") return;
    const gone = action.replaces?.toLowerCase(); // a changed preference replaced this note
    setNotes((ns) => [...ns.filter((n) => n.id !== saved.id && n.note.toLowerCase() !== gone), saved]);
  };

  const history = (
    <>
      <ChatHistory conversations={conversations} activeId={conversationId} onOpen={open} onDelete={remove} />
      <ReaderMemory notes={notes} onForget={forget} />
    </>
  );

  return (
    <div className="flex items-start gap-10">
      <aside aria-label="Your chats" className="quiet-scroll sticky top-24 hidden max-h-[calc(100vh-7rem)] w-[252px] shrink-0 flex-col gap-3 overflow-y-auto px-1.5 pb-6 pt-1.5 lg:flex">
        <button type="button" onClick={startNew} className="btn btn-primary w-full">+ New chat</button>
        <h2 className="eyebrow m-0 mt-3 flex items-baseline justify-between border-b border-line-strong px-2 pb-1.5">Your chats{conversations?.length > 0 && <span className="font-sans text-xs font-bold text-muted" style={{ fontVariant: "normal" }}>{conversations.length}</span>}</h2>
        {history}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <WaxSeal className="static lg"><OpenBookIcon /></WaxSeal>
            <div className="flex flex-col gap-1">
              <span className="eyebrow">AI book discovery</span>
              <h1 className="m-0 font-serif text-5xl font-semibold">Ask the librarian</h1>
            </div>
          </div>
          <div className="flex gap-2 lg:hidden">
            <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className="btn btn-outline px-4 py-2 text-sm">History</button>
            {messages.length > 0 && <button type="button" onClick={startNew} className="btn btn-outline px-4 py-2 text-sm">New chat</button>}
          </div>
        </div>
        {showHistory && <div className="card p-3 lg:hidden">{history}</div>}

        {opening ? <BookshelfLoader label="Opening your chat…" /> : messages.length === 0 ? (
          <div className="card flex flex-col gap-4 p-6">
            <p className="m-0 text-lg leading-relaxed text-ink-soft">
              Tell me what you’re in the mood for, or what you’d like to do – I can find books, keep your shelf, take your ratings and reviews, and show you around.
              You always get the final say before anything changes.
            </p>
            {start?.suggestions?.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-line bg-parchment/60 p-4">
                <h2 className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rust-dark"><WaxSeal className="static xs"><OpenBookIcon /></WaxSeal>Picked up from your shelf</h2>
                {start.hello && <p className="m-0 font-serif text-[19px] italic leading-snug text-ink">{start.hello}</p>}
                <div className="flex flex-wrap gap-2">
                  {start.suggestions.map((s) => (
                    <button key={s.kind} type="button" onClick={() => send(s.text)} className={CHIP}>{s.text}<span className="text-muted"><ArrowIcon /></span></button>
                  ))}
                </div>
              </div>
            )}
            {STARTERS.map(([heading, starters]) => (
              <div key={heading} className="flex flex-col gap-2">
                <h2 className="m-0 text-xs font-bold uppercase tracking-wider text-muted">{heading}</h2>
                <div className="flex flex-wrap gap-2">
                  {starters.map((e) => (
                    <button key={e} type="button" onClick={() => send(e)} className={CHIP}>{e}<span className="text-muted"><ArrowIcon /></span></button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-live="polite">
            {messages.map((m, i) => (
              <Fragment key={i}>
                {m.role === "user"
                  ? <UserMessage text={m.text} />
                  : <Answer m={m} index={i} followUps={!busy && m === lastAnswer ? m.followUps : null} onActionDone={actionDone} onSend={send}
                      onTranslate={translate} onToggleOriginal={toggleOriginal} onCopy={copy} onFeedback={feedback} />}
                {!m.streaming && m.comparison?.books?.length > 1 && <CompareTable comparison={m.comparison} />}
                {!m.streaming && m.books?.length > 0 && <AnswerShelf m={m} index={i} onRemove={removeBook} onRated={(id, n) => showToast(`Rated ${n}★ – thanks! Your recommendations will use it.`)} onAsk={askAbout} />}
                {!m.streaming && m.books?.length > 0 && <AnswerTags books={m.books} onPick={pickTag} />}
              {m.places?.branches?.length > 0 && m.books?.length > 0 && <LibraryMap places={m.places} books={m.books} />}
              </Fragment>
            ))}
            {busy && !messages.some((m) => m.streaming && m.text) && <BookshelfLoader label={busyLabel} className="self-start" />}
            <div ref={endRef} />
          </div>
        )}

        {about && <AskingAbout book={about} located={Boolean(location)} onPick={(question) => { setInput(question); inputRef.current?.focus(); }} onClear={() => setAbout(null)} />}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-20 z-30 flex items-end gap-2 rounded-md border border-line-strong bg-cream py-2 pl-5 pr-2 focus-within:!border-rust lg:bottom-4 shadow-[0_10px_30px_rgba(60,35,15,0.12)] transition-shadow focus-within:border-ink/40 focus-within:shadow-[0_10px_30px_rgba(60,35,15,0.16)]">
          <label htmlFor="chat-input" className="sr-only">Your message</label>
          {hashtag?.items.length > 0 && <TagSuggestions id="chat-tags" items={hashtag.items} active={hashtag.active} onPick={pickTag} />}
          <textarea
            id="chat-input" ref={inputRef} rows={1} value={input} maxLength={2000}
            onChange={(e) => typed(e.target.value, e.target.selectionStart)}
            onKeyDown={keyDown}
            onBlur={() => setHashtag(null)}
            role="combobox" aria-autocomplete="list" aria-expanded={hashtag?.items.length > 0} aria-controls="chat-tags"
            aria-activedescendant={hashtag?.items.length ? `chat-tags-${hashtag.active}` : undefined}
            placeholder={about ? `Ask anything about “${about.title}”…` : "What are you in the mood to read? Try #cozy-mystery"}
            className="max-h-40 flex-1 resize-none border-0 bg-transparent py-2.5 text-[17px] text-ink outline-none [field-sizing:content]"
            style={{ outline: "none" }} /* the whole box shows the focus instead */
          />
          <button type="button" onClick={toggleLocation} disabled={locating} aria-pressed={Boolean(location)}
            aria-label={location ? "Using your location for “near me” – press to turn off" : "Use my location for “near me”"}
            className={`flex h-[42px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors ${location ? "border-moss bg-moss-soft text-moss-dark" : "border-line-strong bg-parchment text-ink-soft hover:border-ink hover:text-ink"}`}>
            <PinIcon /><span className="hidden sm:inline">{locating ? "Locating…" : location ? "Near me" : "Use my location"}</span>
          </button>
          <button disabled={busy || !input.trim()} className="btn btn-primary h-[42px] shrink-0 !px-5 !py-0 disabled:!opacity-40">Send<ArrowIcon /></button>
        </form>
        <p className="m-0 -mt-2 text-center text-xs text-muted">
          Answers come only from books in the BookBridge catalog · Something wrong? <a href={HELP_LINK}>Contact the team</a>
        </p>
        <Toast toast={toast} />
      </div>
    </div>
  );
}
