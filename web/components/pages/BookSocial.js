"use client";

// The readers around one book (inside the book page). Server: server/social-routes.js - it sends up
// to 100 reviews and 500 posts; sorting, filtering and the layout happen here.
// Built to stay calm with many readers - neither part makes the page longer as it fills up:
//   Reviews     the rating summary (average + how the stars split - press a row to see only those)
//               beside a row of review cards that scrolls sideways, like the shelves.
//   Discussion  a channel: a box of fixed height with its own scroll, newest at the bottom, the
//               message box under it. Messages in a row from one reader are grouped; a reply shows
//               a quote of what it answers (press it to jump there). The author's pin is a banner.
// Spoilers are blurred until the reader asks to see them; reviews can be marked Helpful (and
// sorted by it); messages get quick reactions; anything can be reported to the team. The channel
// checks for new messages every few seconds while it is on screen, and an unsent review or
// message is kept in this browser (a refresh does not lose it).
// User text is shown as plain text (React escapes it) with its line breaks kept.
// A reader who has not rated the book rates it right here (onRate - the book page's own rating).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import StarRating from "@/components/Stars";

const MAX_LEN = 2000;
const SHOW_COUNT_FROM = 1800; // the counter appears only near the limit
const GROUP_MINUTES = 10;     // messages from one reader this close together are one group
const STARTERS = ["Who would you recommend it to?", "Which character stayed with you?", "Did the ending work for you?"];
const SORTS = [["helpful", "Most helpful"], ["new", "Newest"], ["high", "Highest rated"], ["low", "Lowest rated"]];
const REACTIONS = ["❤️", "😂", "😢", "🤯"];
const REPORT_REASONS = [["spoiler", "Spoiler"], ["offensive", "Offensive"], ["spam", "Spam"], ["other", "Other"]];
const EMOJIS = ["😀", "😂", "🥹", "😍", "🥰", "😮", "😢", "😭", "😡", "🤯", "🤔", "🙄", "😴", "😱", "👍", "👏", "🙏", "❤️", "💔", "🔥", "✨", "📚", "📖", "☕"];
const ANONYMOUS = "Anonymous reader";
const PEN_KEY = "bb-pen-name";
const SPOILERS_KEY = "bb-spoilers";
// how marked spoilers look, for the whole section (remembered in this browser):
// blur - hidden until pressed · hide - left out of the lists · show - shown as they are
const SPOILER_MODES = [["blur", "Blur"], ["hide", "Hide"], ["show", "Show"]];
const SpoilerMode = createContext("blur");
const CARD_LINES = 4;         // a review card shows this much; the rest opens in a window
const LIVE_SECONDS = 12;      // the channel looks for new messages this often (only while the page is visible)

// an unsent review / message, kept per book in this browser
const draft = {
  get: (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } },
  set: (key, text) => { try { if (text) localStorage.setItem(key, text); else localStorage.removeItem(key); } catch {} },
};

