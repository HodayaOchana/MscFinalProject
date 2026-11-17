import { Suspense } from "react";
import PublisherApply from "@/components/pages/PublisherApply";

export const metadata = { title: "Join the list of publishers - BookBridge", robots: { index: false } };

// /publisher/apply?token=... - the link in the email the team sends to a publisher that is not on
// the list yet (no login needed). Server: server/publishers.js (/api/publisher-apply).
export default function PublisherApplyPage() {
  return (
    <Suspense fallback={null}>
      <PublisherApply />
    </Suspense>
  );
}
