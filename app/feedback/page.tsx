import { redirect } from "next/navigation";
import FeedbackForm from "@/components/FeedbackForm";
import HelpPageShell from "@/components/HelpPageShell";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  // Feedback is stored against the account that sent it, so a session is required.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <HelpPageShell
      title="Send feedback"
      description="Tell us what is working, what is broken, and what you wish Ugnay did. Every submission is read."
    >
      <FeedbackForm />
    </HelpPageShell>
  );
}
