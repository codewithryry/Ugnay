"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import AccountMenu from "./AccountMenu";
import type { CurrentUser } from "./ChatApp";
import { createClient } from "@/lib/supabase/client";
import { cn, groupByDate } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

const rowClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition";

export default function Sidebar({
  user,
  onOpenSettings,
  activeNav = "chat",
}: {
  user: CurrentUser;
  onOpenSettings: () => void;
  /** Highlights the row for the surface currently shown. */
  activeNav?: "chat" | "search";
}) {
  const router = useRouter();
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const hydrated = useChatStore((s) => s.hydrated);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const newChat = useChatStore((s) => s.newChat);

  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  const groups = useMemo(() => groupByDate(chats, (c) => c.updated_at), [chats]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside
      id="chat-sidebar"
      aria-label="Chat history"
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overscroll-contain border-r border-ink-800 bg-ink-900 pb-safe pl-safe pt-safe transition-[transform,width] duration-200 md:static md:translate-x-0 md:p-0",
        // Caps the drawer on a 320px viewport so the backdrop stays tappable.
        collapsed ? "w-[min(280px,85vw)] md:w-[68px]" : "w-[min(280px,85vw)]",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-3 py-3",
          collapsed && "md:flex-col md:gap-1.5 md:px-2",
        )}
      >
        <span className={cn("flex shrink-0 items-center gap-2 px-1", collapsed && "md:px-0")}>
          <Image
            src="/logo/logo-192.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-lg"
          />
          <span
            className={cn(
              "font-display text-xl font-semibold tracking-tight text-neutral-100",
              collapsed && "md:hidden",
            )}
          >
            Ugnay
          </span>
        </span>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="hidden rounded-lg p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-neutral-100 md:block"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="-mr-1 rounded-lg p-2.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100 md:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="px-2 pb-2">
        <Link
          href="/search"
          title="Search"
          aria-current={activeNav === "search" ? "page" : undefined}
          className={cn(
            rowClass,
            activeNav === "search"
              ? "bg-ink-800 text-neutral-100"
              : "text-neutral-300 hover:bg-ink-850 hover:text-neutral-100",
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className={cn("truncate", collapsed && "md:hidden")}>Search</span>
        </Link>

        <button
          type="button"
          onClick={() => {
            newChat();
            if (activeNav !== "chat") router.push("/");
          }}
          title="New chat"
          className={cn(
            rowClass,
            activeNav === "chat"
              ? "bg-ink-800 text-neutral-100 hover:bg-ink-700"
              : "text-neutral-300 hover:bg-ink-850 hover:text-neutral-100",
          )}
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden />
          <span className={cn("truncate", collapsed && "md:hidden")}>New Chat</span>
        </button>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col border-t border-ink-800 px-2 py-2",
          collapsed && "md:hidden",
        )}
      >
        <SectionHeader
          label="Recent"
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
        />

        {historyOpen && (
          <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {!hydrated && (
              <ul className="space-y-1.5 px-1 pt-1" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="h-8 animate-pulse rounded-lg bg-ink-850" />
                ))}
              </ul>
            )}

            {hydrated && chats.length === 0 && (
              <p className="px-2.5 pt-3 text-xs leading-relaxed text-neutral-600">
                No conversations yet. Start one and it will show up here.
              </p>
            )}

            {groups.map((group) => (
              <div key={group.label} className="mt-3 first:mt-0">
                <h2 className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
                  {group.label}
                </h2>
                <ul className="space-y-0.5">
                  {group.items.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      id={chat.id}
                      title={chat.title}
                      active={activeNav === "chat" && chat.id === activeChatId}
                      onSelect={() => {
                        void setActiveChat(chat.id);
                        if (activeNav !== "chat") router.push("/");
                      }}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className={cn("mt-auto border-t border-ink-800 p-2", collapsed && "md:px-1")}>
        <AccountMenu
          user={user}
          onOpenSettings={onOpenSettings}
          onSignOut={signOut}
          compact={collapsed}
        />
      </div>
    </aside>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-neutral-500 transition hover:text-neutral-300"
    >
      {label}
      <ChevronDown
        className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
        aria-hidden
      />
    </button>
  );
}

function ChatRow({
  id,
  title,
  active,
  onSelect,
}: {
  id: string;
  title: string;
  active: boolean;
  onSelect: () => void;
}) {
  const renameChat = useChatStore((s) => s.renameChat);
  const deleteChat = useChatStore((s) => s.deleteChat);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  function commit() {
    setEditing(false);
    if (draft.trim() && draft.trim() !== title) void renameChat(id, draft);
    else setDraft(title);
  }

  if (editing) {
    return (
      <li>
        <div className="flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1">
          <input
            ref={inputRef}
            value={draft}
            aria-label="Chat title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(title);
                setEditing(false);
              }
            }}
            className="w-full min-w-0 bg-transparent py-1 text-base text-neutral-100 outline-none sm:text-sm"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commit}
            aria-label="Save title"
            className="rounded p-1 text-neutral-400 hover:text-neutral-100"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition",
          active ? "bg-ink-800 text-neutral-100" : "text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
        )}
      >
        <span className="truncate pr-16">{title}</span>
      </button>

      <div
        className={cn(
          "absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100",
          // No hover on touch: show them permanently there instead.
          "touch-visible",
          active && "opacity-100",
        )}
      >
        {confirmDelete ? (
          <>
            <button
              type="button"
              onClick={() => void deleteChat(id)}
              className="rounded p-2 text-red-400 hover:bg-ink-700"
              aria-label={`Confirm delete ${title}`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded p-2 text-neutral-400 hover:bg-ink-700"
              aria-label="Cancel delete"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-2 text-neutral-500 hover:bg-ink-700 hover:text-neutral-200"
              aria-label={`Rename ${title}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-2 text-neutral-500 hover:bg-ink-700 hover:text-red-400"
              aria-label={`Delete ${title}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
