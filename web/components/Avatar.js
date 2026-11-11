"use client";

// The round profile picture - the photo if there is one, otherwise the initials.
//   <Avatar image={...} name="Suzanne Collins" size={56} />
//   <AvatarPicker image={...} name="..." onPick={(dataUrl) => ...} onRemove={...} busy />  - click to choose a photo
import { useRef, useState } from "react";
import { shrinkImage } from "@/lib/avatar";

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export default function Avatar({ image, name, size = 56, className = "" }) {
  return image
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={image} alt="" width={size} height={size} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
    : <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-rust font-serif font-semibold text-cream ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</span>;
}

export function AvatarPicker({ image, name, size = 56, onPick, onRemove, busy = false, label = "Change your profile picture" }) {
  const input = useRef(null);
  const [error, setError] = useState(null);
  async function picked(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (!file) return;
    setError(null);
    try { onPick(await shrinkImage(file)); } catch (err) { setError(err.message); }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label={label} title={label}
        className="group relative cursor-pointer rounded-full border-0 bg-transparent p-0 disabled:cursor-wait">
        <Avatar image={image} name={name} size={size} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/55 text-[11px] font-bold uppercase tracking-wide text-cream opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? "…" : image ? "Change" : "Add photo"}
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={picked} className="hidden" />
      {image && onRemove && <button type="button" onClick={onRemove} disabled={busy} className="cursor-pointer bg-transparent p-0 text-xs text-muted underline">Remove photo</button>}
      {error && <span role="alert" className="max-w-[220px] text-xs text-rust-dark">{error}</span>}
    </div>
  );
}
