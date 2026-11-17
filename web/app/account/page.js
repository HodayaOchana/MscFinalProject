"use client";

// "My account" - settings with a side menu (like GitHub's settings):
//   Profile   - name (editable), email, nearest library city (editable)
//   Reading   - favourite genres (editable), ratings, links to rate more / Insights
//   Author    - authors: their page and their books; readers: "Become an author"
//   Privacy   - research consent, the terms, how to delete the account
// The open section is in the address (#profile, #reading, #author, #privacy),
// so links like /account#author open the right one.
// Server: GET/PATCH /api/me, PUT /api/me/genres, GET/POST /api/me/consents,
//         the author part: components/AuthorSection.js. The name is kept by Neon Auth (authClient.updateUser).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authClient } from "@/lib/auth/client";
import { api, clearToken } from "@/lib/api";
import AppShell from "@/components/AppShell";
import AuthorSection from "@/components/AuthorSection";
import { CheckIcon } from "@/components/Icons";
import { sendCodeTo, verifyCodeFor } from "@/app/auth/email-actions";
import { codeAge, markCodeSent, resendWait } from "@/lib/verify-code";
import { AvatarPicker } from "@/components/Avatar";
import { announceAvatar } from "@/lib/avatar";

const SECTIONS = ["profile", "reading", "author", "privacy"];
const CITIES = ["Jerusalem", "Tel Aviv-Yafo"]; // the cities with library data (server: library/libraries-data.js)


