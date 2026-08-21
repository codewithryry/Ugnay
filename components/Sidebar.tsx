"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FolderClosed,
  FolderPlus,
  History as HistoryIcon,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Archive,
  ArchiveRestore,
  Pin,
  Search,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import AccountMenu, { SoonTag } from "./AccountMenu";
import type { CurrentUser } from "./ChatApp";
import { createClient } from "@/lib/supabase/client";
import { cn, groupByDate } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

const rowClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition";
/** Collapsed rows lose their label, so the icon becomes the whole target: a
 * square, centred hit area of the same size as the account trigger below it. */
const collapsedRowClass = "md:h-10 md:justify-center md:gap-0 md:px-0 md:py-0";
/** One icon size and stroke for every collapsed control. */
const iconClass = "h-4 w-4 shrink-0";
const collapsedIconClass = "md:h-5 md:w-5";
/** Rows inside the workspace menu, mirroring the account menu's popup rows. */
const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-200 transition hover:bg-ink-800";
const menuItemDisabledClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-500";

export default function Sidebar({
  user,
  onOpenSettings,
  onOpenFeedback,
  onOpenUsage,
  onOpenCompare,
  activeNav = "chat",
}: {
  user: CurrentUser;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  onOpenUsage: () => void;
  onOpenCompare: () => void;
  /** Highlights the row for the surface currently shown. */
  activeNav?: "chat" | "search" | "release-notes";
}) {
  const router = useRouter();
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const hydrated = useChatStore((s) => s.hydrated);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const newChat = useChatStore((s) => s.newChat);
  const projects = useChatStore((s) => s.projects);
  const activeProjectId = useChatStore((s) => s.activeProjectId);
  const createProject = useChatStore((s) => s.createProject);
  const setActiveProject = useChatStore((s) => s.setActiveProject);
  const newChatInProject = useChatStore((s) => s.newChatInProject);

  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  /** Inline name field shown after "New Workspace" is clicked. */
  const [namingWorkspace, setNamingWorkspace] = useState(false);

  // Conversations inside a workspace are listed under it, not in History.
  const [historyQuery, setHistoryQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  /** Plain conversations, minus archived ones unless they are being shown. */
  const visibleChats = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return chats.filter(
      (c) =>
        !c.project_id &&
        (showArchived ? c.archived : !c.archived) &&
        (!q || c.title.toLowerCase().includes(q)),
    );
  }, [chats, historyQuery, showArchived]);

  const pinnedChats = useMemo(
    () => visibleChats.filter((c) => c.pinned),
    [visibleChats],
  );
  const groups = useMemo(
    () => groupByDate(visibleChats.filter((c) => !c.pinned), (c) => c.updated_at),
    [visibleChats],
  );
  const archivedCount = useMemo(
    () => chats.filter((c) => !c.project_id && c.archived).length,
    [chats],
  );

  async function signOut() {
    await createClient().auth.signOut();
    // "/" is the public New Chat now, so there is no reason to force the
    // sign-in page on someone who just left.
    router.replace("/");
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
          collapsed && "md:justify-center md:px-2",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center gap-2 px-1",
            collapsed && "md:h-10 md:w-10 md:justify-center md:px-0",
          )}
        >
          <Image
            src="/logo/logo-192.png"
            alt=""
            width={28}
            height={28}
            className={cn("h-7 w-7 shrink-0 rounded-lg", collapsed && "md:h-8 md:w-8")}
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

        {/* Collapsed, this control moves down beside the avatar. */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse sidebar"
          aria-expanded
          className={cn(
            "hidden rounded-lg p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-neutral-100 md:block",
            collapsed && "md:hidden",
          )}
        >
          <ChevronsLeft className={iconClass} aria-hidden />
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

      {/* Fixed navigation: stays put while the history below it scrolls. */}
      <nav
        aria-label="Main"
        className={cn("shrink-0 space-y-0.5 px-2 pb-2", collapsed && "md:space-y-1")}
      >
        <NavRow
          icon={Search}
          label="Search"
          href="/search"
          collapsed={collapsed}
          active={activeNav === "search"}
        />
        <NavRow
          icon={SquarePen}
          label="New Chat"
          collapsed={collapsed}
          active={activeNav === "chat"}
          onClick={() => {
            newChat();
            if (activeNav !== "chat") router.push("/");
          }}
        />
        {/* No destination yet: rendered like the other pending entries, and a
         * real row as soon as one exists. */}
        <NavRow icon={ImageIcon} label="Image" collapsed={collapsed} soon />
        <NavRow icon={Workflow} label="Automations" collapsed={collapsed} soon />
        <NavRow icon={Blocks} label="Skills and Connectors" collapsed={collapsed} soon />
      </nav>

      <div className={cn("shrink-0 px-2 pb-1", collapsed && "md:hidden")}>
        <SectionHeader
          label="Projects"
          open={projectsOpen}
          onToggle={() => setProjectsOpen((v) => !v)}
          action={{
            icon: FolderPlus,
            label: "New workspace",
            onClick: () => {
              setProjectsOpen(true);
              setNamingWorkspace(true);
            },
          }}
        />

        {projectsOpen && (
          <div className="space-y-0.5">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                id={project.id}
                name={project.name}
                active={activeProjectId === project.id}
                onSelect={() => {
                  void setActiveProject(project.id);
                  if (activeNav !== "chat") router.push("/");
                }}
                onNewChat={() => {
                  newChatInProject(project.id);
                  if (activeNav !== "chat") router.push("/");
                }}
              />
            ))}

            {namingWorkspace && (
              <WorkspaceNameField
                onCancel={() => setNamingWorkspace(false)}
                onCommit={(name) => {
                  setNamingWorkspace(false);
                  void createProject(name);
                  if (activeNav !== "chat") router.push("/");
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Collapsed, the two sections are icons that reopen the sidebar on them. */}
      {collapsed && (
        <div className="hidden shrink-0 space-y-1 px-2 pb-2 md:block">
          <NavRow
            icon={FolderClosed}
            label="Projects"
            collapsed
            onClick={() => {
              setProjectsOpen(true);
              setCollapsed(false);
            }}
          />
          <NavRow
            icon={HistoryIcon}
            label="History"
            collapsed
            onClick={() => {
              setHistoryOpen(true);
              setCollapsed(false);
            }}
          />
        </div>
      )}

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col border-t border-ink-800 px-2 py-2",
          collapsed && "md:hidden",
        )}
      >
        <SectionHeader
          label="History"
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
        />

        {historyOpen && (
          <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {hydrated && (chats.some((c) => !c.project_id) || historyQuery) && (
              <div className="relative px-1 pb-2 pt-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-600"
                  aria-hidden
                />
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="Filter conversations"
                  aria-label="Filter conversations"
                  className="w-full rounded-lg border border-ink-800 bg-ink-950 py-1.5 pl-8 pr-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-ink-700 focus:outline-none"
                />
              </div>
            )}

            {!hydrated && (
              <ul className="space-y-1.5 px-1 pt-1" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="h-8 animate-pulse rounded-lg bg-ink-850" />
                ))}
              </ul>
            )}

            {hydrated && groups.length === 0 && pinnedChats.length === 0 && (
              <p className="px-2.5 pt-3 text-xs leading-relaxed text-neutral-600">
                {historyQuery.trim()
                  ? "No conversations match that filter."
                  : showArchived
                    ? "Nothing archived."
                    : "No conversations yet. Start one and it will show up here."}
              </p>
            )}

            {pinnedChats.length > 0 && (
              <div className="mt-3 first:mt-0">
                <h2 className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
                  Pinned
                </h2>
                <ul className="space-y-0.5">
                  {pinnedChats.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      id={chat.id}
                      title={chat.title}
                      pinned={chat.pinned}
                      archived={chat.archived}
                      active={activeNav === "chat" && chat.id === activeChatId}
                      onSelect={() => {
                        void setActiveChat(chat.id);
                        if (activeNav !== "chat") router.push("/");
                      }}
                    />
                  ))}
                </ul>
              </div>
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
                      pinned={chat.pinned}
                      archived={chat.archived}
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

            {archivedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="mt-3 w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-neutral-600 transition hover:bg-ink-850 hover:text-neutral-400"
              >
                {showArchived ? "← Back to conversations" : `Archived (${archivedCount})`}
              </button>
            )}
          </nav>
        )}
      </div>

      <div className={cn("mt-auto shrink-0 border-t border-ink-800 p-2", collapsed && "md:px-1")}>
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            aria-expanded={false}
            className="hidden text-neutral-500 hover:bg-ink-800 hover:text-neutral-100 md:mb-1 md:flex md:h-10 md:w-full md:items-center md:justify-center md:rounded-lg"
          >
            <ChevronsRight className={cn(iconClass, collapsedIconClass)} aria-hidden />
          </button>
        )}
        <AccountMenu
          user={user}
          onOpenSettings={onOpenSettings}
          onOpenFeedback={onOpenFeedback}
          onOpenUsage={onOpenUsage}
          onOpenCompare={onOpenCompare}
          onSignOut={signOut}
          compact={collapsed}
        />
      </div>
    </aside>
  );
}

