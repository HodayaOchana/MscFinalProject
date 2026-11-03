"use client";

// The publisher's page: "Is <pen name> your author?" - Confirm / Decline.
// Opening the page decides nothing: only a button press does (mail scanners
// open links by themselves). Server: server/author-verification.js.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default function PublisherConfirm() {
  const token = useSearchParams().get("token") || "";
  const [req, setReq] = useState(null);
  const [error, setError] = useState(token ? null : "This link is missing its code. Please open the link from the email again.");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!token) return;
    api(`/api/publisher/request?token=${encodeURIComponent(token)}`, { auth: false }).then(setReq).catch((e) => setError(e.message));
  }, [token]);

  async function decide(decision) {
    setBusy(true);
    try {
      await api("/api/publisher/decision", { method: "POST", auth: false, body: { token, decision } });
      setDone(decision);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-10 bg-parchment px-6 py-12">
      <Logo href="/" />
      <main className="card flex w-full max-w-[560px] flex-col gap-5 p-8">
        {error && !done && (
          <>
            <h1 className="m-0 font-serif text-3xl font-semibold">This link can’t be used</h1>
            <p role="alert" className="m-0 text-ink-soft">{error}</p>
          </>
        )}
        {!error && !req && !done && <p className="m-0 text-muted">Loading…</p>}
        {req && !done && (
          <>
            <span className="eyebrow">Author confirmation</span>
            <h1 className="m-0 font-serif text-4xl font-semibold leading-tight">Is {req.penName} your author?</h1>
            <p className="m-0 text-ink-soft">
              A BookBridge reader, <strong>{req.accountName}</strong>, says they publish {req.publisherName ? <>with <strong>{req.publisherName}</strong></> : "with you"} under the name <strong>{req.penName}</strong>.
              If you confirm, their account gets an Author badge on their books and can add new books to BookBridge.
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">Books they listed</span>
              <p className="m-0 whitespace-pre-wrap break-words rounded-xl bg-cream px-4 py-3 text-[15px]">{req.books}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => decide("confirm")} className="btn btn-primary">Yes, this is our author</button>
              <button type="button" disabled={busy} onClick={() => decide("decline")} className="btn btn-outline">No, I don’t know them</button>
            </div>
            <p className="m-0 text-[13px] text-muted">This link works once, until {day(req.expiresAt)}. If you are not sure, you can simply ignore it.</p>
          </>
        )}
        {done === "confirm" && (
          <>
            <h1 className="m-0 font-serif text-3xl font-semibold">Thank you – confirmed</h1>
            <p className="m-0 text-ink-soft">{req?.penName} is now a verified author on BookBridge. You can close this page.</p>
          </>
        )}
        {done === "decline" && (
          <>
            <h1 className="m-0 font-serif text-3xl font-semibold">Thank you – declined</h1>
            <p className="m-0 text-ink-soft">The request was turned down, and the account did not become an author. You can close this page.</p>
          </>
        )}
      </main>
    </div>
  );
}
