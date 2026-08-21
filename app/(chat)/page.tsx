import ChatApp from "@/components/ChatApp";
import GuestLanding from "@/components/GuestLanding";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  // A signed-out visitor gets a usable New Chat rather than the sign-in page.
  // Every other route still redirects; only this entry point changed.
  if (!user) return <GuestLanding />;

  return <ChatApp {...user} />;
}
