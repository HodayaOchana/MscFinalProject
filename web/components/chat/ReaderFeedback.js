"use client";

// Admin page: what readers tell us (team and raters only - server/chat-eval-routes.js, GET /api/chat-eval/feedback)
//   The librarian  - 👍 / 👎 on chat answers, why the 👎, and the latest missed answers
//   Not for me     - why readers hid a book from their picks
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";

const CHAT_REASON = { wrong_info: "Wrong or made-up info", not_my_taste: "Books not my taste", missed_question: "Didn't answer my question", too_long: "Too long", no_reason: "No reason given" };
const HIDE_REASON = { already_read: "Already read it", not_my_taste: "Not my kind of book", not_now: "Not right now", no_reason: "No reason given" };
const RANGES = [7, 30, 90];
const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);

// counts as thin bars - one series, so the heading names it and each row carries its number
function Counts({ rows, labels }) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return <p className="m-0 text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((r) => (
        <li key={r.reason} className="flex flex-col gap-1">
          <span className="flex justify-between gap-3 text-sm"><span>{labels[r.reason] || r.reason}</span><span className="font-bold tabular-nums">{r.n} · {pct(r.n, total)}%</span></span>
          <span className="block h-1.5 rounded-full bg-sand"><span className="block h-full rounded-full bg-rust" style={{ width: `${pct(r.n, total)}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-xs font-bold uppercase tracking-wider text-muted">{label}</span>
      <span className="font-serif text-3xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export default function ReaderFeedback() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api(`/api/chat-eval/feedback?days=${days}`).then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message));
  }, [days]);
  const c = data?.chat;
  const rated = c ? c.up + c.down : 0;

  return (
    <AppShell width="max-w-[900px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Evaluation</span>
          <h1 className="m-0 font-serif text-5xl font-semibold">Reader feedback</h1>
          <p className="m-0 text-ink-soft">What real readers tell us about the librarian’s answers and the books they hide. No names or emails. <Link href="/evaluate">Rate the chatbot →</Link></p>
        </div>
        <div role="group" aria-label="Period" className="flex gap-2">
          {RANGES.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`cursor-pointer rounded-md border px-4 py-2 text-sm ${days === d ? "border-ink bg-rust-soft text-rust-dark" : "border-line-strong bg-transparent text-ink hover:border-rust hover:text-rust"}`}>
              Last {d} days
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-rust-dark">{error.includes("raters only") ? "This page is for the BookBridge team and the evaluation raters only." : error}</p>}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && (
          <>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
              <Tile label="Answers" value={c.answers} />
              <Tile label="Rated" value={rated} hint={`${pct(rated, c.answers)}% of answers`} />
              <Tile label="👍 Helpful" value={`${pct(c.up, rated)}%`} hint={`${c.up} answers`} />
              <Tile label="👎 Missed" value={`${pct(c.down, rated)}%`} hint={`${c.down} answers`} />
              {data.speed?.firstMedian != null && <Tile label="First words" value={`${(data.speed.firstMedian / 1000).toFixed(1)} s`} hint={`median · 90% within ${(data.speed.firstP90 / 1000).toFixed(1)} s`} />}
              {data.speed?.totalMedian != null && <Tile label="Whole answer" value={`${(data.speed.totalMedian / 1000).toFixed(1)} s`} hint={`median · 90% within ${(data.speed.totalP90 / 1000).toFixed(1)} s`} />}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="card flex flex-col gap-3 p-5">
                <h2 className="m-0 font-serif text-xl font-semibold">Why answers missed</h2>
                <Counts rows={data.chatReasons} labels={CHAT_REASON} />
              </section>
              <section className="card flex flex-col gap-3 p-5">
                <h2 className="m-0 font-serif text-xl font-semibold">Why books were hidden</h2>
                <Counts rows={data.notForMe} labels={HIDE_REASON} />
              </section>
            </div>
            <section className="flex flex-col gap-3">
              <h2 className="m-0 font-serif text-2xl font-semibold">Latest missed answers</h2>
              {data.misses.length === 0 && <p className="m-0 text-sm text-muted">No 👎 in this period.</p>}
              {data.misses.map((m) => (
                <article key={`${m.conversationId}-${m.turn}`} className="card flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="rounded-md bg-rust-soft px-2 py-0.5 font-bold text-rust-dark">{CHAT_REASON[m.reason || "no_reason"]}</span>
                    <span>{when(m.at)}</span>
                    {m.model && <span>· {m.model}</span>}
                    {m.ms && <span>· {(m.ms / 1000).toFixed(1)} s</span>}
                  </div>
                  <p dir="auto" className="m-0 font-bold">“{m.question}”</p>
                  <p dir="auto" className="m-0 whitespace-pre-wrap text-sm text-ink-soft">{m.reply.replace(/\[\[book:\d+\]\]/g, "📖")}{m.reply.length >= 400 ? "…" : ""}</p>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