// the name readers chose to post under (empty = their own), kept in this browser
const penName = {
  get: () => { try { return localStorage.getItem(PEN_KEY) || ""; } catch { return ""; } },
  set: (a) => { try { if (a) localStorage.setItem(PEN_KEY, a); else localStorage.removeItem(PEN_KEY); } catch {} },
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(date) {
  const s = (new Date(date) - Date.now()) / 1000;
  const steps = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, sec] of steps) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  return "just now";
}
const clock = (date) => new Date(date).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
function dayLabel(date) {
  const d = new Date(date), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en", { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
const Stars = ({ n }) => <span aria-label={`${n} of 5 stars`} className="whitespace-nowrap text-gold">{"★".repeat(n)}<span className="text-line-strong">{"★".repeat(5 - n)}</span></span>;
// on the writer's own review / message that readers reported - nobody else sees it now
const HiddenNote = () => <span className="rounded-md bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink-soft">Hidden – reported, the team is checking it</span>;
const AuthorBadge = () => <span className="rounded-md bg-rust px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cream">Author</span>;
const Avatar = ({ name, author, small }) => (
  <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-serif font-semibold ${small ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"} ${author ? "bg-rust text-cream" : "bg-sand text-ink-soft"}`}>
    {(name || "?").charAt(0).toUpperCase()}
  </span>
);
const LINK = "cursor-pointer bg-transparent p-0 text-sm";
const H3 = "m-0 font-serif text-2xl font-semibold";

// Long text cut to a few lines; "Read more" only when it really is cut
function Clamp({ text, lines = 3, onMore }) {
  const [all, setAll] = useState(false);
  const [cut, setCut] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="flex flex-col items-start gap-1">
      <p ref={ref} dir="auto" style={all ? undefined : { WebkitLineClamp: lines, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}
        className="m-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-soft">{text}</p>
      {(cut || all) && <button type="button" onClick={() => (onMore ? onMore() : setAll(!all))} className={`${LINK} font-medium text-rust`}>{all ? "Show less" : "Read more"}</button>}
    </div>
  );
}

// blurred until the reader chooses to see it
function Spoiler({ on, children }) {
  const [shown, setShown] = useState(false);
  const mode = useContext(SpoilerMode);
  if (!on || shown || mode === "show") return children;
  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none select-none blur-[6px]">{children}</div>
      <button type="button" onClick={() => setShown(true)}
        className="absolute inset-0 flex cursor-pointer items-center justify-center gap-1.5 rounded bg-transparent text-xs font-semibold text-ink">
        <span className="rounded-full border border-line-strong bg-cream px-3 py-1 shadow-sm">Spoiler · show it</span>
      </button>
    </div>
  );
}

// "Report" -> pick why -> "Reported - thanks" (only once the server has it)
function Report({ onReport, open = false, onClose }) {
  const [step, setStep] = useState(open ? "pick" : "idle"); // idle -> pick -> sending -> done | failed
  if (step === "done") return <span className="text-xs text-moss-dark">Reported – thanks, the team will check it</span>;
  if (step === "sending") return <span className="text-xs text-muted">Sending…</span>;
  if (step === "failed") {
    return (
      <span className="text-xs text-rust-dark">Couldn&apos;t send the report · <button type="button" onClick={() => setStep("pick")} className={`${LINK} text-xs text-rust underline`}>try again</button></span>
    );
  }
  if (step === "idle") return <button type="button" onClick={() => setStep("pick")} className={`${LINK} text-xs text-muted hover:text-rust-dark`}>Report</button>;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">Why?</span>
      {REPORT_REASONS.map(([v, l]) => (
        <button key={v} type="button" onClick={async () => { setStep("sending"); try { await onReport(v); setStep("done"); } catch { setStep("failed"); } }}
          className="cursor-pointer rounded border border-line-strong bg-cream px-2 py-0.5 text-ink hover:border-rust hover:text-rust-dark">{l}</button>
      ))}
      <button type="button" onClick={() => (onClose ? onClose() : setStep("idle"))} aria-label="Cancel" className={`${LINK} text-muted`}>×</button>
    </span>
  );
}

// put text where the caret is (or over the selection)
function insertAt(box, text, value, setValue) {
  const el = box.current;
  const a = el?.selectionStart ?? value.length, b = el?.selectionEnd ?? value.length;
  setValue(value.slice(0, a) + text + value.slice(b));
  requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + text.length, a + text.length); });
}

