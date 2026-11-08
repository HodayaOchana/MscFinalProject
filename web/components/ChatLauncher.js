"use client";

// The chat lives in its own round icon, apart from the menu, floating in the corner of every
// signed-in page; its name slides out on hover. On a book's page it opens the chat about that
// book. The chat page itself doesn't need it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon } from "./Icons";

export default function ChatLauncher() {
  const path = usePathname();
  if (path.startsWith("/chat")) return null;
  const book = path.match(/^\/books\/(\d+)/)?.[1];
  const label = book ? "Ask the librarian about this book" : "Ask the librarian";
  return (
    <Link href={book ? `/chat?book=${book}` : "/chat"} aria-label={label}
      className="chat-orb fixed bottom-20 right-5 z-40 flex h-14 min-w-14 items-center justify-center rounded-full bg-rust px-4 font-bold text-cream no-underline transition-transform hover:text-cream active:scale-95 motion-reduce:transform-none lg:bottom-6 lg:right-6 [&_svg]:h-6 [&_svg]:w-6">
      <ChatIcon /><span className="orb-label">{label}</span>
    </Link>
  );
}
