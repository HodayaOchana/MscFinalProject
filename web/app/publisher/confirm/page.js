import { Suspense } from "react";
import PublisherConfirm from "@/components/pages/PublisherConfirm";

export const metadata = { title: "Confirm an author - BookBridge", robots: { index: false } };

// /publisher/confirm?token=... - the link in the email to the publisher (no login needed)
export default function PublisherConfirmPage() {
  return (
    <Suspense fallback={null}>
      <PublisherConfirm />
    </Suspense>
  );
}
