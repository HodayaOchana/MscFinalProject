import ChatEvaluation from "@/components/chat/ChatEvaluation";

export const metadata = { title: "Rate the chatbot - BookBridge" };

// The human evaluation of AI model 2 (raters only - server/chat-eval-routes.js)
export default function EvaluatePage() {
  return <ChatEvaluation />;
}
