import { createClient } from "@/lib/supabase/server";

/**
 * Server-side admin check. Every admin surface calls this — the hidden UI is
 * only cosmetic, and the RLS policies on the admin tables are the last line of
 * defence. Reads public.profiles.role, which only an admin can change.
 */
export async function isCurrentUserAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[ugnay] Could not read the caller's role:", error);
    return false;
  }
  return data?.role === "admin";
}