// a small popover beside its button; closes on Escape and when the focus leaves it
function Popover({ label, button, open, setOpen, children, wide }) {
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} className={TOOL_BTN(open)}>{button}</button>
      {open && (
        <div className={`absolute bottom-full left-0 z-40 mb-2 rounded-md border border-line-strong bg-cream p-2 shadow-[0_10px_30px_rgba(60,35,15,0.18)] ${wide ? "w-[250px]" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}
const TOOL_BTN = (on) => `flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${on ? "border-rust bg-rust-soft text-rust-dark" : "border-transparent bg-transparent text-ink-soft hover:border-line-strong hover:bg-cream"}`;

function EmojiPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover label="Add an emoji" button={<span className="text-base leading-none">🙂</span>} open={open} setOpen={setOpen}>
      <div className="grid w-[232px] grid-cols-8 gap-0.5">
        {EMOJIS.map((e) => (
          <button key={e} type="button" onClick={() => { onPick(e); setOpen(false); }} aria-label={e}
            className="cursor-pointer rounded bg-transparent p-1 text-lg leading-none hover:bg-parchment">{e}</button>
        ))}
      </div>
    </Popover>
  );
}

const SpoilerToggle = ({ on, onChange }) => (
  <button type="button" onClick={() => onChange(!on)} aria-pressed={on} title="Hidden until a reader chooses to see it" className={TOOL_BTN(on)}>
    <span className="text-base leading-none">🙈</span>Spoiler{on && " ✓"}
  </button>
);

// whose name goes on it: your name, "Anonymous reader", or a pen name (remembered in this browser)
function PostingAs({ myName, alias, onChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(alias && alias !== ANONYMOUS ? alias : "");
  const pick = (a) => { onChange(a); penName.set(a); setOpen(false); };
  const options = [["", `${myName || "My name"}`], [ANONYMOUS, ANONYMOUS]];
  return (
    <Popover wide label="Choose the name on your post" open={open} setOpen={setOpen}
      button={<>as <b className="max-w-[120px] truncate font-semibold text-ink">{alias || myName || "you"}</b><span aria-hidden="true">▾</span></>}>
      <div className="flex flex-col gap-1 text-sm">
        {options.map(([v, l]) => (
          <button key={l} type="button" onClick={() => pick(v)}
            className={`flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left ${alias === v ? "bg-rust-soft text-rust-dark" : "bg-transparent text-ink hover:bg-parchment"}`}>
            {l}{v === "" && <span className="text-xs text-muted">your name</span>}
          </button>
        ))}
        {/* not a <form>: it sits inside the message's form - Enter here only picks the name */}
        <div className="flex gap-1.5 border-t border-line pt-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={30} placeholder="A pen name…" aria-label="A pen name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (custom.trim().length >= 2) pick(custom.trim()); } }}
            className="field min-w-0 flex-1 !px-2 !py-1.5 text-sm" />
          <button type="button" disabled={custom.trim().length < 2} onClick={() => pick(custom.trim())} className="btn btn-outline shrink-0 px-2.5 py-1 text-xs">Use</button>
        </div>
        <span className="px-1 text-[11px] leading-snug text-muted">Other readers see only this name. The team can still see who wrote it.</span>
      </div>
    </Popover>
  );
}

// the row under the text: emoji · spoiler · posting as
function Tools({ box, value, setValue, spoiler, setSpoiler, myName, alias, setAlias }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <EmojiPicker onPick={(e) => insertAt(box, e, value, setValue)} />
      <SpoilerToggle on={spoiler} onChange={setSpoiler} />
      <PostingAs myName={myName} alias={alias} onChange={setAlias} />
    </div>
  );
}

// a whole review, when its card is too short for it
function ReviewDialog({ r, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${r.name}'s review`} onClick={(e) => e.stopPropagation()}
        className="card flex max-h-[80vh] w-full max-w-[560px] flex-col gap-3 overflow-y-auto rounded-md p-6">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} author={r.isAuthor} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-bold text-ink">{r.mine ? "You" : r.name}{r.isAuthor && <AuthorBadge />}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted">{r.rating > 0 && <Stars n={r.rating} />}{ago(r.updatedAt)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`${LINK} text-xl leading-none text-muted hover:text-ink`}>×</button>
        </div>
        <p dir="auto" className="m-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-soft">{r.body}</p>
      </div>
    </div>
  );
}

function ReviewBox({ initial, initialSpoiler, initialAlias, myName, draftKey, saving, onSave, onCancel }) {
  const [text, setText] = useState(() => initial || draft.get(draftKey));
  const [spoiler, setSpoiler] = useState(initialSpoiler);
  const [alias, setAlias] = useState(() => (initial ? initialAlias || "" : penName.get()));
  const [error, setError] = useState(null);
  const box = useRef(null);
  const change = (t) => { setText(t); if (!initial) draft.set(draftKey, t); };
  const submit = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    try { setError(null); await onSave(text.trim(), spoiler, alias); draft.set(draftKey, ""); } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border border-line-strong bg-cream p-3">
      <textarea ref={box} value={text} onChange={(e) => change(e.target.value)} maxLength={MAX_LEN} rows={4} autoFocus dir="auto"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e); if (e.key === "Escape") onCancel(); }}
        placeholder="What did you think? A few words help other readers." aria-label="Your review" className="field resize-y border-0 !p-1 text-[15px] leading-relaxed" style={{ outline: "none" }} />
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <Tools box={box} value={text} setValue={change} spoiler={spoiler} setSpoiler={setSpoiler} myName={myName} alias={alias} setAlias={setAlias} />
        <div className="ml-auto flex items-center gap-3">
          {text.length >= SHOW_COUNT_FROM && <span className="text-xs text-muted">{text.length}/{MAX_LEN}</span>}
          <button type="button" onClick={onCancel} className={`${LINK} text-muted`}>Cancel</button>
          <button disabled={saving || !text.trim()} className="btn btn-primary px-5 py-2 text-sm">{saving ? "Saving…" : initial ? "Save review" : "Post review"}</button>
        </div>
      </div>
    </form>
  );
}

// ---------- Reviews ----------

