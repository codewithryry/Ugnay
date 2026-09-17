"use client";

import ChatApp from "@/components/ChatApp";
import ClientUserGate from "@/components/ClientUserGate";
import ReleaseNotesView from "@/components/ReleaseNotesView";

/**
 * Android build variant. Mirrors the web page: the notes read standalone when
 * signed out rather than sending the reader to sign in.
 */
export default function ReleaseNotesPage() {
  return (
    <ClientUserGate signedOut={<ReleaseNotesView standalone />}>
      {(user) => <ChatApp {...user} view="release-notes" />}
    </ClientUserGate>
  );
}
