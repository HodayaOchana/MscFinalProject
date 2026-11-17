// A round wax seal with an uneven edge, as pressed wax has; whatever is inside is pressed into it.
// Used for the shelves on For You (ShelfGallery) and the "read" stamp on My shelf.
// The colours come from the CSS: --wax and --wax-edge (globals.css, .wax).
const EDGE = Array.from({ length: 48 }, (_, i) => {
  const t = (i / 48) * Math.PI * 2;
  const r = 46 + 2.2 * Math.sin(5 * t) + 1.3 * Math.sin(11 * t + 1);
  return `${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`;
}).join(" L");

export default function WaxSeal({ children, className = "" }) {
  return (
    <span className={`seal ${className}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path className="wax" d={`M${EDGE}Z`} />
        <circle className="press" cx="50" cy="50" r="34" />
      </svg>
      <span className="seal-icon">{children}</span>
    </span>
  );
}
