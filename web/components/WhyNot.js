"use client";

// After "Not for me" (✕ on a book card): a small slip at the bottom asks why - optional, one tap.
// It stays 12 s (paused while the mouse is on it). (It used the 3.5 s .toast fade before - too fast.)
//   Already read it      -> "How was it?" stars (a real rating - the engine learns from it)
//   Not my kind of book  -> noted
//   Not right now        -> noted
// The reason goes on the dismissed event (POST /api/me/events/reason); the team sees the
// totals on /admin/feedback. Opened by window event "bb-dismissed" { id, title } (RecCard).
import { useCallback, useEffect, useRef, useState } from "react";
import Stars from "./Stars";
import { XIcon } from "./Icons";
import { api } from "@/lib/api";

const REASONS = [["already_read", "Already read it"], ["not_my_taste", "Not my kind of book"], ["not_now", "Not right now"]];
const OPEN_MS = 12000; // closes by itself if left alone
const DONE_MS = 2600;

export default function WhyNot() {
  const [book, setBook] = useState(null); // { id, title }
  const [step, setStep] = useState("ask"); // ask | rate | done
  const [note, setNote] = useState("");
  const timer = useRef(null);
  const closeIn = useCallback((ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => setBook(null), ms); }, []);

  useEffect(() => {
    const onHide = (e) => { setBook(e.detail); setStep("ask"); setNote(""); closeIn(OPEN_MS); };
    window.addEventListener("bb-dismissed", onHide);
    return () => { window.removeEventListener("bb-dismissed", onHide); clearTimeout(timer.current); };
  }, [closeIn]);

  function done(text) { setNote(text); setStep("done"); closeIn(DONE_MS); }
  function because(reason) {
    api("/api/me/events/reason", { method: "POST", body: { bookId: book.id, reason } }).catch(() => {}); // only an extra
    if (reason === "already_read") { setStep("rate"); closeIn(OPEN_MS); }
    else done(reason === "not_now" ? "Got it – maybe another time." : "Got it – fewer books like this.");
  }
  async function rate(n) {
    try {
      await api("/api/me/ratings", { method: "POST", body: { bookId: book.id, rating: n } });
      done(`Rated ${n}★ – your picks will use it.`);
    } catch { done("Couldn't save the rating – try it on the book's page."); }
  }

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
      {book && (
        <div key={book.id} role="dialog" aria-label="Why not for you?"
          onMouseEnter={() => step !== "done" && clearTimeout(timer.current)} onMouseLeave={() => step !== "done" && closeIn(OPEN_MS / 2)}
          className="fresh-in pointer-events-auto flex max-w-[460px] flex-col gap-2.5 rounded-md border border-line-strong bg-cream px-5 py-3.5 text-sm text-ink shadow-[0_12px_30px_rgba(60,35,15,0.3)]">
          <div className="flex items-start gap-3">
            <p className="m-0 flex-1 leading-snug">
              {step === "done" ? note : step === "rate"
                ? <>How was <em className="font-serif text-[15px]">{book.title}</em>?</>
                : <>Hidden – we won&apos;t suggest <em className="font-serif text-[15px]">{book.title}</em> again. <span className="text-ink-soft">Why not?</span></>}
            </p>
            <button type="button" onClick={() => setBook(null)} aria-label="Close"
              className="-mr-2 -mt-1 flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sand hover:text-ink"><XIcon /></button>
          </div>
          {step === "ask" && (
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => because(k)}
                  className="cursor-pointer rounded-md border border-line-strong bg-parchment px-3 py-1.5 text-[13px] text-ink hover:border-rust hover:text-rust-dark">{label}</button>
              ))}
            </div>
          )}
          {step === "rate" && <Stars value={0} onChange={rate} size={24} label={`Rate ${book.title}`} />}
        </div>
      )}
    </div>
  );
}
