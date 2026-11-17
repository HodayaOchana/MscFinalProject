import ReaderFeedback from "@/components/chat/ReaderFeedback";

export const metadata = { title: "Reader feedback - BookBridge" };

// /evaluate/feedback - 👍 / 👎 on chat answers, speed and "Not for me" reasons, for the pilot
// (team and raters only - server/chat-eval-routes.js)
export default function Page() {
  return <ReaderFeedback />;
}
