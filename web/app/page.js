"use client";

// Landing page (public)
import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import Logo from "@/components/Logo";
import Header, { TopBar } from "@/components/Header";
import Cover from "@/components/Cover";
import BookPeek, { hasPeek } from "@/components/BookPeek";
import CoverWall, { catalogFavourites } from "@/components/CoverWall";
import { Drift } from "@/components/Seasonal";
import { PinIcon } from "@/components/Icons";

// Each mood is a set of the catalog's genres: the row shows that genre's well-known books.
const MOODS = [
  { label: "Can't put it down", genres: ["thriller", "mystery-crime"] },
  { label: "Another world", genres: ["fantasy", "science-fiction"] },
  { label: "Falling in love", genres: ["romance", "contemporary"] },
  { label: "Something true", genres: ["biography", "history-politics", "science-nature"] },
];
const STEPS = [
  { n: "1", title: "Pick 3–5 genres", body: "Fantasy, mystery, memoir – whatever you reach for first." },
  { n: "2", title: "Rate a few books", body: "Twenty well-known titles. Skip the ones you have not read." },
  { n: "3", title: "Get ten picks", body: "Right away, with a reason for each – and sharper as you rate." },
];
const FAQ = [
  ["How does BookBridge choose books?", "It blends three things: what readers with taste like yours loved, books similar to the ones you rated, and favourites in your genres. Every pick shows the reason it was chosen."],
  ["Can the librarian make up books?", "No. Our librarian answers only with real books from our catalog, and nothing changes on your shelf until you confirm it."],
  ["Is the library availability real?", "Not yet. It covers Jerusalem and Tel Aviv-Yafo and the inventory is simulated for the demo, so check with the library before you go."],
  ["What happens to my data?", <>Your ratings and searches are used to improve your picks. The details are in the <Link href="/privacy">Privacy Policy</Link>.</>],
];

export default function Home() {
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const start = signedIn
    ? <Link href="/for-you" className="btn btn-primary">Go to your picks</Link>
    : <Link href="/auth/sign-up" className="btn btn-primary">Start the 2-minute quiz</Link>;
  return (
    <div className="min-h-full">
      {/* signed in: the same menu as everywhere in the app; guests: sign in / create account */}
      {signedIn ? <Header /> : (
        <TopBar>
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link href="/auth/sign-in" className="px-3 py-2 font-medium text-ink no-underline hover:text-rust">Sign in</Link>
            <Link href="/auth/sign-up" className="btn btn-dark !px-4 !py-2 text-sm">Create account</Link>
          </nav>
        </TopBar>
      )}

      <section className="relative isolate mx-auto grid max-w-[1400px] items-center gap-10 px-6 pb-10 pt-24 md:grid-cols-2 md:px-10 md:pt-28">
        <Drift />
        <div className="flex flex-col items-start gap-5">
          <h1 className="m-0 font-serif text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Find the book that feels written for <em className="font-medium text-rust">you</em>.
          </h1>
          <p className="m-0 max-w-[560px] text-lg leading-relaxed text-ink-soft">
            Tell us what you love. BookBridge learns your taste from readers like you, shows why each book was picked, and where you can borrow it nearby.
          </p>
          <div className="flex flex-wrap gap-3">
            {start}
            {!signedIn && <Link href="/auth/sign-in" className="btn btn-outline">I have an account</Link>}
          </div>
        </div>
        <div className="relative h-[300px] overflow-hidden rounded-lg bg-sand md:h-[400px]"><CoverWall rows={3} /></div>
      </section>

      <MoodPicker />

      <div className="mx-auto flex max-w-[1180px] flex-col gap-24 px-6 py-20 md:gap-28 md:px-10">
        <Feature title="Picked for your taste" visual={<ReasonsVisual />}>
          Readers with taste like yours, books like the ones you love, and favourites in your genres – blended into ten picks, each with its reason.
        </Feature>
        <Feature title="On a shelf near you" flip visual={<LibraryVisual />}>
          Turn on “near me” to see which picks are waiting at a library close by – Jerusalem and Tel Aviv-Yafo for now.
        </Feature>
        <Feature title="Just ask" visual={<ChatVisual />}>
          “Something like Dune, but shorter.” Describe the book you want and refine it in conversation – only real books from our catalog.
        </Feature>
      </div>

      <section className="reveal border-y border-line bg-cream">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-10 px-6 py-20 md:px-10">
          <h2 className="m-0 font-serif text-4xl font-semibold tracking-tight md:text-5xl">How it works</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex items-start gap-4">
                <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-rust-soft font-serif text-xl font-bold text-rust-dark">{s.n}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="m-0 text-[19px] font-bold">{s.title}</h3>
                  <p className="m-0 leading-relaxed text-ink-soft">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="reveal mx-auto flex max-w-[820px] flex-col gap-6 px-6 py-20 md:px-10">
        <h2 className="m-0 font-serif text-4xl font-semibold tracking-tight md:text-5xl">Questions, answered</h2>
        <div className="flex flex-col gap-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq rounded-md bg-cream transition-colors hover:bg-sand">
              <summary className="flex items-center justify-between gap-4 px-5 py-4 text-lg font-semibold">
                {q}<span aria-hidden="true" className="plus text-2xl font-normal leading-none text-rust">+</span>
              </summary>
              <p className="m-0 px-5 pb-5 leading-relaxed text-ink-soft">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="reveal mx-auto flex max-w-[860px] flex-col items-center gap-5 px-6 pb-24 pt-6 text-center md:px-10">
        <p className="m-0 font-serif text-3xl font-bold leading-tight tracking-tight md:text-4xl">
          In tests with 2,000 readers, more than a quarter of our top-ten picks were books they went on to love.
        </p>
        <span className="text-sm text-muted">Offline evaluation on the goodbooks-10k dataset · Precision@10 = 27%</span>
        <Link href={signedIn ? "/for-you" : "/auth/sign-up"} className="btn btn-primary mt-2">Find my next book</Link>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-4 px-6 py-8 text-sm text-muted md:px-10">
          <span>BookBridge · MSc graduation project</span>
          <span>Library availability is simulated for the demo · <Link href="/terms">Terms of Use</Link> · <Link href="/privacy">Privacy Policy</Link></span>
        </div>
      </footer>
    </div>
  );
}

