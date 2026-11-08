// The season around the greeting: a small candle, and a few leaves and snowflakes drifting
// down behind it. Decoration only (styles in globals.css; still if the user asked for less motion).
const FALL = [
  { x: 42, delay: 0, time: 13, kind: "leaf", color: "#A2431F" },
  { x: 53, delay: 5, time: 16, kind: "snow" },
  { x: 62, delay: 2, time: 12, kind: "leaf", color: "#C58A2E" },
  { x: 70, delay: 8, time: 17, kind: "snow" },
  { x: 77, delay: 4, time: 14, kind: "leaf", color: "#7C2F24" },
  { x: 85, delay: 10, time: 15, kind: "snow" },
  { x: 91, delay: 6, time: 13, kind: "leaf", color: "#5E5A2B" },
  { x: 97, delay: 1, time: 18, kind: "snow" },
];

export function Drift() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {FALL.map((f, i) => (
        <span key={i} className="drift" style={{ left: `${f.x}%`, animationDelay: `${f.delay - 16}s`, animationDuration: `${f.time}s` }}>
          {f.kind === "leaf"
            ? <svg width="15" height="15" viewBox="0 0 24 24"><path d="M12 2C6 6 4 11 6 17c1.5 3.5 4 5 6 5s4.5-1.5 6-5c2-6 0-11-6-15z" fill={f.color} /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B89F7E" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17" /></svg>}
        </span>
      ))}
    </div>
  );
}

export function Candle() {
  return (
    <svg aria-hidden="true" width="26" height="42" viewBox="0 0 26 42" className="flex-none">
      <circle className="candle-glow" cx="13" cy="10" r="12" fill="#F2B457" opacity=".3" />
      <path className="candle-flame" d="M13 2c3 4 5 6.500 5 9.500a5 5 0 0 1-10 0C8 8.500 10 6 13 2z" fill="#E8922E" />
      <path className="candle-flame" d="M13 7c1.300 1.800 2.200 3 2.200 4.500a2.200 2.200 0 0 1-4.400 0C10.800 10 11.700 8.800 13 7z" fill="#FBD98A" />
      <path d="M13 15v3" stroke="#2E1D14" strokeWidth="1.200" />
      <rect x="7" y="18" width="12" height="20" rx="2" fill="#F6E7CB" stroke="#D6BE98" />
      <rect x="4" y="37" width="18" height="3.500" rx="1.700" fill="#A2431F" />
    </svg>
  );
}
