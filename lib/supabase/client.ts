"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (cached) return cached;
  const { url, key } = supabaseEnv();
  cached = createBrowserClient(url, key);
  return cached;
}