/**
 * One navigation row: a link, a button, or — while a destination does not exist
 * yet — a disabled row with the same "Soon" tag the account menu uses.
 * Collapsed, the label drops away and the icon becomes the whole target.
 */
function NavRow({
  icon: Icon,
  label,
  href,
  onClick,
  active = false,
  soon = false,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  soon?: boolean;
  collapsed: boolean;
}) {
  const className = cn(
    rowClass,
    collapsed && collapsedRowClass,
    soon
      ? "cursor-default text-neutral-500"
      : active
        ? "bg-ink-800 text-neutral-100"
        : "text-neutral-300 hover:bg-ink-850 hover:text-neutral-100",
  );

  const body = (
    <>
      <Icon className={cn(iconClass, collapsed && collapsedIconClass)} aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "md:hidden")}>{label}</span>
      {soon && !collapsed && <SoonTag />}
    </>
  );

  if (soon) {
    return (
      <span aria-disabled title={label} className={className}>
        {body}
      </span>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        title={label}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} title={label} className={className}>
      {body}
    </button>
  );
}

/**
 * A compact workspace row: diamond, name, a "+" that starts a conversation in
 * it, and a menu for the workspace itself. Its conversations are listed beneath
 * it while it is the open workspace.
 */
function ProjectRow({
  id,
  name,
  active,
  onSelect,
  onNewChat,
}: {
  id: string;
  name: string;
  active: boolean;
  onSelect: () => void;
  onNewChat: () => void;
}) {
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const renameProject = useChatStore((s) => s.renameProject);
  const deleteProject = useChatStore((s) => s.deleteProject);

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const setPanelProject = useChatStore((s) => s.setPanelProject);

  // Every conversation saved in this workspace, newest first.
  const projectChats = chats.filter((c) => c.project_id === id);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (renaming) {
    return (
      <WorkspaceNameField
        initial={name}
        onCancel={() => setRenaming(false)}
        onCommit={(next) => {
          setRenaming(false);
          if (next !== name) void renameProject(id, next);
        }}
      />
    );
  }

  return (
    <div>
      <div
        className={cn(
          "group flex items-center rounded-lg pr-1 transition",
          active ? "bg-ink-800" : "hover:bg-ink-850",
        )}
      >
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            onSelect();
          }}
          title={name}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
            active ? "text-neutral-100" : "text-neutral-300 group-hover:text-neutral-100",
          )}
        >
          <FolderClosed className={iconClass} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          aria-label={`New chat in ${name}`}
          title={`New chat in ${name}`}
          className="shrink-0 rounded-md p-1 text-neutral-500 transition hover:text-neutral-100"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`${name} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded-md p-1 text-neutral-500 transition hover:text-neutral-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" aria-hidden onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                aria-label={`${name} options`}
                className="absolute left-0 top-full z-50 mt-1 w-[168px] space-y-0.5 rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl animate-fade-in"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                  className={menuItemClass}
                >
                  <Pencil className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                  Rename
                </button>

                {/* Workspaces have no shareable URL yet. */}
                <span role="menuitem" aria-disabled className={menuItemDisabledClass}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  Share
                  <SoonTag />
                </span>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    // Opens in the workspace panel beside the conversation.
                    setPanelProject(id);
                  }}
                  className={menuItemClass}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                  Settings
                </button>

                <div className="my-1 h-px bg-ink-700" role="none" />

                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void deleteProject(id);
                  }}
                  className={cn(menuItemClass, "text-red-300 hover:bg-red-950/40 hover:text-red-200")}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Its conversations stay listed under it, so they are reachable after a
       * reload without having to open the workspace first. */}
      {expanded && projectChats.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 border-l border-ink-800 pl-2">
          {projectChats.map((chat) => (
            <ChatRow
              key={chat.id}
              id={chat.id}
              title={chat.title}
              active={chat.id === activeChatId}
              onSelect={() => void setActiveChat(chat.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline field used to name a new workspace and to rename an existing one. */
function WorkspaceNameField({
  initial = "",
  onCommit,
  onCancel,
}: {
  initial?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function commit() {
    const clean = draft.trim();
    if (clean) onCommit(clean);
    else onCancel();
  }

  return (
    <div className="flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1">
      <FolderClosed className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
      <input
        ref={inputRef}
        value={draft}
        aria-label="Workspace name"
        placeholder="Workspace name"
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        className="w-full min-w-0 bg-transparent py-1 text-base text-neutral-100 placeholder:text-neutral-600 outline-none sm:text-sm"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        aria-label="Save workspace name"
        className="rounded p-1 text-neutral-400 hover:text-neutral-100"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Optional control on the right of the header, e.g. "new workspace". */
  action?: { icon: LucideIcon; label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-neutral-500 transition hover:text-neutral-300"
      >
        {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
      </button>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          title={action.label}
          className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-ink-850 hover:text-neutral-100"
        >
          <action.icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function ChatRow({
  id,
  title,
  active,
  pinned = false,
  archived = false,
  onSelect,
}: {
  id: string;
  title: string;
  active: boolean;
  pinned?: boolean;
  archived?: boolean;
  onSelect: () => void;
}) {
  const renameChat = useChatStore((s) => s.renameChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const setChatPinned = useChatStore((s) => s.setChatPinned);
  const setChatArchived = useChatStore((s) => s.setChatArchived);

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
        <span className="truncate pr-24">{title}</span>
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
              onClick={() => void setChatPinned(id, !pinned)}
              aria-pressed={pinned}
              className={cn(
                "rounded p-1.5 hover:bg-ink-700",
                pinned ? "text-neutral-200" : "text-neutral-500 hover:text-neutral-200",
              )}
              aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            >
              <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void setChatArchived(id, !archived)}
              className="rounded p-1.5 text-neutral-500 hover:bg-ink-700 hover:text-neutral-200"
              aria-label={archived ? `Unarchive ${title}` : `Archive ${title}`}
            >
              {archived ? (
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Archive className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-1.5 text-neutral-500 hover:bg-ink-700 hover:text-neutral-200"
              aria-label={`Rename ${title}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1.5 text-neutral-500 hover:bg-ink-700 hover:text-red-400"
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
