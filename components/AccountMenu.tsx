"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Flag,
  HelpCircle,
  History,
  Link2,
  LogOut,
  MoreHorizontal,
  Settings,
  Share2,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CurrentUser } from "./ChatApp";
import UserAvatar from "./UserAvatar";
import { cn } from "@/lib/utils";

/**
 * Destinations for the Help entries. Point these at the real URLs once they
 * exist; `null` renders the item as not-yet-available rather than a dead link.
 */
/**
 * Help submenu entries. `href: null` means the destination does not exist yet,
 * so the row renders disabled with a "Soon" tag instead of a dead link — drop a
 * URL in and it becomes a real link with no other change.
 */
const HELP_ITEMS: { key: string; label: string; icon: LucideIcon; href: string | null }[] = [
  { key: "feedback", label: "Feedback", icon: Flag, href: null },
  { key: "faq", label: "FAQ", icon: HelpCircle, href: null },
  { key: "release-notes", label: "Release Notes", icon: History, href: null },
  { key: "community", label: "Community", icon: Users, href: null },
  { key: "shared-links", label: "Shared Links", icon: Share2, href: null },
];
const UPGRADE_URL: string | null = "/upgrade";

/** Help submenu geometry: it is a separate popup, not an inline expansion. */
const HELP_PANEL_WIDTH = 208;
const HELP_PANEL_GAP = 8;

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-neutral-200 transition hover:bg-ink-800 focus:bg-ink-800 focus:outline-none";
const disabledClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-neutral-500";

export default function AccountMenu({
  user,
  onOpenSettings,
  onSignOut,
  compact = false,
}: {
  user: CurrentUser;
  onOpenSettings: () => void;
  onSignOut: () => void;
  /** Icon-only trigger for the collapsed sidebar; the menu itself is unchanged. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [helpAnchor, setHelpAnchor] = useState<{ top: number; left: number } | null>(null);
  const helpRowRef = useRef<HTMLButtonElement>(null);

  /**
   * Places the Help popup beside its row: to the right when there is room,
   * flipped to the left otherwise, and clamped inside the viewport.
   */
  function placeHelp() {
    const rect = helpRowRef.current?.getBoundingClientRect();
    if (!rect) return;

    const fitsRight = rect.right + HELP_PANEL_GAP + HELP_PANEL_WIDTH <= window.innerWidth - 8;
    const left = fitsRight
      ? rect.right + HELP_PANEL_GAP
      : Math.max(8, rect.left - HELP_PANEL_GAP - HELP_PANEL_WIDTH);

    // Roughly centred on the row, then kept fully on screen.
    const estimatedHeight = 320;
    const top = Math.min(
      Math.max(8, rect.top - estimatedHeight / 2 + rect.height / 2),
      Math.max(8, window.innerHeight - estimatedHeight - 8),
    );

    setHelpAnchor({ top, left });
  }
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function close() {
    setOpen(false);
    setHelpOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, helpOpen]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Hovering off Help shouldn't snap the submenu away while the pointer
  // travels across the gap between the two panels.
  function scheduleHelpClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHelpOpen(false), 180);
  }
  function cancelHelpClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  async function share() {
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Ugnay", url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1600);
      }
    } catch {
      // User dismissed the share sheet, or the clipboard was blocked.
    }
  }

  return (
    <div className="relative">
      {open && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={close} />
          <div
            role="menu"
            aria-label="Account"
            className="absolute bottom-[calc(100%+0.5rem)] left-2 right-2 z-20 max-h-[70dvh] space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl"
          >
            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onOpenSettings();
              }}
              className={itemClass}
            >
              <Settings className="h-4 w-4 text-neutral-500" aria-hidden />
              Settings
            </button>

            <div
              className="relative"
              onMouseEnter={() => {
                cancelHelpClose();
                placeHelp();
                setHelpOpen(true);
              }}
              onMouseLeave={scheduleHelpClose}
            >
              <button
                ref={helpRowRef}
                role="menuitem"
                type="button"
                aria-haspopup="menu"
                aria-expanded={helpOpen}
                onClick={() => {
                  placeHelp();
                  setHelpOpen((v) => !v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    placeHelp();
                    setHelpOpen(true);
                  }
                  if (e.key === "ArrowLeft") setHelpOpen(false);
                }}
                className={cn(itemClass, helpOpen && "bg-ink-800")}
              >
                <HelpCircle className="h-4 w-4 text-neutral-500" aria-hidden />
                <span className="flex-1">Help</span>
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform",
                    helpOpen && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>

              {helpOpen && helpAnchor && (
                <div
                  role="menu"
                  aria-label="Help"
                  onMouseEnter={cancelHelpClose}
                  onMouseLeave={scheduleHelpClose}
                  style={{ top: helpAnchor.top, left: helpAnchor.left, width: HELP_PANEL_WIDTH }}
                  className="fixed z-40 space-y-0.5 rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl animate-fade-in"
                >
                  {HELP_ITEMS.map((item) =>
                    item.href ? (
                      <a
                        key={item.key}
                        role="menuitem"
                        href={item.href}
                        className={itemClass}
                        onClick={close}
                      >
                        <item.icon className="h-4 w-4 text-neutral-500" aria-hidden />
                        {item.label}
                      </a>
                    ) : (
                      <span key={item.key} role="menuitem" aria-disabled className={disabledClass}>
                        <item.icon className="h-4 w-4" aria-hidden />
                        {item.label}
                        <SoonTag />
                      </span>
                    ),
                  )}

                  <div className="my-1 h-px bg-ink-700" role="none" />

                  {/* Works today: copies a link to Ugnay, or opens the share sheet. */}
                  <button role="menuitem" type="button" onClick={share} className={itemClass}>
                    <Link2 className="h-4 w-4 text-neutral-500" aria-hidden />
                    {shared ? "Link copied" : "Copy app link"}
                  </button>
                </div>
              )}
            </div>

            {UPGRADE_URL ? (
              <a
                role="menuitem"
                href={UPGRADE_URL}
                onClick={close}
                onMouseEnter={() => setHelpOpen(false)}
                className={itemClass}
              >
                <Sparkles className="h-4 w-4 text-neutral-500" aria-hidden />
                Upgrade plan
              </a>
            ) : (
              <span role="menuitem" aria-disabled className={disabledClass}>
                <Sparkles className="h-4 w-4" aria-hidden />
                Upgrade plan
                <SoonTag />
              </span>
            )}

            <div className="my-1.5 h-px bg-ink-700" role="none" />

            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onSignOut();
              }}
              className={itemClass}
            >
              <LogOut className="h-4 w-4 text-neutral-500" aria-hidden />
              Sign Out
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-ink-800"
      >
        <UserAvatar name={user.displayName} src={user.avatarUrl} />
        <span className={cn("min-w-0 flex-1", compact && "md:hidden")}>
          <span className="block truncate text-sm text-neutral-200">{user.displayName}</span>
          <span className="block truncate text-xs text-neutral-500">{user.email}</span>
        </span>
        <MoreHorizontal
          className={cn("h-4 w-4 shrink-0 text-neutral-500", compact && "md:hidden")}
          aria-hidden
        />
      </button>
    </div>
  );
}

function SoonTag() {
  return (
    <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-600">
      Soon
    </span>
  );
}
