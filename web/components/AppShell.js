import Header from "./Header";
import ConsentGate from "./ConsentGate";
import Bookworm from "./Bookworm";
import WhyNot from "./WhyNot";
import VerifyEmailGate from "./VerifyEmailGate";
import PendingAvatar from "./PendingAvatar";

// Layout for signed-in pages: the top bar + a centered content column
export default function AppShell({ children, width = "max-w-[1200px]" }) {
  return (
    <div className="min-h-full">
      <ConsentGate />
      <Header />
      <VerifyEmailGate />
      <PendingAvatar />
      <Bookworm />
      <WhyNot />
      <main className={`mx-auto w-full ${width} px-6 pb-20 pt-24 md:px-10`}>{children}</main>
    </div>
  );
}
