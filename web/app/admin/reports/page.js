import ReportsAdmin from "@/components/admin/ReportsAdmin";

export const metadata = { title: "Reports - BookBridge admin" };

// /admin/reports - the link in the "a reader reported…" email
export default function Page() {
  return <ReportsAdmin />;
}
