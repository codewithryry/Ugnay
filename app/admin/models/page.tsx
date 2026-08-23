import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** AI Models now lives in the unified dashboard; the old link still works. */
export default function AdminModelsPage() {
  redirect("/admin?section=models");
}