function Summary({ reviews, filter, onFilter }) {
  const ratings = reviews.map((r) => r.rating).filter(Boolean);
  if (!ratings.length) return null;
  const average = ratings.reduce((s, n) => s + n, 0) / ratings.length;
  const per = [5, 4, 3, 2, 1].map((n) => [n, ratings.filter((r) => r === n).length]);
  const most = Math.max(1, ...per.map(([, c]) => c));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <span className="font-serif text-5xl font-semibold leading-none text-ink">{average.toFixed(1)}</span>
        <div className="flex flex-col gap-0.5 pb-0.5">
          <Stars n={Math.round(average)} />
          <span className="text-xs text-muted">{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</span>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Show reviews by stars">
        {per.map(([n, c]) => (
          <li key={n}>
            <button type="button" disabled={!c} onClick={() => onFilter(filter === n ? 0 : n)} aria-pressed={filter === n}
              aria-label={`${n} stars: ${c} ${c === 1 ? "review" : "reviews"}`}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded px-1.5 py-1 text-xs disabled:cursor-default ${filter === n ? "bg-rust-soft" : "bg-transparent enabled:hover:bg-parchment"}`}>
              <span className="w-3 text-right font-semibold text-ink-soft">{n}</span>
              <span className="text-gold">★</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-sand">
                <span className="block h-full rounded-full bg-gold transition-[width]" style={{ width: `${(c / most) * 100}%` }} />
              </span>
              <span className="w-7 text-right tabular-nums text-muted">{c}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// the reader's own part: rate -> write -> their review
function MyPart({ rated, myRating, mine, onRate, onWrite, onDelete }) {
  if (!rated) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line bg-parchment px-4 py-3.5">
        <span className="text-sm font-medium text-ink">Read it? Rate it to write a review</span>
        {onRate ? <StarRating value={0} onChange={onRate} size={24} label="Rate this book" /> : <span className="text-sm text-muted">Rate the book above first.</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-parchment px-4 py-3.5">
      <span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">{mine ? "Your review" : "You gave it"} <Stars n={myRating} /></span>
      {mine ? (
        <div className="flex gap-4">
          <button type="button" onClick={onWrite} className={`${LINK} font-medium text-rust`}>Edit</button>
          <button type="button" onClick={onDelete} className={`${LINK} text-muted hover:text-rust-dark`}>Delete</button>
        </div>
      ) : (
        <button type="button" onClick={onWrite} className="btn btn-primary self-start px-4 py-2 text-sm">Write a review</button>
      )}
    </div>
  );
}

function ReviewCard({ r, own, onHelpful, onReport, onOpen }) {
  return (
    <li className={`flex h-[214px] snap-start flex-col gap-2.5 overflow-hidden rounded-md border p-4 ${own ? "border-rust/40 bg-rust-soft/30" : "border-line bg-parchment"}`}>
      <div className="flex items-center gap-2.5">
        <Avatar name={own ? "You" : r.name} author={r.isAuthor} />
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 truncate text-sm font-bold text-ink">{own ? "You" : r.name}{r.isAuthor && <AuthorBadge />}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">{r.rating > 0 && <Stars n={r.rating} />}{ago(r.updatedAt)}</span>
        </div>
      </div>
      {r.hidden && <span className="self-start"><HiddenNote /></span>}
      <Spoiler on={r.spoiler}><Clamp text={r.body} lines={CARD_LINES} onMore={() => onOpen(r)} /></Spoiler>
      {!own && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" onClick={() => onHelpful(r)} aria-pressed={r.helpfulByMe}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${r.helpfulByMe ? "border-rust/50 bg-rust-soft text-rust-dark" : "border-line bg-cream text-ink-soft hover:border-ink"}`}>
            Helpful{r.helpful > 0 && <span className="tabular-nums">· {r.helpful}</span>}
          </button>
          <Report onReport={(reason) => onReport(r, reason)} />
        </div>
      )}
    </li>
  );
}

