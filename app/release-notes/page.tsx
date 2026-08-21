import { redirect } from "next/navigation";
import ChatApp from "@/components/ChatApp";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Release notes" };

export default async function ReleaseNotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ChatApp {...user} view="release-notes" />;
}
