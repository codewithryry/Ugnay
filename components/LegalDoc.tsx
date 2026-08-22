"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  HelpCircle,
  Info,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { LEGAL_UPDATED, type LegalDocument } from "@/lib/legal";
import { cn } from "@/lib/utils";
import { useHasSession } from "./useHasSession";

/** Renders the ISO date as e.g. "22 Aug 2026", like the release notes do. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The legal pages as documentation, laid out exactly like the FAQ: a clause
 * rail on the left, the document in the middle, and an "On this page" list on
 * the right. The rails drop away on narrow screens, where the page falls back
 * to a single readable column.
 */
export default function LegalDoc({
  doc,
  other,
  currentHref,
}: {
  doc: LegalDocument;
  /** The sibling legal page, linked from the rail and the foot of the page. */
  other?: { href: string; title: string };
  /** This page's own path, so the rail does not link back to itself. */
  currentHref?: string;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(doc.sections[0].id);
  // These pages open without a session, and the Feedback route does not: it
  // needs an account both to render and to accept a submission. So a guest is
  // never shown a link to it.
  const signedIn = useHasSession() === true;

  // Filtering narrows both the page and the rails, so a search never leaves a
  // link pointing at a clause that is no longer rendered.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doc.sections;
    return doc.sections.filter(
      (section) =>
        section.title.toLowerCase().includes(q) ||
        section.body.some((paragraph) => paragraph.toLowerCase().includes(q)) ||
        (section.points ?? []).some((point) => point.toLowerCase().includes(q)) ||
        (section.links ?? []).some((link) => link.label.toLowerCase().includes(q)),
    );
  }, [doc.sections, query]);

  // Scroll spy: the topmost clause inside the reading band is the active one.
  useEffect(() => {
    const ids = sections.map((section) => section.id);
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

  return (
    <main className="min-h-[100dvh] bg-ink-950">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85">
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
              placeholder={`Search ${doc.searchLabel ?? `the ${doc.title}`}`}
              aria-label={`Search ${doc.searchLabel ?? `the ${doc.title}`}`}
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
        {/* -------------------------------------------------- clause rail */}
        <aside className="sticky top-[57px] hidden h-[calc(100dvh-57px)] w-56 shrink-0 overflow-y-auto py-10 lg:block">
          <nav aria-label={`${doc.title} sections`}>
            <div className="mb-6">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {doc.title}
              </p>
              <ul className="space-y-0.5">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={activeId === section.id ? "true" : undefined}
                      className={cn(
                        "block rounded-md px-3 py-1.5 text-[13px] leading-snug transition",
                        activeId === section.id
                          ? "bg-ink-850 font-medium text-neutral-100"
                          : "text-neutral-400 hover:bg-ink-900 hover:text-neutral-200",
                      )}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 border-t border-ink-800 pt-5">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Elsewhere
              </p>
              <ul className="space-y-0.5">
                {other && (
                  <li>
                    <Link
                      href={other.href}
                      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 shrink-0 rotate-180" aria-hidden />
                      {other.title}
                    </Link>
                  </li>
                )}
                {currentHref !== "/about" && (
                <li>
                  <Link
                    href="/about"
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                  >
                    <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    About Ugnay
                  </Link>
                </li>
                )}
                <li>
                  <Link
                    href="/faq"
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                  >
                    <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Help & FAQ
                  </Link>
                </li>
                <li>
                  <Link
                    href="/release-notes"
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Release notes
                  </Link>
                </li>
                {signedIn && (
                  <li>
                    <Link
                      href="/feedback"
                      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-ink-900 hover:text-neutral-200"
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Send feedback
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          </nav>
        </aside>

        {/* ----------------------------------------------------- content */}
        <div className="min-w-0 flex-1 py-10 pb-24">
          <p className="text-sm font-medium text-neutral-500">{doc.eyebrow ?? "Legal"}</p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-tight text-neutral-100 sm:text-[2.5rem]">
            {doc.title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400">
            {doc.summary}
            {signedIn ? (
              <>
                {" "}
                Questions about any of it?{" "}
                <Link
                  href="/feedback"
                  className="text-neutral-200 underline underline-offset-4 hover:text-neutral-100"
                >
                  Send them from the Feedback page
                </Link>
                .
              </>
            ) : null}
          </p>
          {doc.dated && (
            <p className="mt-4 text-xs text-neutral-600">
              Last updated {formatDate(LEGAL_UPDATED)}
            </p>
          )}

          {sections.length === 0 ? (
            <p className="mt-12 rounded-xl border border-ink-800 bg-ink-900 px-4 py-8 text-center text-sm text-neutral-500">
              Nothing in the {doc.title} matches “{query.trim()}”. Try another word
              {signedIn ? (
                <>
                  , or ask from the{" "}
                  <Link href="/feedback" className="text-neutral-300 underline underline-offset-4">
                    Feedback page
                  </Link>
                </>
              ) : null}
              .
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.id} id={section.id} className="mt-14 scroll-mt-24">
                <h2 className="border-b border-ink-800 pb-3 text-xl font-semibold tracking-tight text-neutral-100">
                  {section.title}
                </h2>
                {section.body.map((paragraph, index) => (
                  <p
                    key={index}
                    className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400 [overflow-wrap:anywhere]"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.links && (
                  <ul className="mt-5 max-w-2xl space-y-2">
                    {section.links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 px-4 py-3 transition hover:border-ink-700"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-neutral-100">
                              {link.label}
                            </span>
                            {link.hint && (
                              <span className="block truncate text-xs text-neutral-500">
                                {link.hint}
                              </span>
                            )}
                          </span>
                          <ExternalLink
                            className="h-3.5 w-3.5 shrink-0 text-neutral-600 transition group-hover:text-neutral-400"
                            aria-hidden
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {section.points && (
                  <ul className="mt-4 max-w-2xl space-y-2">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-neutral-400">
                        <span
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-600"
                          aria-hidden
                        />
                        <span className="min-w-0">{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}

          {sections.length > 0 && (
            <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-ink-800 pt-8">
              {other && (
                <Link
                  href={other.href}
                  className="rounded-xl border border-ink-700 px-3.5 py-2 text-sm text-neutral-200 transition hover:bg-ink-850 hover:text-neutral-100"
                >
                  Read the {other.title}
                </Link>
              )}
              <Link
                href="/faq"
                className="rounded-xl px-3.5 py-2 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
              >
                Questions? See the FAQ
              </Link>
            </div>
          )}
        </div>

        {/* -------------------------------------------------- on this page */}
        <aside className="sticky top-[57px] hidden h-[calc(100dvh-57px)] w-52 shrink-0 overflow-y-auto py-10 xl:block">
          {sections.length > 0 && (
            <nav aria-label="On this page">
              <p className="pb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                On this page
              </p>
              <ul className="space-y-1 border-l border-ink-800">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={activeId === section.id ? "true" : undefined}
                      className={cn(
                        "-ml-px block border-l py-1 pl-4 text-[13px] transition",
                        activeId === section.id
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
