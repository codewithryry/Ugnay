import { redirect } from "next/navigation";
import ChatApp from "@/components/ChatApp";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback" };

/**
 * Feedback is a modal, not a page. This route stays so existing links keep
 * working: it opens the app with the modal already up.
 */
export default async function FeedbackPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ChatApp {...user} view="feedback" />;
}
