"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Coins,
  ChevronRight,
  Columns3,
  FileText,
  Flag,
  Gift,
  HelpCircle,
  History,
  Link2,
  LogOut,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { CurrentUser } from "./ChatApp";
import UserAvatar from "./UserAvatar";
import { cn } from "@/lib/utils";

/**
 * Help submenu entries. Every row is a real destination.
 *
 * Feedback is a modal rather than a page, so it sits outside this list and is
 * rendered as the first row by hand.
 */
const HELP_ITEMS: { key: string; label: string; icon: LucideIcon; href: string }[] = [
  { key: "faq", label: "FAQ", icon: HelpCircle, href: "/faq" },
  { key: "release-notes", label: "Release Notes", icon: History, href: "/release-notes" },
  { key: "terms", label: "Terms of Service", icon: FileText, href: "/terms" },
  { key: "privacy", label: "Privacy Policy", icon: ShieldCheck, href: "/privacy" },
];
const UPGRADE_URL: string | null = "/upgrade";

/** Help submenu geometry: always a popup beside the row, never inline. */
const HELP_PANEL_WIDTH = 208;
/** Visible gap between the account menu's edge and the submenu. */
const HELP_PANEL_GAP = 8;
/**
 * The Help row sits inside the menu's own p-1.5 padding, so the row's edge is
 * 6px short of the menu's edge. Clearing that as well is what keeps the submenu
 * off the menu instead of flush against it — the same correction
 * ModelSelector applies to its "More models" flyout.
 */
const MENU_PADDING = 6;
const HELP_PANEL_OFFSET = HELP_PANEL_GAP + MENU_PADDING;
const VIEWPORT_MARGIN = 8;

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-neutral-200 transition hover:bg-ink-800 focus:bg-ink-800 focus:outline-none";
const disabledClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-neutral-500";

