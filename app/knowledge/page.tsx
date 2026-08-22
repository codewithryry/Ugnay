import { redirect } from "next/navigation";
import ChatApp from "@/components/ChatApp";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge" };

export default async function KnowledgePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ChatApp {...user} view="knowledge" />;
}
