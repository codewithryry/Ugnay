"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "@/lib/help";
import { cn } from "@/lib/utils";

export default function FaqList() {
  // One answer open at a time keeps the page scannable on a phone.
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, index) => {
        const open = openIndex === index;
        return (
          <div
            key={item.question}
            className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900"
          >
            <h2>
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : index)}
                aria-expanded={open}
                aria-controls={`faq-answer-${index}`}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-ink-850 sm:px-5"
              >
                <span className="min-w-0 flex-1 text-sm text-neutral-100">{item.question}</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-neutral-500 transition-transform",
                    open && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            </h2>
            {open && (
              <p
                id={`faq-answer-${index}`}
                className="border-t border-ink-800 px-4 py-3.5 text-sm leading-relaxed text-neutral-400 sm:px-5"
              >
                {item.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
