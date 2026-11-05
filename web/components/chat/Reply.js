/**
 * A chatbot answer as text: paragraphs, bold headings, lists, and [[book:ID]] markers
 * as links to the book. Used by the chat (ChatBox) and the evaluation page (/evaluate).
 *
 *   <Reply text={answer} books={new Map([[id, { id, title }]])} />
 */

import { Fragment } from "react";
import Link from "next/link";

// **bold** and *italic* inside a line, and [[book:ID]] -> the book's title as a link
export function Inline({ text, books }) {
  const parts = text.split(/(\[\[book:\d+\]\]|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((part, i) => {
    const book = part.match(/^\[\[book:(\d+)\]\]$/);
    if (book) {
      const b = books.get(Number(book[1]));
      return b ? <bdi key={i}><Link href={`/books/${b.id}`} className="font-bold text-ink underline decoration-line-strong underline-offset-2 hover:text-rust">{b.title}</Link></bdi> : null;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}><Inline text={part.slice(2, -2)} books={books} /></strong>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// Paragraphs, bold headings on their own line, and simple lists ("- ", "* ", "1. ").
// (The server already removed titles the model wrote next to a book's marker.)
export default function Reply({ text, books }) {
  const blocks = [];
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last?.type === "list") last.items.push(item[1]);
      else blocks.push({ type: "list", items: [item[1]] });
    } else if (/^\s*\*\*[^*]+\*\*:?\s*$/.test(line)) {
      blocks.push({ type: "h", text: line.trim().replace(/^\*\*|\*\*:?$/g, "") });
    } else if (line.trim()) {
      if (last?.type === "p" && !last.closed) last.lines.push(line.trim());
      else blocks.push({ type: "p", lines: [line.trim()] });
    } else if (last) {
      last.closed = true;
    }
  }
  return blocks.map((b, i) => b.type === "list" ? (
    <ul key={i} className="m-0 flex list-disc flex-col gap-1.5 ps-5 marker:text-rust">
      {b.items.map((t, j) => <li key={j}><Inline text={t} books={books} /></li>)}
    </ul>
  ) : b.type === "h" ? (
    <h3 key={i} className="m-0 mt-1 text-[15px] font-bold text-ink">{b.text}</h3>
  ) : (
    <p key={i} className="m-0"><Inline text={b.lines.join(" ")} books={books} /></p>
  ));
}
