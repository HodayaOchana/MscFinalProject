"use client";

// Top bar for signed-in pages: logo, main menu, account
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { api } from "@/lib/api";
import { AVATAR_EVENT } from "@/lib/avatar";
import { BellIcon, HomeIcon, SearchIcon, BooksIcon, ChartIcon, BookmarkIcon } from "./Icons";
import Logo from "./Logo";
import ChatLauncher from "./ChatLauncher";

const LINKS = [
  { href: "/for-you", label: "For you", short: "For you", icon: <HomeIcon /> },
  { href: "/search", label: "Search", short: "Search", icon: <SearchIcon /> },
  { href: "/shelf", label: "My shelf", short: "Shelf", icon: <BooksIcon /> },
  { href: "/insights", label: "Reading journal", short: "Journal", icon: <ChartIcon /> },
];

// The fixed bar at the top of the screen: see-through until the page scrolls
export function TopBar({ children }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => setScrolled(window.scrollY > 24);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  return <header className={`topbar flex items-center justify-between gap-6 px-6 py-3.5 md:px-10 ${scrolled ? "is-scrolled" : ""}`}>{children}</header>;
}

// Admins only (the project mail): a bell with the number of book claims and reported reviews /
// messages waiting for the team (author requests are confirmed by the publisher, not by us).
// It opens the reports when there are any, else the authors page.
// Asked when a page opens, every minute, and right after an approve / reject
// (the admin page sends the "bb-admin-changed" event). A regular reader is asked once.
let notAdminUser = null; // the signed-in user we already know is not an admin (checked again after a switch of account)
function AdminBell({ path, userId }) {
  const [pending, setPending] = useState(null); // null = not an admin (or not known yet) - show nothing
  const [reports, setReports] = useState(0);
  const [publishers, setPublishers] = useState(0); // authors whose publisher is not on the list yet
  useEffect(() => {
    if (!userId || notAdminUser === userId) return;
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      api("/api/admin/summary")
        .then((s) => {
          if (!alive) return;
          if (!s.admin) { notAdminUser = userId; setPending(null); return; }
          setPending((s.pendingBookClaims ?? 0) + (s.openReports ?? 0) + (s.pendingPublisherRequests ?? 0));
          setReports(s.openReports ?? 0);
          setPublishers(s.pendingPublisherRequests ?? 0);
        })
        .catch(() => {}); // the bell is optional - never disturb the page
    };
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("bb-admin-changed", check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("bb-admin-changed", check); };
  }, [path, userId]);
  if (pending === null) return null;
  const claims = pending - reports - publishers;
  const label = pending
    ? [claims && `${claims} book ${claims === 1 ? "claim" : "claims"}`, reports && `${reports} ${reports === 1 ? "report" : "reports"}`,
      publishers && `${publishers} ${publishers === 1 ? "publisher" : "publishers"} to check`].filter(Boolean).join(", ") + " waiting for you"
    : "Nothing waiting for the team";
  // the bell opens the page with the most urgent work: reports, then publishers, then claims
  const href = reports ? "/admin/reports" : publishers ? "/admin/publishers" : "/admin/author-requests";
  return (
    <Link href={href} aria-label={label} title={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink no-underline hover:bg-sand hover:text-rust">
      <BellIcon />
      {pending > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 text-[11px] font-bold leading-none text-cream">
          {pending > 9 ? "9+" : pending}
        </span>
      )}
    </Link>
  );
}

// The bookmarks: how many books wait on the TBR. Saving a book anywhere flies its
// cover here (lib/basket.js), and the number follows.
function Basket({ path }) {
  const [count, setCount] = useState(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    api("/api/me/shelf").then((s) => setCount(s.saved.length)).catch(() => {}); // optional - never disturb the page
  }, [path]);
  useEffect(() => {
    const change = (e) => { setCount((n) => Math.max(0, (n ?? 0) + e.detail)); if (e.detail > 0) setBump((b) => b + 1); };
    window.addEventListener("bb-basket", change);
    return () => window.removeEventListener("bb-basket", change);
  }, []);
  const label = count ? `My bookmarks: ${count} book${count === 1 ? "" : "s"} to read` : "My bookmarks";
  return (
    <Link href="/shelf" id="reading-basket" aria-label={label} title={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink no-underline hover:bg-sand hover:text-rust">
      <span key={bump} className={bump ? "basket-bump" : ""}><span className="[&_svg]:h-[22px] [&_svg]:w-[22px]"><BookmarkIcon /></span></span>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 text-[11px] font-bold leading-none text-cream">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

// The signed-in user's own picture (GET /api/me/avatar), kept for this tab and this user;
// a change on the Account page arrives as an event
const cache = { user: null, image: null };
function useMyAvatar(userId) {
  const [image, setImage] = useState(cache.user === userId ? cache.image : null);
  useEffect(() => {
    const changed = (e) => { cache.user = userId; cache.image = e.detail || null; setImage(cache.image); };
    window.addEventListener(AVATAR_EVENT, changed);
    if (!userId) setImage(null); // eslint-disable-line react-hooks/set-state-in-effect
    else if (cache.user !== userId) {
      api("/api/me/avatar").then((r) => { cache.user = userId; cache.image = r.image || null; setImage(cache.image); }).catch(() => {});
    } else setImage(cache.image);
    return () => window.removeEventListener(AVATAR_EVENT, changed);
  }, [userId]);
  return image;
}

// Authors: readers' questions not answered yet (GET /api/me/author/questions) - a badge on the account circle.
// Checked when the page changes; a reader always gets 0.
function useOpenQuestions(userId, path) {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    api("/api/me/author/questions").then((q) => alive && setOpen(q.open || 0)).catch(() => {});
    return () => { alive = false; };
  }, [userId, path]);
  return userId ? open : 0;
}

export default function Header() {
  const path = usePathname();
  const { data: session } = authClient.useSession();
  const initial = (session?.user?.name || "R").trim().charAt(0).toUpperCase();
  const avatar = useMyAvatar(session?.user?.id || null);
  const questions = useOpenQuestions(session?.user?.id || null, path);
  const isActive = (l) => path === l.href || path.startsWith(l.href + "/");
  return (
    <>
      <TopBar>
        <div className="flex min-w-0 items-center gap-8">
          <Logo href="/for-you" />
          <nav aria-label="Main" className="hidden gap-1 text-[15px] lg:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined}
                className={`px-3 py-2 font-serif text-[18px] no-underline transition-colors ${isActive(l) ? "font-semibold text-rust" : "text-ink-soft hover:text-rust"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <AdminBell path={path} userId={session?.user?.id || null} />
          <Basket path={path} />
          <Link href={questions ? "/account#author" : "/account"} aria-label={questions ? `My account – ${questions} reader question${questions === 1 ? "" : "s"} to answer` : "My account"}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-moss font-bold text-cream no-underline transition-transform hover:scale-105 hover:text-cream motion-reduce:transform-none">
            <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" className="h-full w-full object-cover" />
                : initial}
            </span>
            {questions > 0 && (
              <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 text-[11px] font-bold leading-none text-cream ring-2 ring-paper">
                {questions > 9 ? "9+" : questions}
              </span>
            )}
          </Link>
        </div>
      </TopBar>
      <ChatLauncher />
      <nav aria-label="Main" className="tabbar fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-line bg-cream/95 backdrop-blur-md lg:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium no-underline ${isActive(l) ? "text-rust" : "text-muted hover:text-ink"}`}>
            {l.icon}{l.short}
          </Link>
        ))}
      </nav>
    </>
  );
}
