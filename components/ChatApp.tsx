"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatWindow from "./ChatWindow";
import SearchOverlay from "./SearchOverlay";
import SettingsPanel from "./SettingsPanel";
import Sidebar from "./Sidebar";
import { applyTheme } from "@/lib/theme";
import { useChatStore } from "@/store/chatStore";

export interface CurrentUser {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** Preferred short name, if the user set one. */
  nickname: string | null;
  /** Supabase auth account creation timestamp. */
  createdAt: string;
}

export default function ChatApp(props: {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  nickname: string | null;
  createdAt: string;
  /** Which surface fills the main area. Defaults to the chat window. */
  view?: "chat" | "search";
}) {
  const init = useChatStore((s) => s.init);
  const hydrated = useChatStore((s) => s.hydrated);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const streaming = useChatStore((s) => s.streaming);
  const notifyOnFinish = useChatStore((s) => s.settings?.notify_on_finish ?? false);
  const wasStreaming = useRef(false);
  const theme = useChatStore((s) => s.settings?.theme ?? "dark");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedChat = searchParams.get("chat");

  useEffect(() => {
    void init(props.userId);
  }, [init, props.userId]);

  // A shared link (/?chat=<id>) opens that conversation once the store is ready.
  useEffect(() => {
    if (!hydrated || !requestedChat) return;
    const { chats, activeChatId, setActiveChat } = useChatStore.getState();
    if (activeChatId !== requestedChat && chats.some((c) => c.id === requestedChat)) {
      void setActiveChat(requestedChat);
    }
  }, [hydrated, requestedChat]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  // Notify once a reply completes, when the tab is not in the foreground.
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || !notifyOnFinish) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    new Notification("Ugnay", { body: "Your reply is ready." });
  }, [streaming, notifyOnFinish]);

  // Escape closes the mobile sidebar; Cmd/Ctrl+K opens a fresh chat.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useChatStore.getState().newChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarOpen]);

  const user: CurrentUser = {
    userId: props.userId,
    email: props.email,
    displayName: props.displayName,
    avatarUrl: props.avatarUrl,
    nickname: props.nickname,
    createdAt: props.createdAt,
  };

  return (
    <div className="flex h-full h-[100dvh] w-full overflow-hidden bg-ink-950">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        user={user}
        onOpenSettings={() => setSettingsOpen(true)}
        activeNav={props.view ?? "chat"}
      />

      <ChatWindow user={user} hydrated={hydrated} />

      {/* /search keeps the chat behind it, like a command palette. */}
      {props.view === "search" && <SearchOverlay onClose={() => router.push("/")} />}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} user={user} />
    </div>
  );
}
