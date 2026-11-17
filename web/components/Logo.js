import Link from "next/link";
import Leaf from "./Leaf";

export default function Logo({ href = "/" }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink no-underline hover:text-ink">
      <Leaf size={26} />
      <span className="font-serif text-[26px] font-semibold tracking-tight">BookBridge</span>
    </Link>
  );
}
