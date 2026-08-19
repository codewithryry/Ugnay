import { redirect } from "next/navigation";
import ChatApp from "@/components/ChatApp";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ChatApp {...user} />;
}
