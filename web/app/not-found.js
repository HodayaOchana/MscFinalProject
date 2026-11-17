// Any address the site doesn't have (e.g. /nothing-here)
import NotFoundView from "@/components/NotFoundView";

export const metadata = { title: "Not found - BookBridge" };

export default function NotFound() {
  return <main className="min-h-screen bg-paper"><NotFoundView /></main>;
}
