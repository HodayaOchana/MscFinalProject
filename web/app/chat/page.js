import AppShell from "@/components/AppShell";
import ChatBox from "@/components/chat/ChatBox";
import "leaflet/dist/leaflet.css"; // the library map under the answers (components/chat/LibraryMap.js)

export const metadata = { title: "Ask BookBridge - BookBridge" };

// AI model 2: the LLM + RAG chatbot (server/chat.js)
export default function ChatPage() {
  return (
    <AppShell width="max-w-[1200px]">
      <ChatBox />
    </AppShell>
  );
}
