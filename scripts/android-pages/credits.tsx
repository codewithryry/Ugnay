"use client";

import ClientUserGate from "@/components/ClientUserGate";
import CreditsStore from "@/components/CreditsStore";

/** Android build variant of the credits store. Signed-in only, as on the web. */
export default function CreditsPage() {
  return <ClientUserGate>{() => <CreditsStore />}</ClientUserGate>;
}
