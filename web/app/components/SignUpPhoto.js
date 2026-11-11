"use client";

// Sign-up: an optional profile picture. It is NOT sent with the form (the account doesn't
// exist yet) - it waits in this browser tab and is saved on the first signed-in page
// (components/PendingAvatar.js).
import { useEffect, useState } from "react";
import { AvatarPicker } from "@/components/Avatar";
import { pendingAvatar } from "@/lib/avatar";

export function SignUpPhoto() {
  const [image, setImage] = useState(null);
  useEffect(() => { setImage(pendingAvatar.get()); }, []); // eslint-disable-line react-hooks/set-state-in-effect -- after hydration (the server has no browser storage)
  const pick = (d) => { pendingAvatar.set(d); setImage(d); };
  return (
    <div className="flex items-center gap-4">
      <AvatarPicker image={image} name="+" size={64} onPick={pick} onRemove={() => pick(null)} label="Add a profile picture" />
      <div className="flex flex-col text-sm">
        <span className="font-medium">Profile picture</span>
        <span className="text-muted">Optional – you can add or change it later.</span>
      </div>
    </div>
  );
}
