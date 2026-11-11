// "Not found" - for a book / series / author that does not exist, and for any unknown address
// (app/not-found.js). Plain links, so it works signed in or not.
import Link from "next/link";

export default function NotFoundView({ what = "page", detail }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-6 py-20 text-center">
      <span aria-hidden="true" className="font-serif text-7xl text-line-strong">404</span>
      <h1 className="m-0 font-serif text-4xl font-semibold">We couldn’t find this {what}</h1>
      <p className="m-0 text-ink-soft">{detail || "The link may be old, or the address has a typo."}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/for-you" className="btn btn-primary">Back to For You</Link>
        <Link href="/search" className="btn btn-outline">Search books</Link>
      </div>
    </div>
  );
}
