import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
import { isCurrentUserAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

/**
 * Admin-only. A normal account gets the ordinary not-found page, so the
 * surface is not even advertised; every API behind it re-checks the role.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await isCurrentUserAdmin())) notFound();

  return (
    <Suspense>
      <AdminDashboard />
    </Suspense>
  );
}
