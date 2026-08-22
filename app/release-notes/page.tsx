import ChatApp from "@/components/ChatApp";
import ReleaseNotesView from "@/components/ReleaseNotesView";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Release notes" };

export default async function ReleaseNotesPage() {
  const user = await getCurrentUser();
  // The notes are static product copy, so a signed-out visitor reads them as a
  // standalone page rather than being sent to sign in. Signed in, they stay the
  // in-app surface beside the sidebar.
  if (!user) return <ReleaseNotesView standalone />;

  return <ChatApp {...user} view="release-notes" />;
}
