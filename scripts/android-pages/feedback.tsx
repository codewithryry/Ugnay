"use client";

import ChatApp from "@/components/ChatApp";
import ClientUserGate from "@/components/ClientUserGate";

/** Android build variant: the session is resolved in the browser. */
export default function Page() {
  return <ClientUserGate>{(user) => <ChatApp {...user} view="feedback" />}</ClientUserGate>;
}
