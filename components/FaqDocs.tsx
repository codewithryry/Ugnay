"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Search, Sparkles, X } from "lucide-react";
import { FAQ_SECTIONS } from "@/lib/help";
import { cn } from "@/lib/utils";

/** Other Help destinations, so the rail works like a real docs nav. */
const RELATED = [
  { href: "/release-notes", label: "Release notes", icon: Sparkles },
  { href: "/feedback", label: "Send feedback", icon: MessageSquare },
];

/**
 * The FAQ as a documentation page: a section rail on the left, the answers in
 * the middle, and an "On this page" list on the right. The rails are hidden on
 * narrow screens, where the page falls back to a single readable column.
 */
export default function FaqDocs() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(FAQ_SECTIONS[0].items[0].id);

  // Filtering narrows both the page and the rails, so a search never leaves a
  // link pointing at a heading that is no longer rendered.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_SECTIONS;
    return FAQ_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q),
      ),
    })).filter((section) => section.items.length > 0);
  }, [query]);

  const matchCount = sections.reduce((total, section) => total + section.items.length, 0);

  // Scroll spy: the topmost question inside the reading band is the active one.
  useEffect(() => {
    const ids = sections.flatMap((section) => section.items.map((item) => item.id));
    if (ids.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -62% 0px", threshold: 0 },
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  const activeSectionId =
    sections.find((section) => section.items.some((item) => item.id === activeId))?.id ??
    sections[0]?.id;

  return (
    <main className="min-h-[100dvh] bg-ink-950">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {/* The wordmark keeps the display face it has in the sidebar. */}
            <span className="hidden xs:inline">Back to</span>
            <span className="font-display font-semibold tracking-tight">Ugnay</span>
          </Link>

          <div className="relative ml-auto w-full max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the FAQ"
              aria-label="Search the FAQ"
              className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2 pl-9 pr-8 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-ink-600 focus:bg-ink-850"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 transition hover:text-neutral-200"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl gap-10 px-4 sm:px-6">
        {/* ------------------------------------------------ section rail */}
        <aside className="sticky top-[57px] hidden h-[calc(100dvh-57px)] w-56 shrink-0 overflow-y-auto py-10 lg:block">
          <nav aria-label="FAQ sections">
            {sections.map((section) => (
              <div key={section.id} className="mb-6">
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        aria-current={activeId === item.id ? "true" : undefined}
                        className={cn(
                          "block rounded-md px-3 py-1.5 text-[13px] leading-snug transition",
                          activeId === item.id
                            ? "bg-ink-850 font-medium text-neutral-100"
                            : "text-neutral-400 hover:bg-ink-900 hover:text-neutral-200",
                        )}
                      >
                        {item.question}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="mt-8 border-t border-ink-800 pt-5">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                More help
              </p>
              <ul className="space-y-0.5">
                {RELATED.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </aside>

        {/* ----------------------------------------------------- content */}
        <div className="min-w-0 flex-1 py-10 pb-24">
          <p className="text-sm font-medium text-neutral-500">Help & FAQ</p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-tight text-neutral-100 sm:text-[2.5rem]">
            Frequently asked questions
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400">
            The short answers to what people ask most about Ugnay. Anything missing?{" "}
            <Link href="/feedback" className="text-neutral-200 underline underline-offset-4 hover:text-neutral-100">
              Send it from the Feedback page
            </Link>
            .
          </p>

          {matchCount === 0 ? (
            <p className="mt-12 rounded-xl border border-ink-800 bg-ink-900 px-4 py-8 text-center text-sm text-neutral-500">
              Nothing matches “{query.trim()}”. Try another word, or send the question from the{" "}
              <Link href="/feedback" className="text-neutral-300 underline underline-offset-4">
                Feedback page
              </Link>
              .
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.id} id={section.id} className="mt-14 scroll-mt-24">
                <h2 className="border-b border-ink-800 pb-3 text-xl font-semibold tracking-tight text-neutral-100">
                  {section.title}
                </h2>
                {section.items.map((item) => (
                  <article key={item.id} id={item.id} className="mt-8 scroll-mt-24">
                    <h3 className="text-[15px] font-semibold text-neutral-100">{item.question}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
                      {item.answer}
                    </p>
                  </article>
                ))}
              </section>
            ))
          )}
        </div>

        {/* -------------------------------------------------- on this page */}
        <aside className="sticky top-[57px] hidden h-[calc(100dvh-57px)] w-52 shrink-0 overflow-y-auto py-10 xl:block">
          {matchCount > 0 && (
            <nav aria-label="On this page">
              <p className="pb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                On this page
              </p>
              <ul className="space-y-1 border-l border-ink-800">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={activeSectionId === section.id ? "true" : undefined}
                      className={cn(
                        "-ml-px block border-l py-1 pl-4 text-[13px] transition",
                        activeSectionId === section.id
                          ? "border-neutral-300 text-neutral-100"
                          : "border-transparent text-neutral-500 hover:border-ink-600 hover:text-neutral-300",
                      )}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      </div>
    </main>
  );
}