// One settings card: a title, a line under it, the content
function Panel({ title, subtitle, children }) {
  return (
    <section className="card flex flex-col gap-5 p-6 text-[15px] md:p-8">
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <h2 className="m-0 font-serif text-3xl font-semibold">{title}</h2>
        {subtitle && <p className="m-0 text-ink-soft">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Saved({ show }) {
  return show ? <span role="status" className="flex items-center gap-1.5 text-sm text-moss"><CheckIcon /> Saved</span> : null;
}

// ---------- Email: shown, and verified with a code if it isn't yet ----------
const RESEND_SEC = 60;
const linkBtn = "cursor-pointer bg-transparent p-0 text-sm text-rust underline disabled:cursor-default disabled:text-muted disabled:no-underline";

function EmailBlock({ email, verified, onVerified }) {
  const [mode, setMode] = useState(null); // null | "verify"
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e.message || "Something went wrong – try again."); }
    finally { setBusy(false); }
  }
  // force = "Send a new code"; otherwise a code sent in the last 15 minutes is still good - just show the box
  const send = (force = false) => run(async () => {
    if (!force && codeAge(email) !== null) {
      setMode("verify"); setWait(resendWait(email));
      setNote(`Enter the code we already sent to ${email} (valid for 15 minutes).`);
      return;
    }
    const r = await sendCodeTo(email);
    if (r.error) throw new Error(r.error);
    markCodeSent(email);
    setMode("verify"); setCode(""); setWait(RESEND_SEC);
    setNote(`We sent a 6-digit code to ${email} (valid for 15 minutes).`);
  });
  // back on the page (a refresh) with a code still valid: the box is open again, nothing sent
  useEffect(() => {
    if (verified === false && codeAge(email) !== null) { setMode("verify"); setWait(resendWait(email)); } // eslint-disable-line react-hooks/set-state-in-effect
  }, [verified, email]);
  const verify = (e) => { e.preventDefault(); run(async () => {
    const r = await verifyCodeFor(email, code);
    if (r.error) throw new Error(r.error);
    try { sessionStorage.setItem("bb-email-verified", "1"); } catch {} // the pop-up won't ask again
    authClient.getSession({ query: { disableCookieCache: true } }).catch(() => {});
    setMode(null); setNote("Your email is verified."); onVerified();
  }); };
  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium">Email
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="field min-w-0 flex-1 truncate bg-parchment font-normal text-ink-soft">{email}</span>
        {verified !== null && (
          <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold ${verified ? "bg-moss-soft text-moss-dark" : "bg-sand text-ink-soft"}`}>
            {verified ? "✓ Verified" : "Not verified"}
          </span>
        )}
        {verified === false && mode !== "verify" && (
          <button type="button" disabled={busy} onClick={() => send()} className="btn btn-primary px-4 py-2 text-sm">{busy ? "Sending…" : "Verify"}</button>
        )}
      </div>
      {note && <span role="status" className="font-normal text-moss-dark">{note}</span>}
      <span className="font-normal text-muted">Your email is your sign-in and can’t be changed here.</span>

      {mode === "verify" && (
        <form onSubmit={verify} className="mt-1 flex flex-col gap-3 rounded-md bg-parchment p-4 font-normal">
          <label className="flex flex-col gap-1.5 text-sm font-medium">Code from the email
            <input value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="123456" className="field max-w-[220px] font-normal tracking-[0.3em]" />
          </label>
          {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <button disabled={busy || !code.trim()} className="btn btn-primary px-4 py-2 text-sm">{busy ? "Checking…" : "Verify email"}</button>
            <button type="button" disabled={busy || wait > 0} onClick={() => send(true)} className={linkBtn}>{wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}</button>
            <button type="button" onClick={() => { setMode(null); setError(null); }} className={`${linkBtn} text-ink-soft`}>Later</button>
          </div>
        </form>
      )}

    </div>
  );
}

// ---------- Profile ----------
function ProfilePanel({ me, verified, setVerified, onSaved }) {
  const [name, setName] = useState(me.name || "");
  const [city, setCity] = useState(me.preferredCity || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const changed = name.trim() !== (me.name || "") || city !== (me.preferredCity || "");

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      if (!name.trim()) throw new Error("Please enter your name.");
      if (name.trim() !== (me.name || "")) {
        const { error: err } = await authClient.updateUser({ name: name.trim() });
        if (err) throw new Error(err.message || "Could not change the name.");
      }
      if (city !== (me.preferredCity || "")) await api("/api/me", { method: "PATCH", body: { preferredCity: city || null } });
      setSaved(true);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Profile" subtitle="Your name is what other readers see next to your reviews and posts (first name and an initial).">
      <form onSubmit={save} className="flex max-w-[460px] flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm font-medium">Name
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required maxLength={100} autoComplete="name" className="field font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">Libraries near you
          <select value={city} onChange={(e) => { setCity(e.target.value); setSaved(false); }} className="field font-normal">
            <option value="">No city – I’ll choose each time</option>
            {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="font-normal text-muted">Used to show which recommended books are on the shelf near you.</span>
        </label>
        {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
        <div className="flex items-center gap-4">
          <button disabled={busy || !changed} className="btn btn-primary">{busy ? "Saving…" : "Update profile"}</button>
          <Saved show={saved && !changed} />
        </div>
      </form>
      <div className="max-w-[560px] border-t border-line pt-5">
        <EmailBlock email={me.email} verified={verified} onVerified={() => setVerified(true)} />
      </div>
      <dl className="m-0 grid max-w-[460px] grid-cols-[9rem_1fr] gap-y-2 border-t border-line pt-5 text-[15px]">
        <dt className="text-muted">Account type</dt><dd className="m-0 capitalize">{me.userType || "reader"}</dd>
      </dl>
    </Panel>
  );
}

// ---------- Reading ----------
function ReadingPanel({ me, onSaved }) {
  const [step, setStep] = useState(null); // the genre list (the questionnaire's step)
  const [picked, setPicked] = useState(me.genres || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api("/api/onboarding/questionnaire", { auth: false })
      .then((q) => setStep(q.steps.find((s) => s.id === "genres")))
      .catch((e) => setError(e.message));
  }, []);
  const max = 5;
  const changed = [...picked].sort().join() !== [...(me.genres || [])].sort().join();
  const toggle = (k) => { setSaved(false); setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= max ? p : [...p, k])); };

  async function save() {
    setBusy(true); setError(null);
    try {
      await api("/api/me/genres", { method: "PUT", body: { genres: picked } });
      setSaved(true);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Reading" subtitle="Your favourite genres shape the shelves on For You. Change them any time.">
      <div className="flex flex-col gap-4">
        <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.15em] text-muted">Favourite genres · up to {max}</h3>
        {!step && !error && <p className="m-0 text-muted">Loading…</p>}
        {step?.groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-2">
            <span className="text-sm text-ink-soft">{g.title}</span>
            <div className="flex flex-wrap gap-2">
              {step.options.filter((o) => o.group === g.id).map((o) => {
                const on = picked.includes(o.value);
                return (
                  <button key={o.value} type="button" aria-pressed={on} onClick={() => toggle(o.value)}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm transition-colors ${on ? "border-rust bg-rust text-cream" : "border-line-strong bg-cream text-ink hover:border-ink"}`}>
                    {on && <CheckIcon />}{o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
        <div className="flex items-center gap-4">
          <button type="button" onClick={save} disabled={busy || !changed || picked.length < 1} className="btn btn-primary">{busy ? "Saving…" : "Save genres"}</button>
          <span className="text-sm text-muted">{picked.length} of {max} selected</span>
          <Saved show={saved && !changed} />
        </div>
      </div>
      <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
        <Link href="/shelf#ratings" className="flex flex-col rounded-md bg-parchment px-4 py-3 text-ink no-underline hover:text-rust">
          <span className="font-serif text-3xl font-semibold">{me.ratingsCount}</span>
          <span className="text-sm text-ink-soft">books rated – see and change →</span>
        </Link>
        <Link href="/rate-more" className="flex flex-col justify-center rounded-md bg-parchment px-4 py-3 text-ink no-underline hover:text-rust">
          <span className="font-bold">Rate more books →</span><span className="text-sm text-ink-soft">Better picks for you</span>
        </Link>
        <Link href="/insights" className="flex flex-col justify-center rounded-md bg-parchment px-4 py-3 text-ink no-underline hover:text-rust">
          <span className="font-bold">Your Insights →</span><span className="text-sm text-ink-soft">Your reading, in numbers</span>
        </Link>
      </div>
    </Panel>
  );
}

// ---------- Privacy ----------
function PrivacyPanel() {
  const [consents, setConsents] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/api/me/consents").then(setConsents).catch(() => setConsents({})); }, []);
  // optional research consent - can be given or withdrawn at any time (saved as a new row)
  async function setResearch(granted) {
    setBusy(true);
    try {
      const r = await api("/api/me/consents", { method: "POST", body: { research: granted, source: "account" } });
      setConsents((c) => ({ ...c, current: r.current }));
    } finally { setBusy(false); }
  }
  const agreedOn = consents?.current?.terms?.at ? new Date(consents.current.terms.at).toLocaleDateString("en-GB") : null;
  return (
    <Panel title="Privacy" subtitle="What you agreed to, and what you can change.">
      {!consents ? <p className="m-0 text-muted">Loading…</p> : (
        <>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-rust)]" disabled={busy}
              checked={Boolean(consents.current?.research?.granted)} onChange={(e) => setResearch(e.target.checked)} />
            <span>Allow my ratings to be used, anonymized, in academic research on book recommendations. <span className="text-muted">Optional – the app works the same either way.</span></span>
          </label>
          <p className="m-0 text-ink-soft">
            {agreedOn ? `You agreed to the Terms of Use and the Privacy Policy on ${agreedOn}. ` : ""}
            Read them again: <Link href="/terms">Terms of Use</Link> · <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <div className="flex flex-col gap-1 border-t border-line pt-5">
            <h3 className="m-0 text-base font-bold">Your data</h3>
            <p className="m-0 text-ink-soft">To see, correct or delete your data, or delete your account, write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.</p>
          </div>
        </>
      )}
    </Panel>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [verified, setVerified] = useState(null);
  const [error, setError] = useState(null);
  const [section, setSection] = useState("profile");
  const [avatar, setAvatar] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const [admin, setAdmin] = useState(null); // the project team: links to the team pages
  const [openQuestions, setOpenQuestions] = useState(0); // authors: readers' questions not answered yet

  const load = () => api("/api/me").then(setMe).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/api/me/avatar").then((r) => setAvatar(r.image)).catch(() => {});
    api("/api/admin/summary").then((s) => s.admin && setAdmin(s)).catch(() => {});
    api("/api/me/author/questions").then((q) => setOpenQuestions(q.open || 0)).catch(() => {});
    authClient.getSession({ query: { disableCookieCache: true } }).then(({ data }) => setVerified(Boolean(data?.user?.emailVerified))).catch(() => {});
    const fromHash = window.location.hash.slice(1);
    if (SECTIONS.includes(fromHash)) setSection(fromHash); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  async function saveAvatar(image) {
    setAvatarBusy(true); setAvatarError(null);
    try {
      if (image) await api("/api/me/avatar", { method: "PUT", body: { image } });
      else await api("/api/me/avatar", { method: "DELETE" });
      setAvatar(image);
      announceAvatar(image); // the header shows it at once
    } catch (err) { setAvatarError(err.message); }
    finally { setAvatarBusy(false); }
  }

  function open(s) {
    setSection(s);
    window.history.replaceState(null, "", `#${s}`);
  }
  async function signOut() {
    await authClient.signOut();
    clearToken();
    router.push("/");
    router.refresh();
  }

  const isAuthor = me?.userType === "author";
  const nav = [
    { key: "profile", label: "Profile" },
    { key: "reading", label: "Reading" },
    ...(me?.userType !== "librarian" ? [{ key: "author", label: isAuthor ? "Your books" : "Become an author", badge: isAuthor ? openQuestions : 0 }] : []),
    { key: "privacy", label: "Privacy" },
  ];

  return (
    <AppShell width="max-w-[1080px]">
      <h1 className="m-0 font-serif text-5xl font-semibold">My account</h1>
      {error && <p className="mt-6 text-rust-dark">Could not load your profile: {error}</p>}
      {!me && !error && <p className="mt-6 text-muted">Loading...</p>}
      {me && (
        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-start">
          <aside className="flex shrink-0 flex-col gap-5 md:sticky md:top-28 md:w-[240px]">
            <div className="flex items-center gap-3">
              <AvatarPicker image={avatar} name={me.name} size={64} busy={avatarBusy} onPick={saveAvatar} onRemove={() => saveAvatar(null)} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{me.name}</span>
                <span className="truncate text-sm text-muted">{isAuthor ? "Author" : "Reader"}</span>
              </div>
            </div>
            {avatarError && <p role="alert" className="m-0 text-sm text-rust-dark">{avatarError}</p>}
            <nav aria-label="Account settings" className="-mx-1 flex gap-1 overflow-x-auto px-1 md:flex-col md:overflow-visible">
              {nav.map((n) => (
                <button key={n.key} type="button" onClick={() => open(n.key)} aria-current={section === n.key ? "page" : undefined}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-md border-l-[3px] px-3 py-2 text-left text-[15px] transition-colors ${section === n.key ? "border-rust bg-sand font-bold text-ink" : "border-transparent bg-transparent text-ink-soft hover:bg-parchment hover:text-ink"}`}>
                  <span className="flex items-center justify-between gap-2">{n.label}
                    {n.badge > 0 && <span title={`${n.badge} reader question${n.badge === 1 ? "" : "s"} to answer`} className="rounded-full bg-rust px-2 text-[11px] font-bold text-cream">{n.badge}</span>}
                  </span>
                </button>
              ))}
            </nav>
            {admin && (
              <div className="flex flex-col gap-1 border-t border-line pt-4">
                <span className="px-3 text-[12px] font-bold uppercase tracking-[0.15em] text-muted">Team</span>
                <Link href="/admin/author-requests" className="flex items-center justify-between rounded-md px-3 py-2 text-[15px] text-ink-soft no-underline hover:bg-parchment hover:text-ink">
                  Authors & claims {admin.pendingBookClaims > 0 && <span className="rounded-full bg-rust px-2 text-[11px] font-bold text-cream">{admin.pendingBookClaims}</span>}
                </Link>
                <Link href="/admin/publishers" className="flex items-center justify-between rounded-md px-3 py-2 text-[15px] text-ink-soft no-underline hover:bg-parchment hover:text-ink">
                  Publishers {admin.pendingPublisherRequests > 0 && <span className="rounded-full bg-rust px-2 text-[11px] font-bold text-cream">{admin.pendingPublisherRequests}</span>}
                </Link>
                <Link href="/admin/reports" className="flex items-center justify-between rounded-md px-3 py-2 text-[15px] text-ink-soft no-underline hover:bg-parchment hover:text-ink">
                  Reports {admin.openReports > 0 && <span className="rounded-full bg-rust px-2 text-[11px] font-bold text-cream">{admin.openReports}</span>}
                </Link>
              </div>
            )}
            <button onClick={signOut} className="btn btn-outline self-start px-4 py-2 text-sm">Sign out</button>
          </aside>

          <div className="min-w-0 flex-1">
            {section === "profile" && <ProfilePanel me={me} verified={verified} setVerified={setVerified} onSaved={load} />}
            {section === "reading" && <ReadingPanel me={me} onSaved={load} />}
            {section === "author" && me.userType !== "librarian" && <AuthorSection embedded />}
            {section === "privacy" && <PrivacyPanel />}
          </div>
        </div>
      )}
    </AppShell>
  );
}
