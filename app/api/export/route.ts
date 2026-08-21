import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZip, slugify, type ZipEntry } from "@/lib/zip";
import type { Chat, Message, UserSettings } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads every conversation belonging to the caller as a single .zip:
 * one Markdown file per chat, plus a JSON export and a readable index.
 *
 * Scoping is the authenticated user's own id — RLS enforces it a second time,
 * so another user's chats can never appear here.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/export could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const [chatsRes, messagesRes, settingsRes] = await Promise.all([
    supabase
      .from("chats")
      .select("*")
      .eq("user_id", user.id)
      // The hidden temporary chat is stored server-side but is not part of
      // the visible history, so the archive skips it as well.
      .eq("is_temporary", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("messages")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  if (chatsRes.error || messagesRes.error) {
    console.error("[ugnay] /api/export could not read the account data:", {
      chats: chatsRes.error,
      messages: messagesRes.error,
    });
    return NextResponse.json({ error: "Could not read your data. Please try again." }, { status: 500 });
  }

  const chats = (chatsRes.data ?? []) as Chat[];
  const messages = (messagesRes.data ?? []) as Message[];
  const settings = (settingsRes.data ?? null) as UserSettings | null;

  const byChat = new Map<string, Message[]>();
  for (const message of messages) {
    const list = byChat.get(message.chat_id) ?? [];
    list.push(message);
    byChat.set(message.chat_id, list);
  }

  const exportedAt = new Date();
  const entries: ZipEntry[] = [];
  const used = new Set<string>();

  const index: string[] = [
    "# Ugnay export",
    "",
    `- Account: ${user.email ?? user.id}`,
    `- Exported: ${exportedAt.toISOString()}`,
    `- Conversations: ${chats.length}`,
    `- Messages: ${messages.length}`,
    "",
    "| Conversation | Messages | Created | Last activity | File |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const chat of chats) {
    const thread = byChat.get(chat.id) ?? [];

    // Prefix with the id so two chats with the same title cannot collide.
    let name = `conversations/${slugify(chat.title)}-${chat.id.slice(0, 8)}.md`;
    while (used.has(name)) name = `conversations/${slugify(chat.title)}-${chat.id}.md`;
    used.add(name);

    const lines = [
      `# ${chat.title}`,
      "",
      `- Chat id: ${chat.id}`,
      `- Model: ${chat.provider} / ${chat.model}`,
      `- Created: ${chat.created_at}`,
      `- Last activity: ${chat.updated_at}`,
      `- Messages: ${thread.length}`,
    ];
    if (chat.system_prompt) lines.push("", "## Instructions for this chat", "", chat.system_prompt);
    lines.push("", "---", "");

    for (const message of thread) {
      const who = message.role === "user" ? "You" : message.role === "assistant" ? "Ugnay" : "System";
      const meta = message.model ? ` · ${message.model}` : "";
      lines.push(`### ${who} — ${message.created_at}${meta}`, "", message.content, "");
    }

    entries.push({ name, content: lines.join("\n") });
    index.push(
      `| ${chat.title.replace(/\|/g, "\\|")} | ${thread.length} | ${chat.created_at} | ${chat.updated_at} | ${name} |`,
    );
  }

  if (chats.length === 0) index.push("| _no conversations yet_ | 0 | | | |");

  entries.push({ name: "README.md", content: index.join("\n") });
  entries.push({
    name: "ugnay-export.json",
    content: JSON.stringify(
      {
        exported_at: exportedAt.toISOString(),
        user: { id: user.id, email: user.email ?? null, created_at: user.created_at },
        settings,
        chats: chats.map((chat) => ({ ...chat, messages: byChat.get(chat.id) ?? [] })),
      },
      null,
      2,
    ),
  });

  const zip = createZip(entries, exportedAt);
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  const stamp = exportedAt.toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ugnay-export-${stamp}.zip"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
