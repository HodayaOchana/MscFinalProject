import PublishersAdmin from "@/components/admin/PublishersAdmin";

export const metadata = { title: "Publishers - BookBridge admin" };

// /admin/publishers - the link in the "an author's publisher is not on the list" email (?request=<id>)
export default function Page() {
  return <PublishersAdmin />;
}
