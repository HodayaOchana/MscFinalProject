"use client";

// A book cover: a picture from the computer, or a link to one. Shows a preview.
//   <CoverField value={{ image?, url? }} onChange={(v) => ...} />
// The picture is shrunk in the browser (lib/avatar.js shrinkCover) before it is sent.
import { useRef, useState } from "react";
import { shrinkCover } from "@/lib/avatar";

export default function CoverField({ value = {}, onChange, current }) {
  const [mode, setMode] = useState(value.url ? "link" : "file");
  const [error, setError] = useState(null);
  const input = useRef(null);
  const preview = value.image || value.url || current || null;

  async function picked(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try { onChange({ image: await shrinkCover(file) }); } catch (err) { setError(err.message); }
  }

  return (
    <div className="flex gap-4">
      <div className="flex h-[120px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-parchment text-center text-[11px] text-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="" className="h-full w-full object-cover" onError={() => setError("That link doesn’t open as a picture.")} /> : "Designed cover"}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div role="radiogroup" aria-label="Cover from" className="flex gap-2 text-sm">
          {[["file", "Upload a picture"], ["link", "Link to a picture"]].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setError(null); }}
              className={`cursor-pointer rounded-md border px-3 py-1.5 ${mode === k ? "border-rust bg-rust text-cream" : "border-line-strong bg-cream text-ink"}`}>{label}</button>
          ))}
        </div>
        {mode === "file" ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => input.current?.click()} className="btn btn-outline px-4 py-2 text-sm">{value.image ? "Choose another" : "Choose a picture"}</button>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={picked} className="hidden" />
            <span className="text-xs text-muted">JPEG, PNG or WebP – we make it smaller for you.</span>
          </div>
        ) : (
          <input type="url" value={value.url || ""} onChange={(e) => { setError(null); onChange({ url: e.target.value }); }} maxLength={500}
            placeholder="https://…/cover.jpg" className="field font-normal" />
        )}
        {(value.image || value.url) && <button type="button" onClick={() => onChange({})} className="cursor-pointer self-start bg-transparent p-0 text-xs text-muted underline">No cover – use the designed one</button>}
        {error && <span role="alert" className="text-xs text-rust-dark">{error}</span>}
      </div>
    </div>
  );
}
