"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accessible dialog shell: focus trap, Escape to close, backdrop click. */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hideHeader = false,
  hideClose = false,
  panelClassName = "max-w-2xl",
  contentClassName = "overflow-y-auto overscroll-contain px-4 py-5 sm:px-5",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Hide the default header when the content renders its own. */
  hideHeader?: boolean;
  /** Hide the X button; Escape and backdrop click still close. */
  hideClose?: boolean;
  /** Extra classes for the dialog panel (width, height). */
  panelClassName?: string;
  /** Padding/layout classes for the scrollable body. */
  contentClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    function focusables() {
      return Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    }

    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={hideHeader ? title : undefined}
        aria-labelledby={hideHeader ? undefined : "modal-title"}
        aria-describedby={description && !hideHeader ? "modal-description" : undefined}
        className={cn(
          // dvh, not vh: on mobile browsers vh includes the chrome, which
          // would push the footer off screen. pb-safe clears the home indicator.
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden overscroll-contain rounded-t-2xl border border-ink-700 bg-ink-900 pb-safe shadow-2xl sm:max-h-[92vh] sm:rounded-2xl sm:pb-0",
          panelClassName,
        )}
      >
        {!hideHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-4 sm:gap-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-base font-semibold text-neutral-100">
              {title}
            </h2>
            {description && (
              <p id="modal-description" className="mt-1 text-xs text-neutral-500">
                {description}
              </p>
            )}
          </div>
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="shrink-0 rounded-lg p-2 sm:p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        )}

        <div className={cn("min-h-0 flex-1", contentClassName)}>{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-800 px-4 py-3 sm:px-5 sm:py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
