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
// card - /chat?book=<id>&ask=1): a NEW chat asks at once for the full picture - is it
// for me, what is similar, where to borrow it. On a book card inside the chat it stays in
// the same conversation: the book goes above the message box with ready questions.
// Either way the message tells the server which catalog book it is about.
// "Use my location" is remembered in this browser (only that it is on - not the place).
// Answers STREAM: the text appears while it is written, and the waiting line says what
// the bot is doing ("Searching the catalog…"). "Contact the team" under the chat reaches
// a person (the project's email). The chat is in English, like the rest of the site. Each answer can be translated on
// request ("Translate" under it - server: POST /api/chat/translate) and copied, and the
// latest answer offers 2-3 follow-up questions as buttons.
import { Fragment, useEffect, useRef, useState } from "react";
import Cover from "@/components/Cover";
import ShelfRow from "@/components/ShelfRow";
import RecCard from "@/components/RecCard";
import LibraryMap from "./LibraryMap";
import Reply from "./Reply";
import BookshelfLoader from "@/components/BookshelfLoader";
import Leaf from "@/components/Leaf";
import Toast, { useToast } from "@/components/Toast";
import { XIcon, PinIcon } from "@/components/Icons";
import { api, apiStream } from "@/lib/api";
import { SITE } from "@/lib/site";

const EXAMPLES = [
  "Something like Dune, but shorter",
  "A cozy mystery I can borrow at Beit Ha'am in Jerusalem",
  "What should I read next?",
  "I'm bored – surprise me",
];

// The texts around the conversation
const T = {
  shelf: (n) => (n === 1 ? "The book in this answer" : `${n} books in this answer`),
  shelfHint: "Hover a cover for more · save it, rate it, or hide it",
  fullPicture: "The full picture – is it for me, what's similar, where to borrow it",
  overview: (t) => `Tell me about “${t}” – is it for me? What's similar, and where can I borrow it?`,
  like: (t) => `Books like “${t}”`,
  near: (t) => `Is “${t}” on a shelf near me?`,
  where: (t) => `Where can I borrow “${t}”?`,
  forMe: (t) => `Is “${t}” for me?`,
};

const LOCATION_KEY = "bb-chat-location";