function Reviews({ data, bookId, myRating, onRate, reload, preview }) {
  const hideSpoilers = useContext(SpoilerMode) === "hide";
  const [sort, setSort] = useState(() => (data.reviews.some((r) => r.helpful > 0) ? "helpful" : "new"));
  const [filter, setFilter] = useState(0);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opened, setOpened] = useState(null); // a review shown whole
  const [failed, setFailed] = useState(null);
  const row = useRef(null);
  const mine = data.reviews.find((r) => r.mine);
  const list = useMemo(() => {
    const by = { helpful: (a, b) => (b.helpful || 0) - (a.helpful || 0), new: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt), high: (a, b) => (b.rating || 0) - (a.rating || 0), low: (a, b) => (a.rating || 6) - (b.rating || 6) };
    const others = data.reviews.filter((r) => !r.mine && (!filter || r.rating === filter) && !(hideSpoilers && r.spoiler));
    others.sort((a, b) => by[sort](a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));
    return mine && (!filter || mine.rating === filter) ? [mine, ...others] : others;
  }, [data.reviews, mine, sort, filter, hideSpoilers]);
  const changed = (f) => { f(); row.current?.scrollTo({ left: 0 }); };

  async function save(body, spoiler, alias) {
    setSaving(true);
    try {
      if (!preview) await api(`/api/social/books/${bookId}/review`, { method: "PUT", body: { body, spoiler, alias } });
      setWriting(false);
      await reload();
    } finally { setSaving(false); }
  }
  const remove = async () => { if (window.confirm("Delete your review?")) { await api(`/api/social/books/${bookId}/review`, { method: "DELETE" }); reload(); } };
  const helpful = async (r) => {
    try {
      setFailed(null);
      if (!preview) await api(`/api/social/books/${bookId}/reviews/${r.id}/helpful`, { method: "POST", body: { on: !r.helpfulByMe } });
      reload();
    } catch { setFailed("Couldn't save “Helpful” – please try again."); }
  };
  const report = (r, reason) => (preview ? Promise.resolve() : api(`/api/social/books/${bookId}/report`, { method: "POST", body: { kind: "review", id: r.id, reason } }));
  const scroll = (dir) => row.current?.scrollBy({ left: dir * (row.current.clientWidth - 80), behavior: "smooth" });

  const count = filter ? <>{list.length} with {filter}★ · <button type="button" onClick={() => changed(() => setFilter(0))} className={`${LINK} text-rust`}>show all</button></> : null;
  return (
    <div className="flex flex-col gap-5">
      {/* one header across the whole width, so the summary and the cards start on the same line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className={H3}>Reviews</h3>
          {count && <span className="text-sm text-muted">{count}</span>}
        </div>
        {data.reviews.some((r) => !r.mine) && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">Sort
              <select value={sort} onChange={(e) => changed(() => setSort(e.target.value))} className="field cursor-pointer !w-auto !py-1.5 text-sm text-ink">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {list.length > 2 && ["←", "→"].map((a, i) => (
              <button key={a} type="button" onClick={() => scroll(i ? 1 : -1)} aria-label={i ? "More reviews" : "Back"}
                className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-cream text-ink hover:border-ink md:flex">{a}</button>
            ))}
          </div>
        )}
      </div>

      <div className="grid items-start gap-x-10 gap-y-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Summary reviews={data.reviews} filter={filter} onFilter={(f) => changed(() => setFilter(f))} />
          <MyPart rated={myRating > 0} myRating={myRating} mine={mine} onWrite={() => setWriting(true)} onDelete={remove}
            onRate={onRate && ((n) => { onRate(n); setWriting(true); })} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {failed && <p role="alert" className="m-0 text-sm text-rust-dark">{failed}</p>}
          {writing && <ReviewBox initial={mine?.body || ""} initialSpoiler={Boolean(mine?.spoiler)} initialAlias={mine?.alias} myName={data.me.name}
            draftKey={`bb-review-${bookId}`} saving={saving} onSave={save} onCancel={() => setWriting(false)} />}
          {data.reviews.length === 0 ? (
            !writing && <p className="m-0 rounded-md border border-dashed border-line-strong px-6 py-10 text-center text-muted">No reviews yet – be the first to tell other readers what you thought.</p>
          ) : (
            // two even rows of cards when there are enough, the same height as the summary beside them
            <ul ref={row} aria-label="Reviews" className={`shelf-scroll m-0 grid auto-cols-[85%] grid-flow-col snap-x snap-mandatory list-none gap-4 overflow-x-auto p-0 pb-3 sm:auto-cols-[300px] ${list.length > 3 ? "lg:grid-rows-2" : ""}`}>
              {list.map((r, i) => <ReviewCard key={r.mine ? "mine" : `${r.id ?? r.name}-${i}`} r={r} own={r.mine} onHelpful={helpful} onReport={report} onOpen={setOpened} />)}
            </ul>
          )}
        </div>
      </div>
      {opened && <ReviewDialog r={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

// ---------- Discussion: a channel ----------

// posts + replies -> one line of messages, oldest first, each reply knowing what it answers
function asChannel(posts) {
  const all = [];
  for (const p of posts) {
    all.push({ ...p, replies: undefined });
    for (const r of p.replies || []) all.push({ ...r, replyTo: { id: p.id, name: p.mine ? "you" : p.name, body: p.body, spoiler: p.spoiler } });
  }
  return all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function Message({ m, grouped, canPin, onReply, onDelete, onPin, onJump, onReact, onReport, flash }) {
  const [reporting, setReporting] = useState(false);
  const author = m.isAuthor && !m.mine;
  return (
    <li id={`msg-${m.id}`} className={`group relative flex gap-3 rounded-md px-3 transition-colors ${grouped ? "py-0.5" : "pt-2.5 pb-0.5"} ${flash ? "bg-rust-soft/60" : author ? "border-l-2 border-rust/60 bg-rust-soft/25" : "hover:bg-parchment"}`}>
      {grouped
        ? <span className="w-9 shrink-0 pt-1 text-right text-[10px] text-transparent group-hover:text-muted">{clock(m.createdAt)}</span>
        : <Avatar name={m.mine ? "You" : m.name} author={m.isAuthor} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-bold text-ink">{m.mine ? "You" : m.name}</span>
            {m.isAuthor && <AuthorBadge />}
            <span className="text-xs text-muted">{clock(m.createdAt)}</span>
          </div>
        )}
        {m.replyTo && (
          <button type="button" onClick={() => onJump(m.replyTo.id)}
            className="flex max-w-full cursor-pointer items-center gap-1.5 self-start truncate rounded border-l-2 border-line-strong bg-transparent py-0.5 pl-2 text-left text-xs text-muted hover:text-ink">
            <span className="shrink-0 font-semibold">↪ {m.replyTo.name}</span>
            <span className="truncate">{m.replyTo.spoiler ? "(spoiler)" : m.replyTo.body}</span>
          </button>
        )}
        {m.hidden && <span className="self-start"><HiddenNote /></span>}
        <Spoiler on={m.spoiler && !m.mine}><Clamp text={m.body} lines={6} /></Spoiler>
        {m.reactions?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {m.reactions.map((x) => (
              <button key={x.emoji} type="button" onClick={() => onReact(m, x.emoji, !x.mine)} aria-pressed={x.mine} aria-label={`${x.emoji} ${x.count}`}
                className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums transition-colors ${x.mine ? "border-rust/50 bg-rust-soft text-rust-dark" : "border-line bg-cream text-ink-soft hover:border-ink"}`}>
                <span>{x.emoji}</span>{x.count}
              </button>
            ))}
          </div>
        )}
        {reporting && <div className="mt-1"><Report open onClose={() => setReporting(false)} onReport={(reason) => onReport(m, reason)} /></div>}
      </div>
      {/* the actions show on hover (always on touch screens) */}
      <div className="absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border border-line bg-cream px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        {REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => onReact(m, e, !m.reactions?.some((x) => x.emoji === e && x.mine))} aria-label={`React ${e}`}
            className="cursor-pointer rounded bg-transparent px-1 text-sm leading-6 transition-transform hover:scale-125 motion-reduce:transform-none">{e}</button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        {!m.replyTo && <button type="button" onClick={() => onReply(m)} className={`${LINK} px-1.5 text-xs font-medium text-rust`}>Reply</button>}
        {canPin && !m.replyTo && <button type="button" onClick={() => onPin(m.id, !m.pinned)} className={`${LINK} px-1.5 text-xs text-ink-soft`}>{m.pinned ? "Unpin" : "Pin"}</button>}
        {m.mine
          ? <button type="button" onClick={() => onDelete(m.id)} className={`${LINK} px-1.5 text-xs text-muted hover:text-rust-dark`}>Delete</button>
          : <button type="button" onClick={() => setReporting(!reporting)} className={`${LINK} px-1.5 text-xs text-muted hover:text-rust-dark`}>Report</button>}
      </div>
    </li>
  );
}

