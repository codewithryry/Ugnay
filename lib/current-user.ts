import { createClient } from "@/lib/supabase/server";
import { isMissingSession } from "@/lib/supabase/auth-errors";

export interface CurrentUserRecord {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** Preferred short name, if the user set one. */
  nickname: string | null;
  createdAt: string;
}

/**
 * Resolves the signed-in user and their profile row. Shared by every page that
 * renders the app shell. Returns null when there is no session so the caller
 * can redirect.
 */
export async function getCurrentUser(): Promise<CurrentUserRecord | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // No session is the normal state on the signed-out landing page, so only a
  // real failure is worth logging.
  if (userError && !isMissingSession(userError)) {
    console.error("[ugnay] Could not read the current user:", userError);
  }
  if (!user) return null;

  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, nickname, avatar_url, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) console.error("[ugnay] Could not load the profile:", profileError);

  // The auth trigger normally creates this row; self-heal for accounts that
  // predate it so the authenticated user still resolves to a profile.
  if (!profile) {
    const metadata = user.user_metadata ?? {};
    const { data: healed, error: healError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          display_name:
            (metadata.full_name as string) ??
            (metadata.name as string) ??
            user.email?.split("@")[0] ??
            null,
          avatar_url:
            (metadata.avatar_url as string) ?? (metadata.picture as string) ?? null,
        },
        { onConflict: "id" },
      )
      .select("display_name, nickname, avatar_url, email")
      .single();

    if (healError) console.error("[ugnay] Could not create the missing profile:", healError);
    profile = healed ?? profile;
  }

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? "",
    displayName: profile?.display_name ?? user.email?.split("@")[0] ?? "You",
    // An explicitly stored avatar wins; otherwise use the OAuth provider's.
    avatarUrl:
      profile?.avatar_url ??
      (user.user_metadata?.avatar_url as string) ??
      (user.user_metadata?.picture as string) ??
      null,
    nickname: profile?.nickname ?? null,
    createdAt: user.created_at,
  };
}
