"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import type { ModelInfoLite } from "@/store/chatStore";

/** Flyout geometry, used for collision detection when choosing a side. One
 * compact column, scrolled — columns per provider left too much empty space. */
const FLYOUT_WIDTH = 216;
/** Visible gap between the menu edge and the flyout. */
const FLYOUT_GAP = 8;
/** The flyout is positioned off a row that sits inside the menu's own p-2
 * padding, so the row's edge is 8px short of the menu's edge. Clearing that
 * padding as well is what keeps the flyout from sitting on top of the menu. */
const MENU_PADDING = 8;
const FLYOUT_OFFSET = FLYOUT_GAP + MENU_PADDING;
/** Menu width, and the margin it keeps from either viewport edge. */
const MENU_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

/** Models from the active provider stay up front; other providers move behind
 * "More models", grouped so it is clear who serves each one. */

export default function ModelSelector() {
  const catalog = useChatStore((s) => s.catalog);
  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);

  const activeChatId = useChatStore((s) => s.activeChatId);
  const modelPickerRequests = useChatStore((s) => s.modelPickerRequests);
  const messageCount = useChatStore((s) =>
    activeChatId ? (s.messagesByChat[activeChatId]?.length ?? 0) : 0,
  );
  const inConversation = messageCount > 0;

  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const moreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreRowRef = useRef<HTMLButtonElement>(null);
  /** Fixed coordinates for the flyout, measured off the "More models" row.
   * The menu scrolls (overflow-y-auto), which clips an absolutely positioned
   * flyout, so from sm up it is rendered fixed like the menu itself. */
  const [morePos, setMorePos] = useState<{
    bottom: number;
    left?: number;
    right?: number;
  } | null>(null);

  /**
   * Chooses the flyout side: the preferred side first (right on the empty New
   * Chat screen, left once a conversation is on screen), then collision
   * detection — flip if it would not fit, and if neither side fits take the
   * roomier one.
   */
  function placeMore() {
    const rect = moreRowRef.current?.getBoundingClientRect();
    if (!rect) return;

    const width = FLYOUT_WIDTH;
    // The row is inset by the menu padding; the flyout clears that too.
    const spaceRight = window.innerWidth - rect.right - FLYOUT_OFFSET;
    const spaceLeft = rect.left - FLYOUT_OFFSET;
    const fitsRight = spaceRight >= width;
    const fitsLeft = spaceLeft >= width;
    const preferred: "left" | "right" = inConversation ? "left" : "right";

    const side: "left" | "right" =
      preferred === "right"
        ? fitsRight
          ? "right"
          : fitsLeft
            ? "left"
            : spaceRight >= spaceLeft
              ? "right"
              : "left"
        : fitsLeft
          ? "left"
          : fitsRight
            ? "right"
            : spaceLeft >= spaceRight
              ? "left"
              : "right";
    // Bottom edge aligned with the row it opens from, matching the in-menu look.
    setMorePos({
      bottom: window.innerHeight - rect.bottom,
      ...(side === "right"
        ? { left: rect.right + FLYOUT_OFFSET }
        : { right: window.innerWidth - rect.left + FLYOUT_OFFSET }),
    });
  }

  // Hover opens the flyout, but nothing closes it on mouse-out: the pointer has
  // to cross a gap and then scroll inside it, and a hover-out close made both
  // impossible. It closes on Escape, on picking a model, on toggling the row,
  // or on a click outside the menu.
  function cancelMoreClose() {
    if (moreTimer.current) clearTimeout(moreTimer.current);
  }

  useEffect(() => () => cancelMoreClose(), []);

  // Measured from the trigger and rendered fixed: the composer row and the
  // scrolling panes above it would otherwise clip an absolute menu.
  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // The menu hangs off the trigger's right edge. On a narrow screen that
    // pushes its left edge past the viewport, so the offset is also clamped so
    // the whole menu stays on screen with an 8px margin either side.
    const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
    const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    setAnchor({
      bottom: window.innerHeight - rect.top + 8,
      right: Math.min(Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right), maxRight),
    });
  }

  // "Change model" on a failed turn opens this menu, so the user picks another
  // model where they already pick one.
  useEffect(() => {
    if (!modelPickerRequests) return;
    place();
    setOpen(true);
  }, [modelPickerRequests]);

  useEffect(() => {
    if (!open) {
      setMoreOpen(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (moreOpen) setMoreOpen(false);
        else setOpen(false);
      }
    }
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, moreOpen]);

  // Only providers with a server-side key configured are offerable.
  const available = catalog.filter((p) => p.configured);
  const current =
    available.find((p) => p.id === provider)?.models.find((m) => m.id === model) ?? null;

  const label = current?.label ?? (catalog.length ? model : "Auto");

  const activeProvider = available.find((p) => p.id === provider) ?? available[0] ?? null;
  const otherProviders = available.filter((p) => p.id !== activeProvider?.id);

  function choose(providerId: string, modelId: string) {
    void setModel(providerId, modelId);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          place();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800 hover:text-neutral-100"
      >
        <span className="max-w-[45vw] truncate sm:max-w-[16rem]">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
      </button>

      {open && anchor && (
        <>
          <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Select a model"
            style={{ bottom: anchor.bottom, right: anchor.right }}
            className="fixed z-[70] max-h-[70dvh] w-[min(240px,calc(100vw-1rem))] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-ink-700 bg-ink-850 p-2 shadow-2xl animate-fade-in"
          >
            {available.length === 0 && (
              <p className="px-3 py-4 text-xs leading-relaxed text-neutral-500">
                No models are available right now. Please try again later.
              </p>
            )}

            {activeProvider && (
              <>
                <p className="px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                  {activeProvider.label}
                </p>
                <div className="space-y-0.5">
                {activeProvider.models.map((m) => (
                  <ModelOption
                    key={`${activeProvider.id}:${m.id}`}
                    model={m}
                    selected={activeProvider.id === provider && m.id === model}
                    onSelect={() => choose(activeProvider.id, m.id)}
                  />
                ))}
                </div>
              </>
            )}

            {otherProviders.length > 0 && (
              <div
                className="relative mt-2 border-t border-ink-800 pt-2"
                onMouseEnter={() => {
                  // Touch taps also emit mouseenter; let onClick own those.
                  if (!window.matchMedia("(hover: hover)").matches) return;
                  cancelMoreClose();
                  placeMore();
                  setMoreOpen(true);
                }}
              >
                <button
                  ref={moreRowRef}
                  type="button"
                  onClick={() => {
                    placeMore();
                    setMoreOpen((v) => !v);
                  }}
                  aria-expanded={moreOpen}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-neutral-200 transition",
                    moreOpen ? "bg-ink-800" : "hover:bg-ink-800",
                  )}
                >
                  <span className="flex-1">More models</span>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                </button>

                {moreOpen && (
                  <div
                    role="listbox"
                    aria-label="More models"
                    style={
                      {
                        "--flyout-offset": `${FLYOUT_OFFSET}px`,
                        "--flyout-bottom": `${morePos?.bottom ?? 0}px`,
                        "--flyout-left": morePos?.left != null ? `${morePos.left}px` : "auto",
                        "--flyout-right": morePos?.right != null ? `${morePos.right}px` : "auto",
                      } as React.CSSProperties
                    }
                    className={cn(
                      // Phones have no room beside the menu, so the flyout is
                      // an in-flow, scrollable list.
                      "mt-1.5 max-h-[45dvh] w-full overflow-y-auto overflow-x-hidden overscroll-contain",
                      // From sm up it is the sideways flyout: still one compact
                      // column, scrolled rather than spread across the screen.
                      // Its bottom edge aligns with the "More models" row it
                      // opens from. Fixed, not absolute: the menu scrolls, and
                      // an absolute flyout is clipped by that overflow.
                      "sm:fixed sm:z-[80] sm:bottom-[var(--flyout-bottom)] sm:left-[var(--flyout-left)] sm:right-[var(--flyout-right)] sm:mt-0 sm:max-h-[60dvh] sm:w-[15.5rem]",
                      "rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl animate-fade-in",
                    )}
                  >
                    {otherProviders.map((entry) => (
                      <div
                        key={entry.id}
                        className="border-ink-800 [&+&]:mt-1.5 [&+&]:border-t [&+&]:pt-1.5"
                      >
                        <p className="px-2 pb-0.5 pt-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                          {entry.label}
                        </p>
                        {entry.models.map((m) => {
                          const selected = entry.id === provider && m.id === model;
                          return (
                            <button
                              key={`${entry.id}:${m.id}`}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => choose(entry.id, m.id)}
                              className={cn(
                                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition",
                                selected ? "bg-ink-800" : "hover:bg-ink-800/70",
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] text-neutral-100">
                                  {m.label}
                                </span>
                                {m.description && (
                                  <span className="mt-0.5 block text-xs leading-snug text-neutral-500 line-clamp-2">
                                    {m.description}
                                  </span>
                                )}
                              </span>
                              {selected && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ModelOption({
  model,
  selected,
  hint,
  onSelect,
}: {
  model: ModelInfoLite;
  selected: boolean;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition",
        selected ? "bg-ink-800" : "hover:bg-ink-800/70",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-neutral-100">{model.label}</span>
        {(model.description || hint) && (
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {model.description ?? hint}
          </span>
        )}
      </span>
      {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
    </button>
  );
}