function Discussion({ data, bookId, reload, preview }) {
  const hideSpoilers = useContext(SpoilerMode) === "hide";
  const draftKey = `bb-msg-${bookId}`;
  const [text, setText] = useState(() => (preview ? "" : draft.get(draftKey)));
  const [spoiler, setSpoiler] = useState(false);
  const [alias, setAlias] = useState(() => (preview ? "" : penName.get()));
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [unseen, setUnseen] = useState(0); // new messages that came while the reader was reading higher up
  const feed = useRef(null);
  const box = useRef(null);
  const atBottom = useRef(true);
  const seen = useRef(0);
  const messages = useMemo(() => asChannel(data.posts).filter((m) => !(hideSpoilers && m.spoiler && !m.mine)), [data.posts, hideSpoilers]);
  const pinned = data.posts.find((p) => p.pinned);
  const canPin = data.me.isAuthor;
  const authorTalks = messages.some((m) => m.isAuthor && !m.mine);
  const askAuthor = data.authorHere && !data.me.isAuthor;

  const toBottom = () => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; setUnseen(0); };
  // open at the newest message - inside the box only, the page stays where it is. New messages
  // (yours, or from the live check) follow along only if the reader is already at the bottom.
  useEffect(() => {
    const added = messages.length - seen.current;
    if (seen.current === 0 || atBottom.current) toBottom();
    else if (added > 0) setUnseen((n) => n + added);
    seen.current = messages.length;
  }, [messages.length]);
  const scrolled = () => {
    const el = feed.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current) setUnseen(0);
  };

  function jump(id) {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash(null), 1400);
  }
  const write = (t) => { setText(t); if (!preview) draft.set(draftKey, t); };
  function prefill(q) { write(q); requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(q.length, q.length); }); }
  function reply(m) { setReplyTo(m); box.current?.focus(); }

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      if (!preview) await api(`/api/social/books/${bookId}/posts`, { method: "POST", body: { body, parentId: replyTo?.id, spoiler, alias } });
      write(""); setReplyTo(null); setSpoiler(false);
      atBottom.current = true;
      await reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const remove = async (id) => { if (window.confirm("Delete this message? Replies to it are deleted too.")) { await api(`/api/social/posts/${id}`, { method: "DELETE" }); reload(); } };
  const pin = async (id, on) => { await api(`/api/social/posts/${id}/pin`, { method: "POST", body: { pinned: on } }); reload(); };
  const react = async (m, emoji, on) => {
    try {
      setError(null);
      if (!preview) await api(`/api/social/posts/${m.id}/react`, { method: "POST", body: { emoji, on } });
      reload();
    } catch { setError("Couldn't save your reaction – please try again."); }
  };
  const report = (m, reason) => (preview ? Promise.resolve() : api(`/api/social/books/${bookId}/report`, { method: "POST", body: { kind: "post", id: m.id, reason } }));

  let lastDay = null, prev = null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className={H3}>Discussion</h3>
          {authorTalks && <span className="flex items-center gap-1.5 text-xs font-semibold text-rust"><span className="h-1.5 w-1.5 rounded-full bg-rust" aria-hidden="true" />The author takes part</span>}
        </div>
        {canPin ? <span className="text-sm text-muted">You are an author of this book – your messages carry the Author badge.</span>
          : askAuthor && <button type="button" onClick={() => prefill("Question for the author: ")} className="btn btn-outline px-3.5 py-1.5 text-sm">Ask the author</button>}
      </div>

      <div className="relative flex flex-col overflow-hidden rounded-md border border-line-strong bg-cream">
        {pinned && (
          <button type="button" onClick={() => jump(pinned.id)}
            className="flex cursor-pointer items-center gap-2 border-b border-line bg-parchment px-4 py-2.5 text-left text-sm">
            <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-rust">Pinned</span>
            <span className="shrink-0 font-semibold text-ink">{pinned.name}:</span>
            <span className="truncate text-ink-soft">{pinned.spoiler ? "(spoiler)" : pinned.body}</span>
          </button>
        )}

        <ol ref={feed} onScroll={scrolled} aria-label="Messages" aria-live="polite" className="quiet-scroll m-0 flex max-h-[min(400px,55vh)] min-h-[200px] list-none flex-col overflow-y-auto p-0 py-2">
          {messages.length === 0 ? (
            <li className="m-auto flex max-w-[420px] flex-col items-center gap-3 px-6 py-6 text-center">
              <p className="m-0 text-muted">No messages yet. Say the first word – or pick one:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((q) => (
                  <button key={q} type="button" onClick={() => prefill(q)}
                    className="cursor-pointer rounded-md border border-line-strong bg-cream px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-rust hover:bg-rust-soft/40 hover:text-rust-dark">{q}</button>
                ))}
              </div>
            </li>
          ) : messages.map((m) => {
            const day = dayLabel(m.createdAt);
            const newDay = day !== lastDay;
            const grouped = !newDay && !m.replyTo && prev && (prev.who ?? prev.name) === (m.who ?? m.name) && prev.name === m.name
              && new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_MINUTES * 60e3;
            lastDay = day; prev = m;
            return (
              <li key={m.id} className="list-none">
                {newDay && (
                  <div className="my-2 flex items-center gap-3 px-4 text-xs font-semibold text-muted" role="separator">
                    <span className="h-px flex-1 bg-line" />{day}<span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <ul className="m-0 list-none p-0">
                  <Message m={m} grouped={grouped} canPin={canPin} onReply={reply} onDelete={remove} onPin={pin} onJump={jump}
                    onReact={react} onReport={report} flash={flash === m.id} />
                </ul>
              </li>
            );
          })}
        </ol>
        {unseen > 0 && (
          <button type="button" onClick={toBottom}
            className="absolute bottom-[86px] left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-cream shadow-md">
            {unseen} new {unseen === 1 ? "message" : "messages"} ↓
          </button>
        )}

        <form onSubmit={send} className="flex flex-col gap-1.5 border-t border-line bg-parchment px-3 py-2.5">
          {replyTo && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted">
              <span className="truncate">↪ Replying to <b className="text-ink">{replyTo.mine ? "yourself" : replyTo.name}</b>: {replyTo.spoiler ? "(spoiler)" : replyTo.body}</span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel the reply" className={`${LINK} ml-auto text-base leading-none text-muted hover:text-ink`}>×</button>
            </div>
          )}
          {error && <p role="alert" className="m-0 px-1 text-sm text-rust-dark">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea ref={box} value={text} onChange={(e) => write(e.target.value)} maxLength={MAX_LEN} rows={1} dir="auto"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
                if (e.key === "Escape") setReplyTo(null);
              }}
              placeholder={replyTo ? "Write a reply…" : canPin ? "Share something with your readers…" : "Write a message…"}
              aria-label="Your message" className="field max-h-32 w-full min-w-0 flex-1 resize-none bg-cream text-[15px] [field-sizing:content]" />
            <button disabled={busy || !text.trim()} className="btn btn-primary h-[44px] shrink-0 px-4 text-sm sm:px-5">{busy ? "…" : "Send"}</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tools box={box} value={text} setValue={write} spoiler={spoiler} setSpoiler={setSpoiler} myName={data.me.name} alias={alias} setAlias={setAlias} />
            <span className="text-[11px] text-muted">{text.length >= SHOW_COUNT_FROM ? `${text.length}/${MAX_LEN}` : <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>}</span>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- The section ----------

