"use client";

import ChatApp from "@/components/ChatApp";
import ClientUserGate from "@/components/ClientUserGate";
import GuestLanding from "@/components/GuestLanding";

/**
 * The Android build's chat entry point.
 *
 * Same behaviour as the server page it replaces — signed out gets the guest
 * landing, signed in gets the app — with the session resolved in the browser
 * because the exported bundle has no server to resolve it.
 */
export default function ChatPage() {
  return (
    <ClientUserGate signedOut={<GuestLanding />}>
      {(user) => <ChatApp {...user} />}
    </ClientUserGate>
  );
}
