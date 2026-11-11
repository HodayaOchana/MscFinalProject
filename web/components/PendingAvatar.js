"use client";

// A photo chosen on the sign-up page is sent once the new account can talk to the API
// (the first signed-in page). Shows nothing.
import { useEffect } from "react";
import { api } from "@/lib/api";
import { announceAvatar, pendingAvatar } from "@/lib/avatar";

export default function PendingAvatar() {
  useEffect(() => {
    const image = pendingAvatar.get();
    if (!image) return;
    api("/api/me/avatar", { method: "PUT", body: { image } })
      .then(() => { pendingAvatar.set(null); announceAvatar(image); })
      .catch(() => {}); // tries again on the next page; the user can also add it on the Account page
  }, []);
  return null;
}
