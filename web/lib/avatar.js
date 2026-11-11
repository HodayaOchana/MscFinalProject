// Profile pictures in the browser: shrink a chosen photo to a small square JPEG before it is sent
// (server/avatar.js accepts up to 80 KB), and keep the one chosen at sign-up until the account exists.

const SIZE = 256;
const PENDING = "bb-pending-avatar"; // chosen on the sign-up page, sent after the first sign-in

/** A File (from <input type="file">) -> "data:image/jpeg;base64,..." 256x256, cropped to the centre */
export async function shrinkImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Please choose a picture (JPEG, PNG or WebP).");
  if (file.size > 15 * 1024 * 1024) throw new Error("That picture is very large – please choose one under 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that picture."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // a transparent PNG gets a white background, not black
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    for (const q of [0.85, 0.75, 0.6, 0.45]) { // smaller until it fits
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length * 0.75 < 75 * 1024) return data;
    }
    throw new Error("Could not make the picture small enough – please try another one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const pendingAvatar = {
  get: () => { try { return sessionStorage.getItem(PENDING); } catch { return null; } },
  set: (d) => { try { d ? sessionStorage.setItem(PENDING, d) : sessionStorage.removeItem(PENDING); } catch {} },
};

/** "/api/avatars/12?v=..." from the API -> a full address for <img src> */
export const avatarSrc = (path) => (path ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${path}` : null);

/** Tell the header (and anything else showing it) that the user's own picture changed */
export const AVATAR_EVENT = "bb-avatar";
export const announceAvatar = (image) => { try { window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: image })); } catch {} };

/** A book cover File -> "data:image/jpeg;base64,..." about 400 px wide (the shape kept), under 65 KB */
export async function shrinkCover(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Please choose a picture (JPEG, PNG or WebP).");
  if (file.size > 15 * 1024 * 1024) throw new Error("That picture is very large – please choose one under 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that picture."));
      i.src = url;
    });
    const scale = Math.min(1, 400 / img.naturalWidth, 640 / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    for (const q of [0.85, 0.75, 0.6, 0.45, 0.35]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length * 0.75 < 65 * 1024) return data;
    }
    throw new Error("Could not make the picture small enough – please try another one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
