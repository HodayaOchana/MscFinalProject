"use client";

// How a pick fits this reader, in two small marks instead of sentences:
//   Warmth  - a flame and the match: the warmer the flame, the closer the match
//   WhyChip - the reader's OWN loved book behind the pick, as a tiny cover (or an icon when there
//             is none). Hover or tap it and a little bubble says why in words.
import { useState } from "react";
import Cover from "./Cover";
import { FlameIcon, PeopleIcon, OpenBookIcon, SparkIcon, StarIcon } from "./Icons";

const flameColor = (m) => (m >= 85 ? "text-rust" : m >= 65 ? "text-[#C9742F]" : "text-gold");

export function Warmth({ match }) {
  return (
    <span className="inline-flex items-center gap-1 text-[15px] font-bold text-ink" role="img" aria-label={`${match}% match for you`} title={`${match}% match for you`}>
      <span className={flameColor(match)}><FlameIcon /></span>{match}%
    </span>
  );
}

// the kind of reason, for picks without a book behind them
function whyIcon(why) {
  if (/readers (with|who)/i.test(why)) return <PeopleIcon />;
  if (/similar/i.test(why)) return <OpenBookIcon />;
  if (/favorite|loved by many|popular/i.test(why)) return <StarIcon />;
  return <SparkIcon />;
}

export function WhyChip({ why, book }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="why-host relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} aria-label={`Why this pick: ${why}`}
        className="flex cursor-pointer items-center gap-1 rounded-full bg-transparent p-0 text-rust transition-transform hover:scale-110 motion-reduce:transform-none">
        {book
          ? <span className="block w-[21px] rotate-[-5deg]"><Cover book={book} small className="!rounded-[2px] !shadow-[0_2px_5px_rgba(90,55,25,0.35)] [&_span]:hidden" /></span>
          : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sand">{whyIcon(why)}</span>}
      </button>
      <span dir="auto" aria-hidden="true" className="why-bubble" data-open={open ? "" : undefined}>{why}</span>
    </span>
  );
}