// Spoilers: Blur | Hide | Show - for the reviews and the discussion together
function SpoilerControl({ mode, onChange, count }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="flex items-center gap-1"><span aria-hidden="true">🙈</span>Spoilers</span>
      <div role="radiogroup" aria-label="Spoilers" className="flex rounded-md border border-line-strong bg-cream p-0.5">
        {SPOILER_MODES.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => onChange(v)}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${mode === v ? "bg-rust-soft text-rust-dark" : "bg-transparent text-ink-soft hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {mode === "hide" && count > 0 && <span className="text-xs">{count} hidden</span>}
    </div>
  );
}

export default function BookSocial({ bookId, myRating, onRate, onData, preview = null }) {
  const [data, setData] = useState(preview); // preview: sample data for a design check, never in the app
  const [spoilers, setSpoilers] = useState("blur");
  useEffect(() => { try { const m = localStorage.getItem(SPOILERS_KEY); if (m === "hide" || m === "show") setSpoilers(m); } catch {} }, []); // eslint-disable-line react-hooks/set-state-in-effect
  const chooseSpoilers = (m) => { setSpoilers(m); try { localStorage.setItem(SPOILERS_KEY, m); } catch {} };
  const [error, setError] = useState(null);

  const load = useCallback(() => (preview ? Promise.resolve() : api(`/api/social/books/${bookId}`).then((d) => { setData(d); onData?.(d); }).catch((e) => setError(e.message))), [bookId, preview, onData]);
  useEffect(() => { load(); }, [load]);
  // live: look for new messages / reviews every few seconds, only while the page is in front
  useEffect(() => {
    if (preview) return;
    const check = () => api(`/api/social/books/${bookId}`).then((d) => { setData(d); onData?.(d); }).catch(() => {}); // a missed check is no error
    const timer = setInterval(() => { if (document.visibilityState === "visible") check(); }, LIVE_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [bookId, onData, preview]);

  if (error) return <p role="alert" className="text-rust-dark">Could not load what readers say: {error}</p>;
  if (!data) return null;

  return (
    <section id="readers" aria-labelledby="readers-title" className="card scroll-mt-28 flex flex-col gap-8 rounded-md p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="readers-title" className="m-0 font-serif text-[34px] font-semibold leading-none">Readers on this book</h2>
        <SpoilerControl mode={spoilers} onChange={chooseSpoilers}
          count={data.reviews.filter((r) => r.spoiler && !r.mine).length + asChannel(data.posts).filter((m) => m.spoiler && !m.mine).length} />
      </div>
      <SpoilerMode.Provider value={spoilers}>
        <Reviews data={data} bookId={bookId} myRating={myRating} onRate={onRate} reload={load} preview={preview} />
        <div className="h-px bg-line" aria-hidden="true" />
        <Discussion data={data} bookId={bookId} reload={load} preview={preview} />
      </SpoilerMode.Provider>
    </section>
  );
}
