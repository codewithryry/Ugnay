import { redirect } from "next/navigation";
import CreditsStore from "@/components/CreditsStore";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buy credits" };

/** The credits store. Signed-in only: an order belongs to an account. */
export default async function CreditsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <CreditsStore />;
}
