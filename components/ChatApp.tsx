"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatWindow from "./ChatWindow";
import SearchOverlay from "./SearchOverlay";
import SettingsPanel from "./SettingsPanel";
import WorkspacePanel from "./WorkspacePanel";
import FeedbackModal from "./FeedbackModal";
import UsageModal from "./UsageModal";
import ModelCompareView from "./ModelCompareView";
import ArtifactPanel from "./ArtifactPanel";
import ReleaseNotesView from "./ReleaseNotesView";
import WorkflowsView from "./WorkflowsView";
import KnowledgeView from "./KnowledgeView";
import Sidebar from "./Sidebar";
import { applyTheme } from "@/lib/theme";
import { DEFAULT_CHAT_TITLE } from "@/lib/utils";
import { TEMPORARY_CHAT_ID, useChatStore } from "@/store/chatStore";

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
  view?: "chat" | "search" | "release-notes" | "feedback" | "workflows" | "knowledge";
}) {
  const init = useChatStore((s) => s.init);
  const hydrated = useChatStore((s) => s.hydrated);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const [settingsOpen, setSettingsOpen] = useState(false);
  // /feedback opens the modal over the chat, the way /search opens its overlay.
  const [feedbackOpen, setFeedbackOpen] = useState(props.view === "feedback");
  const [usageOpen, setUsageOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const streaming = useChatStore((s) => s.streaming);
  const notifyOnFinish = useChatStore((s) => s.settings?.notify_on_finish ?? false);
  const wasStreaming = useRef(false);
  const theme = useChatStore((s) => s.settings?.theme ?? "dark");
  const activeChatId = useChatStore((s) => s.activeChatId);
  const activeChatTitle = useChatStore(
    (s) => s.chats.find((c) => c.id === s.activeChatId)?.title ?? null,
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedChat = searchParams.get("chat");
  /** Only the chat view owns the address bar and the tab title. */
  const isChatView = !props.view || props.view === "chat" || props.view === "feedback";

  useEffect(() => {
    void init(props.userId);
  }, [init, props.userId]);

  // A link that names a chat (/?chat=<id>) opens that conversation once the
  // store is ready. Nothing is opened when the route names no chat.
  useEffect(() => {
    if (!hydrated || !requestedChat) return;
    const { chats, activeChatId, setActiveChat } = useChatStore.getState();
    if (activeChatId !== requestedChat && chats.some((c) => c.id === requestedChat)) {
      void setActiveChat(requestedChat);
    }
  }, [hydrated, requestedChat]);

  // The route mirrors the open conversation, so a refresh reopens exactly it —
  // and stays on the empty new-chat state when no chat is open.
  useEffect(() => {
    if (!hydrated || !isChatView) return;
    // A temporary chat has no row, so it is never named in the route.
    const routed = activeChatId === TEMPORARY_CHAT_ID ? null : activeChatId;
    if (routed === requestedChat) return;
    router.replace(routed ? `/?chat=${routed}` : "/", { scroll: false });
  }, [hydrated, activeChatId, requestedChat, isChatView, router]);

  // The tab follows the open conversation, using its generated title. Set from
  // the client because the title is only known once the store has it.
  useEffect(() => {
    if (!isChatView) return;
    const title = activeChatTitle?.trim();
    document.title =
      activeChatId && title && title !== DEFAULT_CHAT_TITLE ? `${title} | Ugnay` : "Ugnay";
  }, [activeChatId, activeChatTitle, isChatView]);

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

  /**
   * App shortcuts.
   *
   *   Cmd/Ctrl+K          search
   *   Cmd/Ctrl+Shift+O    new chat
   *   Cmd/Ctrl+Shift+P    model picker
   *   Escape              close the open panel
   *
   * New chat is Shift+O rather than Cmd/Ctrl+N because browsers keep N for a
   * new window and never deliver it to the page. Anything with a dialog open
   * is left alone, so a modal's own Escape handling still wins.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Innermost surface first, so one press closes one thing.
        const state = useChatStore.getState();
        if (state.artifact) state.closeArtifact();
        else if (compareOpen) setCompareOpen(false);
        else if (state.panelProjectId) state.setPanelProject(null);
        else setSidebarOpen(false);
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.repeat) return;
      // A dialog owns the keyboard while it is up.
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();

      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        if (props.view !== "search") router.push("/search");
        return;
      }
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        useChatStore.getState().newChat();
        if (!isChatView) router.push("/");
        return;
      }
      if (key === "p" && event.shiftKey) {
        event.preventDefault();
        useChatStore.getState().openModelPicker();
        if (!isChatView) router.push("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarOpen, router, props.view, isChatView, compareOpen]);

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
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        user={user}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenUsage={() => setUsageOpen(true)}
        onOpenCompare={() => setCompareOpen(true)}
        activeNav={
          // /feedback is the chat with a modal over it, so the chat row stays active.
          !props.view || props.view === "feedback" ? "chat" : props.view
        }
      />

      {props.view === "release-notes" ? (
        <ReleaseNotesView />
      ) : props.view === "workflows" ? (
        <WorkflowsView />
      ) : props.view === "knowledge" ? (
        <KnowledgeView />
      ) : compareOpen ? (
        <ModelCompareView onClose={() => setCompareOpen(false)} />
      ) : (
        <>
          <ChatWindow user={user} />

          {/* Workspace settings and instructions, beside the conversation. */}
          <WorkspacePanel />

          {/* The canvas, for a generated document opened out of a reply. */}
          <ArtifactPanel />
        </>
      )}

      {/* /search keeps the chat behind it, like a command palette. */}
      {props.view === "search" && <SearchOverlay onClose={() => router.push("/")} />}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} user={user} />

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <UsageModal open={usageOpen} onClose={() => setUsageOpen(false)} />
    </div>
  );
}
