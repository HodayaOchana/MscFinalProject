// The reading basket's small celebrations. All decoration: they never block anything,
// and they stay still if the user asked for less motion in the system settings.
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A book was saved: its cover flies into the basket in the top bar, and the number goes up
export function addedToBasket(coverImage) {
  window.dispatchEvent(new CustomEvent("bb-basket", { detail: 1 }));
  const target = document.getElementById("reading-basket");
  if (!coverImage || !target || still()) return;
  const a = coverImage.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ghost = coverImage.cloneNode();
  Object.assign(ghost.style, { position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, borderRadius: "8px", zIndex: 70, pointerEvents: "none", objectFit: "cover" });
  ghost.alt = "";
  document.body.append(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  ghost.animate(
    [{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.6}px, ${dy * 0.7}px) scale(.5) rotate(-8deg)`, opacity: 1, offset: 0.6 }, { transform: `translate(${dx}px, ${dy}px) scale(.08) rotate(-14deg)`, opacity: 0.3 }],
    { duration: 650, easing: "cubic-bezier(.4,0,.2,1)" }
  ).onfinish = () => ghost.remove();
}

export function leftBasket() {
  window.dispatchEvent(new CustomEvent("bb-basket", { detail: -1 }));
}

// A book was finished: a handful of autumn leaves falls from where it was
const LEAVES = ["#A2431F", "#C58A2E", "#7C2F24", "#5E5A2B", "#C9874E"];
export function leafBurst(x, y) {
  if (still()) return;
  for (let i = 0; i < 12; i++) {
    const leaf = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    leaf.setAttribute("viewBox", "0 0 24 24");
    leaf.innerHTML = `<path d="M12 2C6 6 4 11 6 17c1.5 3.5 4 5 6 5s4.5-1.5 6-5c2-6 0-11-6-15z" fill="${LEAVES[i % LEAVES.length]}"/>`;
    Object.assign(leaf.style, { position: "fixed", left: `${x}px`, top: `${y}px`, width: "20px", height: "20px", zIndex: 70, pointerEvents: "none" });
    document.body.append(leaf);
    const dx = (Math.random() - 0.5) * 260;
    leaf.animate(
      [{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.6}px, ${-50 - Math.random() * 70}px) rotate(${Math.random() * 180}deg)`, opacity: 1, offset: 0.3 }, { transform: `translate(${dx}px, ${160 + Math.random() * 120}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0 }],
      { duration: 1300 + Math.random() * 500, easing: "ease-out" }
    ).onfinish = () => leaf.remove();
  }
}
