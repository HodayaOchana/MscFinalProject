"use client";

// The human evaluation of the chatbot (proposal, section 3.2: "at least 4/5 on 50
// sample dialogues, rated by 3 raters"). Raters only - the server checks the signed-in
// email against ADMIN_EMAILS and RATER_EMAILS. Server: server/chat-eval-routes.js;
// the dialogues are made by server/eval-dialogues.js.
//   Rate     - one dialogue at a time: what the reader wrote, the chatbot's answers
//              (shown as in the chat), a 1-5 score and an optional comment. Saving moves
//              on to the next dialogue you did not rate yet.
//   Results  - per model: the average, dialogues rated by 3 raters, the goal (4/5).
// Raters do not see which model answered (a blind rating).
import { Fragment, useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import Reply from "./Reply";
import { api } from "@/lib/api";

const SCORES = [
  [5, "Excellent", "Fits the request, accurate, clear and natural - I would act on it."],
  [4, "Good", "Helpful and correct, with small issues."],
  [3, "OK", "Partly helpful - a clear problem (an off pick, too long, a missed request)."],
  [2, "Poor", "Mostly unhelpful, or ignores what the reader asked."],
  [1, "Bad", "Wrong, made-up, unsafe or off-topic."],
];
const CRITERIA = [
  ["Relevance", "Do the books and the answer fit what the reader asked, including later refinements?"],
  ["Accuracy", "Only books from the catalog, facts that are true (pages, availability), nothing invented."],
  ["Clarity", "Short, easy to scan, says why each book fits."],
  ["Tone", "Warm and natural, like a good librarian - not a search engine."],
  ["Limits", "Declines politely what it should not do, and asks when the request is unclear."],
];
const KIND = {
  discover: "Finding a book", refine: "Narrowing down", "about-book": "About one book",
  "near-me": "Libraries & location", "small-talk": "Small talk", edge: "Tricky request",
};

const asBook = (b) => ({ id: b.id, title: b.title, authors: b.author ? [b.author] : [], thumbnail_url: b.thumbnail });

function Dialogue({ d }) {
  return (
    <div className="flex flex-col gap-5">
      {d.turns.map((t, i) => {
        const books = new Map(t.books.map((b) => [b.id, b]));
        return (
          <div key={i} className="flex flex-col gap-3">
            <div className="flex flex-col items-end gap-1">
              {(t.location || t.aboutBook) && (
                <span className="text-xs text-muted">
                  {t.aboutBook ? <>Asked from the page of <em>{t.aboutBook}</em></> : "Location shared"}
                </span>
              )}
              <p dir="auto" className="m-0 max-w-[85%] rounded-2xl rounded-ee-sm bg-ink px-4 py-2.5 text-parchment">{t.message}</p>
            </div>
            <div className="card flex flex-col gap-3 px-5 py-4 text-[15px] leading-relaxed">
              <Reply text={t.reply} books={books} />
              {t.books.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pt-1">
                  {t.books.map((b) => (
                    <a key={b.id} href={`/books/${b.id}`} target="_blank" rel="noreferrer" title={b.title} className="w-14 flex-none">
                      <Cover book={asBook(b)} small />
                    </a>
                  ))}
                </div>
              )}
              {t.followUps?.length > 0 && (
                <p className="m-0 text-sm text-muted">Suggested next questions: {t.followUps.join(" · ")}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Rating({ d, onSaved }) {
  const [score, setScore] = useState(d.score || null);
  const [comment, setComment] = useState(d.comment || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await api(`/api/chat-eval/dialogues/${d.id}/rating`, { method: "PUT", body: { score, comment } });
      onSaved(r);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return (
    <div className="card flex flex-col gap-4 p-5">
      <h2 className="m-0 font-serif text-xl font-semibold">Your score</h2>
      <div role="radiogroup" aria-label="Score" className="grid grid-cols-5 gap-2">
        {SCORES.slice().reverse().map(([n, label, help]) => (
          <button key={n} type="button" role="radio" aria-checked={score === n} title={help} onClick={() => setScore(n)}
            className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border py-2.5 transition-colors ${score === n ? "border-rust bg-rust text-cream" : "border-line-strong bg-parchment text-ink hover:border-rust"}`}>
            <span className="font-serif text-2xl font-semibold leading-none">{n}</span>
            <span className="text-xs">{label}</span>
          </button>
        ))}
      </div>
      {score && <p className="m-0 text-sm text-ink-soft">{SCORES.find(([n]) => n === score)[2]}</p>}
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2}
        placeholder="What was wrong or good? (optional - most useful for scores of 3 or less)" className="field resize-y" />
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <button type="button" disabled={!score || busy} onClick={save} className="btn btn-primary self-start disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Saving…" : d.score ? "Update and go to the next" : "Save and go to the next"}
      </button>
    </div>
  );
}

function Rubric() {
  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-bold">How to score</summary>
      <p className="mb-2 mt-3 text-sm text-ink-soft">Read the whole dialogue as if you were the reader. Consider:</p>
      <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
        {CRITERIA.map(([k, v]) => <Fragment key={k}><dt className="font-bold">{k}</dt><dd className="m-0 text-ink-soft">{v}</dd></Fragment>)}
      </dl>
      <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-sm">
        {SCORES.map(([n, label, help]) => <li key={n}><strong>{n} – {label}:</strong> <span className="text-ink-soft">{help}</span></li>)}
      </ul>
      <p className="mb-0 mt-3 text-sm text-muted">Click a book to open its page in a new tab and check the facts. Library availability is simulated data.</p>
    </details>
  );
}

function Results() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api("/api/chat-eval/summary").then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p role="alert" className="text-rust-dark">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  if (!data.models.length) return <p className="text-muted">No dialogues yet - run <code>node server/eval-dialogues.js</code>.</p>;
  const { goal } = data;
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-ink-soft">
        The goal (proposal 3.2): an average of at least <strong>{goal.score}/5</strong> on <strong>{goal.dialogues}</strong> dialogues, each rated by <strong>{goal.raters}</strong> raters. Raters so far: <strong>{data.raters}</strong>.
      </p>
      {data.models.map((m) => {
        const met = m.average !== null && m.average >= goal.score && m.fullyRated >= goal.dialogues;
        return (
          <article key={m.model} className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 font-serif text-xl font-semibold">{m.model}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${met ? "bg-moss-soft text-moss-dark" : "bg-sand text-[#5E4A2A]"}`}>
                {met ? "goal met" : m.fullyRated < goal.dialogues ? "in progress" : "below goal"}
              </span>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Average", m.average ?? "–"],
                ["Fully rated", `${m.fullyRated} / ${m.dialogues}`],
                [`Dialogues ≥ ${goal.score}`, `${m.atLeastGoal}`],
                ["Raters agree", m.agreement === null ? "–" : `${Math.round(m.agreement * 100)}%`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="m-0 font-serif text-3xl font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="m-0 mb-2 text-sm font-bold">By kind of request</h3>
              <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 text-sm sm:grid-cols-2">
                {Object.entries(m.byKind).map(([k, v]) => <li key={k} className="flex justify-between gap-3 border-b border-line py-1"><span>{KIND[k] || k}</span><strong>{v ?? "–"}</strong></li>)}
              </ul>
            </div>
            {m.lowest.length > 0 && (
              <p className="m-0 text-sm text-ink-soft">Lowest: {m.lowest.map((l) => `#${l.id} (${KIND[l.kind] || l.kind}, ${l.average})`).join(", ")}</p>
            )}
            <p className="m-0 text-xs text-muted">“Raters agree” = dialogues whose scores are at most 1 apart, of those rated by {goal.raters}.</p>
          </article>
        );
      })}
    </div>
  );
}

export default function ChatEvaluation() {
  const [tab, setTab] = useState("rate");
  const [dialogues, setDialogues] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState(null);
  const [signedInAs, setSignedInAs] = useState(null);

  const load = useCallback(() => {
    api("/api/chat-eval/dialogues").then((rows) => {
      setDialogues(rows);
      setIndex(Math.max(0, rows.findIndex((d) => !d.score)));
      setError(null);
    }).catch((e) => {
      setError(e.message);
      if (e.message.includes("raters only")) api("/api/me").then((m) => setSignedInAs(m.email)).catch(() => {});
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const done = dialogues?.filter((d) => d.score).length || 0;
  const d = dialogues?.[index];
  function saved(r) {
    const next = dialogues.map((x) => (x.id === r.id ? { ...x, score: r.score, comment: r.comment } : x));
    setDialogues(next);
    const after = next.findIndex((x, i) => i > index && !x.score);
    const any = next.findIndex((x) => !x.score);
    setIndex(after >= 0 ? after : any >= 0 ? any : index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <AppShell width="max-w-[820px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Evaluation</span>
          <h1 className="m-0 font-serif text-5xl font-semibold">Rate the chatbot</h1>
          <p className="m-0 text-ink-soft">Score each sample conversation with BookBridge’s reading assistant from 1 to 5. You can change a score any time.</p>
        </div>
        <div role="tablist" aria-label="Evaluation sections" className="flex flex-wrap gap-2">
          {[["rate", "Rate"], ["results", "Results"]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${tab === k ? "border-ink bg-ink text-parchment" : "border-line-strong bg-transparent text-ink hover:border-rust hover:text-rust"}`}>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-rust-dark">
            {error.includes("raters only")
              ? <>This page is for the evaluation raters only. {signedInAs ? <>You are signed in as <strong>{signedInAs}</strong> – ask the team to add this email to the raters.</> : "Sign in with the account the team added as a rater."}</>
              : error}
          </p>
        )}
        {!error && tab === "results" && <Results />}
        {!error && tab === "rate" && !dialogues && <p className="text-muted">Loading…</p>}
        {!error && tab === "rate" && dialogues?.length === 0 && <p className="text-muted">No dialogues yet - the team runs <code>node server/eval-dialogues.js</code> first.</p>}
        {!error && tab === "rate" && d && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span><strong>{done}</strong> of {dialogues.length} rated</span>
                {done === dialogues.length && <span className="font-bold text-moss-dark">All done – thank you!</span>}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sand" aria-hidden="true">
                <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${(done / dialogues.length) * 100}%` }} />
              </div>
            </div>
            <Rubric />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="btn btn-outline disabled:opacity-40">← Previous</button>
              <span className="text-sm text-ink-soft">
                Dialogue <strong>{index + 1}</strong> of {dialogues.length} · {KIND[d.kind] || d.kind}
                {d.score ? <> · your score <strong>{d.score}</strong></> : ""}
              </span>
              <button type="button" disabled={index === dialogues.length - 1} onClick={() => setIndex(index + 1)} className="btn btn-outline ms-auto disabled:opacity-40">Next →</button>
            </div>
            <Dialogue d={d} />
            <Rating key={d.id} d={d} onSaved={saved} />
          </>
        )}
      </div>
    </AppShell>
  );
}