// the waiting line while the bot works - what each of its tools is doing
const DOING = {
  search_books: "Searching the catalog…",
  find_book: "Looking up the book…",
  get_book_details: "Reading about the book…",
  check_availability: "Checking the library shelves…",
  list_libraries: "Looking at the libraries…",
  recommend_for_me: "Asking the recommendation engine…",
  get_my_taste: "Looking at what you love…",
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

// the answer as plain text, for "Copy": book titles instead of markers, no ** marks
const plainText = (text, books) => text.replace(/\[\[book:(\d+)\]\]/g, (m, id) => books.get(Number(id))?.title || "").replace(/\*\*/g, "");

function UserMessage({ text }) {
  return (
    <div className="flex flex-col items-end gap-1 self-end">
      <span className="px-1 text-xs font-bold uppercase tracking-wider text-muted">You</span>
      <div dir="auto" className="max-w-[min(80vw,560px)] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-ink px-4 py-3 text-parchment">{text}</div>
    </div>
  );
}

// small buttons under an answer, and the suggestion chips - one look for all of them
const TOOL = "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-parchment px-3 text-[13px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-60";
const CHIP = "inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-cream px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-rust hover:bg-rust-soft/40 hover:text-rust-dark";
const ArrowIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

// One answer: who is talking, the text (or its translation), Translate / Copy, and -
// on the latest answer - the questions the reader may ask next
function Answer({ m, index, followUps, onSend, onTranslate, onToggleOriginal, onCopy }) {
  const [menu, setMenu] = useState(false);
  const books = new Map((m.books || []).map((b) => [b.id, b]));
  const tr = m.translation;
  const showTr = tr?.text && !tr.showOriginal;
  if (m.streaming && !m.text) return null; // nothing written yet - the waiting line shows instead
  const native = (code) => LANGUAGES.find((l) => l[0] === code)?.[1];
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-3 self-start">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink"><Leaf size={15} color="#C9874E" vein={null} /></span>
        <span className="text-sm font-bold text-ink">BookBridge</span>
        {showTr && <span className="rounded-full bg-moss-soft px-2.5 py-0.5 text-xs font-bold text-moss-dark">Translated · <span lang={tr.to}>{native(tr.to)}</span></span>}
      </div>

      <div className={`rounded-2xl border bg-cream shadow-[0_2px_12px_rgba(43,33,28,0.05)] ${m.error ? "border-rust/40" : "border-line"}`}>
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
            {menu && (
              <div role="menu" className="absolute bottom-full left-3 z-40 mb-2 w-[220px] overflow-hidden rounded-2xl border border-line-strong bg-cream p-1.5 shadow-[0_16px_40px_rgba(43,33,28,0.2)]">
                <span className="block px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Translate this answer to</span>
                {LANGUAGES.map(([code, name]) => (
                  <button key={code} type="button" role="menuitem" onClick={() => { setMenu(false); onTranslate(index, code); }}
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl border-0 bg-transparent px-3 py-2 text-start text-sm text-ink hover:bg-sand">
                    <span lang={code} className="font-medium">{name}</span>
                    <span className="text-xs text-muted">{tr?.to === code && tr?.text ? "✓" : LANGUAGE_NAME[code]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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

// The books of one answer, as a For You shelf
function AnswerShelf({ m, index, onRemove, onAsk }) {
  const showAvailability = m.books.some((b) => b.availabilityText);
  return (
    <ShelfRow id={`chat-shelf-${index}`} title={T.shelf(m.books.length)} subtitle={T.shelfHint} titleClass="text-lg" count={m.books.length}>
      {m.books.map((b) => (
        <div key={b.id} className="relative w-[176px] shrink-0 snap-start sm:w-[190px]">
          <RecCard book={b} showAvailability={showAvailability}
            onDismiss={(id) => onRemove(index, id, "Hidden – we won't suggest it again.")}
            onRated={(id, n) => onRemove(index, id, `Rated ${n}★ – thanks! Your recommendations will use it.`)}
            onAsk={onAsk} />
        </div>
      ))}
    </ShelfRow>
  );
}

// The book the next message is about, with ready questions
function AskingAbout({ book, located, onSend, onClear }) {
  const title = book.title;
  const questions = [
    [T.fullPicture, T.overview(title)],
    [T.like(title), T.like(title)],
    located ? [T.near(title), T.near(title)] : [T.where(title), T.where(title)],
    [T.forMe(title), T.forMe(title)],
  ];
  return (
    <div className="card flex items-start gap-4 p-4">
      <Cover book={book} small className="w-[46px] flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="text-sm text-ink-soft">You&apos;re asking about <strong className="text-ink">{title}</strong>{book.authors?.[0] ? ` by ${book.authors[0]}` : ""}</span>
        <div className="flex flex-wrap gap-2">
          {questions.map(([label, question]) => (
            <button key={label} type="button" onClick={() => onSend(question)} className="rounded-full border border-line-strong bg-parchment px-3.5 py-1.5 text-sm text-ink hover:border-ink">{label}</button>
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

// The saved conversations, newest first
function ChatHistory({ conversations, activeId, onOpen, onDelete }) {
  if (!conversations) return <p className="m-0 px-1 text-sm text-muted">Loading…</p>;
  if (!conversations.length) return <p className="m-0 px-1 text-sm leading-relaxed text-muted">Your chats will be saved here.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {conversations.map((c) => (
        <li key={c.id} className="group relative">
          <button type="button" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "true" : undefined}
            className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2.5 pr-9 text-left ${c.id === activeId ? "border-line-strong bg-cream" : "border-transparent bg-transparent hover:bg-cream/70"}`}>
            <span dir="auto" className="line-clamp-2 text-sm font-medium leading-snug text-ink">{c.title}</span>
            <span className="text-xs text-muted">{when(c.updatedAt)}</span>
          </button>
          <button type="button" onClick={() => onDelete(c)} aria-label={`Delete the chat “${c.title}”`} title="Delete chat"
            className="absolute right-1.5 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted opacity-0 hover:bg-sand hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
            <XIcon />
          </button>
        </li>
      ))}
    </ul>
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
  const [opening, setOpening] = useState(false);
  const [location, setLocation] = useState(null); // { lat, lng } while "Use my location" is on
  const [locating, setLocating] = useState(false);
  const [about, setAbout] = useState(null); // the book the next message is about
  const autoAsk = useRef(false); // opened with ?ask=1: ask the overview as soon as the book (and location) are ready
  const [busyLabel, setBusyLabel] = useState("");
  const lastAnswer = messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1] : null;
  const [showHistory, setShowHistory] = useState(false); // phones: the list opens above the chat
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  // the history list, and the conversation in the address (after a refresh / from a link).
  // Runs again each time the reader comes back to this page (it is kept alive, not remounted).
  useEffect(() => {
    api("/api/chat").then((r) => setConversations(r.conversations)).catch(() => setConversations([]));
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
      autoAsk.current = Boolean(params.get("ask"));
      api(`/api/books/${bookId}`, { auth: false })
        .then((b) => { setAbout(b); setAddress(params.get("c")); inputRef.current?.focus(); })
        .catch(() => { autoAsk.current = false; showToast("That book was not found."); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // opened from "Ask about this book": ask for the full picture once the book (and the location, if on) are ready
  useEffect(() => {
    if (!autoAsk.current || !about || locating || busy || opening) return;
    autoAsk.current = false;
    send(T.overview(about.title));
  }, [about, locating, busy, opening]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(id) {
    setShowHistory(false);
    if (id === conversationId) return;
    setOpening(true);
    try {
      const r = await api(`/api/chat/${id}`);
      setConversationId(r.id);
      setMessages(r.turns.flatMap((t) => [{ role: "user", text: t.message }, { role: "assistant", text: t.reply, books: t.books, places: t.places }]));
      setAddress(r.id);
    } catch (err) {
      setAddress(null);
      showToast(err.message === "conversation not found" ? "That chat was deleted." : err.message);
    } finally {
      setOpening(false);
    }
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
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
      await apiStream("/api/chat", {
        body: { message, conversationId, location: location || undefined, bookId },
        onEvent: (event, data) => {
          if (event === "delta") update((m) => ({ text: m.text + data.text }));
          else if (event === "reset") update(() => ({ text: "" }));
          else if (event === "status") setBusyLabel(DOING[data.tools?.[0]] || "Searching the shelves…");
          else if (event === "books") update((m) => ({ books: [...m.books, ...data.books.filter((b) => !m.books.some((x) => x.id === b.id))] }));
          else if (event === "done") r = data;
          else if (event === "error") throw new Error(data.error);
        },
      });
      if (!r) throw new Error("The answer was cut off – please try again.");
      setMessages((ms) => ms.map((m) => (m.streaming ? { role: "assistant", text: r.reply, books: r.books, places: r.places, followUps: r.followUps } : m)));
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
  function removeBook(index, id, message) {
    setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, books: m.books.filter((b) => b.id !== id) } : m)));
    showToast(message);
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

  const history = <ChatHistory conversations={conversations} activeId={conversationId} onOpen={open} onDelete={remove} />;

  return (
    <div className="flex items-start gap-10">
      <aside aria-label="Your chats" className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-[240px] shrink-0 flex-col gap-3 overflow-y-auto lg:flex">
        <button type="button" onClick={startNew} className="btn btn-dark w-full py-2.5 text-sm">+ New chat</button>
        <h2 className="eyebrow m-0 mt-2 px-1">Your chats</h2>
        {history}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="eyebrow">AI book discovery</span>
            <h1 className="m-0 font-serif text-5xl font-semibold">Ask BookBridge</h1>
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
              Describe the book you are in the mood for, and refine it as we talk – “shorter”, “not horror”, “with a female lead”.
              Every answer comes from real books in the BookBridge catalog.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" onClick={() => send(e)} className={CHIP}>{e}<span className="text-muted"><ArrowIcon /></span></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-live="polite">
            {messages.map((m, i) => (
              <Fragment key={i}>
                {m.role === "user"
                  ? <UserMessage text={m.text} />
                  : <Answer m={m} index={i} followUps={!busy && m === lastAnswer ? m.followUps : null} onSend={send}
                      onTranslate={translate} onToggleOriginal={toggleOriginal} onCopy={copy} />}
                {!m.streaming && m.books?.length > 0 && <AnswerShelf m={m} index={i} onRemove={removeBook} onAsk={askAbout} />}
              {m.places?.branches?.length > 0 && m.books?.length > 0 && <LibraryMap places={m.places} books={m.books} />}
              </Fragment>
            ))}
            {busy && !messages.some((m) => m.streaming && m.text) && <BookshelfLoader label={busyLabel} className="self-start" />}
            <div ref={endRef} />
          </div>
        )}

        {about && <AskingAbout book={about} located={Boolean(location)} onSend={send} onClear={() => setAbout(null)} />}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-4 z-30 flex items-end gap-2 rounded-[28px] border border-line-strong bg-cream py-2 pl-5 pr-2 shadow-[0_10px_30px_rgba(43,33,28,0.12)] transition-shadow focus-within:border-ink/40 focus-within:shadow-[0_10px_30px_rgba(43,33,28,0.16)]">
          <label htmlFor="chat-input" className="sr-only">Your message</label>
          <textarea
            id="chat-input" ref={inputRef} rows={1} value={input} maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
            placeholder={about ? `Ask anything about “${about.title}”…` : "What are you in the mood to read?"}
            className="max-h-40 flex-1 resize-none border-0 bg-transparent py-2.5 text-[17px] text-ink outline-none [field-sizing:content]"
          />
          <button type="button" onClick={toggleLocation} disabled={locating} aria-pressed={Boolean(location)}
            aria-label={location ? "Using your location for “near me” – press to turn off" : "Use my location for “near me”"}
            className={`flex h-[42px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${location ? "border-moss bg-moss-soft text-moss-dark" : "border-line-strong bg-parchment text-ink-soft hover:border-ink hover:text-ink"}`}>
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