// Choose a mood, and a row of well-known books from those genres slides in
function MoodPicker() {
  const [mood, setMood] = useState(0);
  const [found, setFound] = useState({}); // mood number -> its books
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (found[mood]) return;
    let alive = true;
    catalogFavourites(MOODS[mood].genres)
      .then((books) => { if (alive) { setFound((f) => ({ ...f, [mood]: books.slice(0, 12) })); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [mood, found]);
  const books = found[mood];
  return (
    <section aria-labelledby="mood-title" className="reveal mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-6 md:px-10">
      <h2 id="mood-title" className="m-0 font-serif text-3xl font-semibold tracking-tight md:text-4xl">What are you in the mood for?</h2>
      <div role="group" aria-label="Moods" className="flex flex-wrap gap-2">
        {MOODS.map((m, i) => (
          <button key={m.label} type="button" aria-pressed={i === mood} onClick={() => setMood(i)}
            className={`cursor-pointer rounded-md px-4 py-2 text-[15px] font-semibold transition-[transform,background-color,color] hover:-translate-y-0.5 active:scale-95 motion-reduce:transform-none ${i === mood ? "bg-rust text-cream" : "bg-sand text-ink hover:bg-line-strong"}`}>
            {m.label}
          </button>
        ))}
      </div>
      {failed && <p className="m-0 text-muted">Could not reach the catalog right now – please try again in a moment.</p>}
      <div key={mood} aria-live="polite" className="shelf-scroll -mx-6 flex min-h-[270px] snap-x gap-4 overflow-x-auto scroll-px-6 px-6 pb-3 pt-3 md:-mx-10 md:scroll-px-10 md:px-10">
        {(books || []).map((b, i) => (
          <Link key={b.id} href={`/books/${b.id}`} aria-describedby={hasPeek(b) ? `peek-${b.id}` : undefined}
            className="swap-in group book-w relative snap-start hover:z-20 focus-visible:z-20" style={{ animationDelay: `${i * 50}ms` }}>
            <Cover book={b} />
            <BookPeek book={b} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function Feature({ title, flip = false, visual, children }) {
  return (
    <section className="reveal grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={`flex flex-col gap-4 ${flip ? "md:order-2" : ""}`}>
        <h2 className="m-0 font-serif text-4xl font-semibold tracking-tight md:text-5xl">{title}</h2>
        <p className="m-0 text-lg leading-relaxed text-ink-soft md:text-xl">{children}</p>
      </div>
      <div aria-hidden="true" className="flex min-h-[260px] flex-col justify-center gap-3 rounded-lg border border-line bg-cream p-7 md:p-10">{visual}</div>
    </section>
  );
}

// The three small pictures are drawings of the site's own pieces, not real data
function ReasonsVisual() {
  return (
    <>
      <span className="self-start rounded-md bg-moss-soft px-3 py-2 text-moss-dark">Readers with taste like yours loved it</span>
      <span className="self-center rounded-md bg-parchment px-3 py-2 text-ink-soft">Similar to books you rated highly</span>
      <span className="self-end rounded-md bg-rust-soft px-3 py-2 text-rust-dark">A favourite in a genre you chose</span>
    </>
  );
}
function LibraryVisual() {
  return ["A branch in Jerusalem", "A branch in Tel Aviv-Yafo"].map((name, i) => (
    <div key={name} className="flex items-center gap-3 rounded-md bg-parchment px-4 py-3.5">
      <span className="text-moss-dark"><PinIcon /></span>
      <span className="flex-1 font-semibold">{name}</span>
      <span className="text-sm text-moss-dark">{i ? "1 copy" : "2 copies"} on the shelf</span>
    </div>
  ));
}
function ChatVisual() {
  return (
    <>
      <div className="max-w-[85%] self-end rounded-md bg-rust-soft px-4 py-3 text-ink">Something like Dune, but shorter.</div>
      <div className="max-w-[85%] self-start rounded-md bg-parchment px-4 py-3 text-ink-soft">Happy to help. Do you want the politics, or the desert?</div>
    </>
  );
}