export default function AccountMenu({
  user,
  onOpenSettings,
  onOpenFeedback,
  onOpenUsage,
  onOpenCredits,
  onOpenReferral,
  onOpenCompare,
  onSignOut,
  compact = false,
}: {
  user: CurrentUser;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  onOpenUsage: () => void;
  onOpenCredits: () => void;
  onOpenReferral: () => void;
  onOpenCompare: () => void;
  onSignOut: () => void;
  /** Icon-only trigger for the collapsed sidebar; the menu itself is unchanged. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [helpAnchor, setHelpAnchor] = useState<{
    bottom: number;
    left: number;
    /** Set only when the submenu is stacked above the menu and matches its width. */
    width?: number;
  } | null>(null);
  const helpRowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Places the Help popup beside its row: to the right when there is room,
   * flipped to the left otherwise. On a narrow screen neither side fits — two
   * panels side by side need more width than the viewport has — so it is
   * stacked above the menu instead, aligned to it and clear of the account
   * section pinned below.
   */
  function placeHelp() {
    const rect = helpRowRef.current?.getBoundingClientRect();
    if (!rect) return;

    const span = HELP_PANEL_OFFSET + HELP_PANEL_WIDTH;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - HELP_PANEL_WIDTH;
    const fitsRight = rect.right + span <= window.innerWidth - VIEWPORT_MARGIN;
    const fitsLeft = rect.left - span >= VIEWPORT_MARGIN;

    // Beside the row is the whole point, so the panel is never folded into the
    // menu. When a phone-width menu leaves no clear room on either side, the
    // panel is pushed against the nearest screen edge: it overlaps the menu's
    // far edge but still reads as a second panel off to the side.
    // No room either side: stack it above the menu, matching the menu's own
    // left edge and width so the two read as one column, with the same gap
    // between them that the menu keeps from the account trigger.
    if (!fitsRight && !fitsLeft) {
      const menu = menuRef.current?.getBoundingClientRect();
      if (menu) {
        setHelpAnchor({
          bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - menu.top + HELP_PANEL_GAP),
          left: Math.max(VIEWPORT_MARGIN, menu.left),
          width: menu.width,
        });
        return;
      }
    }

    const left = fitsRight
      ? rect.right + HELP_PANEL_OFFSET
      : fitsLeft
        ? rect.left - span
        : Math.max(VIEWPORT_MARGIN, maxLeft);

    // The panel's bottom edge is aligned with the row it opens from, so it
    // grows upward. Centring it on the row instead let a long list drift down
    // over the account section pinned below the menu.
    const bottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.bottom);

    setHelpAnchor({ bottom, left });
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

  // The beside panel is position-fixed, so it has to be re-measured whenever
  // the row it points at can move.
  useEffect(() => {
    if (!helpOpen) return;
    function reflow() {
      placeHelp();
    }
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [helpOpen]);

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
            ref={menuRef}
            role="menu"
            aria-label="Account"
            className={cn(
              // Flush with the account section's own padding, so the menu lines up
              // with the nav rows above it instead of sitting 8px further in.
              // Lifted a full 1rem off the trigger: at 0.5rem the menu's last row
              // sat almost against the account row and the two read as one block.
              "absolute bottom-[calc(100%+1rem)] left-0 right-0 z-20 max-h-[70dvh] space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl",
              // The collapsed rail is only ~68px wide, which would squeeze the
              // labels onto several lines; the menu keeps its own width there
              // and opens across the conversation instead.
              compact && "md:left-0 md:right-auto md:w-52",
            )}
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

            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onOpenUsage();
              }}
              className={itemClass}
            >
              <BarChart3 className="h-4 w-4 text-neutral-500" aria-hidden />
              Usage
            </button>

            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onOpenCredits();
              }}
              className={itemClass}
            >
              <Coins className="h-4 w-4 text-neutral-500" aria-hidden />
              Credits
            </button>

            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onOpenReferral();
              }}
              className={itemClass}
            >
              <Gift className="h-4 w-4 text-neutral-500" aria-hidden />
              Invite &amp; Earn
            </button>

            <button
              role="menuitem"
              type="button"
              onMouseEnter={() => setHelpOpen(false)}
              onClick={() => {
                close();
                onOpenCompare();
              }}
              className={itemClass}
            >
              <Columns3 className="h-4 w-4 text-neutral-500" aria-hidden />
              Compare models
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
                  style={{
                      bottom: helpAnchor.bottom,
                      left: helpAnchor.left,
                      width: helpAnchor.width ?? HELP_PANEL_WIDTH,
                    }}
                  // Bounded like the model menu: the list is long enough now
                  // that a short viewport would otherwise clip its last rows.
                  className="fixed z-40 max-h-[min(70dvh,26rem)] space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl animate-fade-in"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={itemClass}
                    onClick={() => {
                      close();
                      onOpenFeedback();
                    }}
                  >
                    <Flag className="h-4 w-4 text-neutral-500" aria-hidden />
                    Feedback
                  </button>

                  {/*
                    Link, not a plain anchor. A bare <a href="/faq"> asks the
                    server for that path, which the browser resolves to
                    faq.html. Inside the APK there is no server: the pages are
                    files next to index.html, and the request 404s. Link routes
                    on the client, which works in both.
                  */}
                  {HELP_ITEMS.map((item) => (
                    <Link
                      key={item.key}
                      role="menuitem"
                      href={item.href}
                      className={itemClass}
                      onClick={close}
                    >
                      <item.icon className="h-4 w-4 text-neutral-500" aria-hidden />
                      {item.label}
                    </Link>
                  ))}

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
              <Link
                role="menuitem"
                href={UPGRADE_URL}
                onClick={close}
                onMouseEnter={() => setHelpOpen(false)}
                className={itemClass}
              >
                <Sparkles className="h-4 w-4 text-neutral-500" aria-hidden />
                Upgrade plan
              </Link>
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
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-ink-800",
          // Collapsed: a centred square target matching the rows above it.
          compact && "md:h-10 md:justify-center md:gap-0 md:px-0 md:py-0",
        )}
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

/** Shared with the sidebar so pending rows look the same in both places. */
export function SoonTag() {
  return (
    <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-600">
      Soon
    </span>
  );
}
