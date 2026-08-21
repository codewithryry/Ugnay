import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** One turn, exactly as public.get_shared_chat returns it. */
interface SharedRow {
  chat_title: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/**
 * Public, read-only view of a shared conversation.
 *
 * Everything comes from `get_shared_chat`, a security-definer function that
 * returns only the title and the user/assistant turns of a link that has not
 * been revoked, up to its snapshot instant. No session is needed and none is
 * used, so a reader can never see anything else in the owner's account.
 */
export default async function SharedChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_chat", { share_slug: slug });

  if (error) {
    console.error("[ugnay] Could not read a shared conversation:", error);
    notFound();
  }

  const rows = (data ?? []) as SharedRow[];
  // A revoked, deleted or never-issued link returns nothing.
  if (rows.length === 0) notFound();

  return (
    <main className="min-h-[100dvh] bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <span className="font-display text-sm font-semibold tracking-tight text-neutral-100">
            Ugnay
          </span>
          <Link
            href="/login"
            className="rounded-full border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            Try Ugnay
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100 sm:text-3xl">
          {rows[0].chat_title}
        </h1>
        <p className="mt-2 text-xs text-neutral-600">
          A shared conversation. Read-only, and only the messages below are shared.
        </p>

        <div className="mt-10 space-y-8">
          {rows.map((row, index) => (
            <article key={`${row.created_at}-${index}`}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {row.role === "user" ? "User" : "Ugnay"}
              </p>
              {row.role === "user" ? (
                <p className="whitespace-pre-wrap break-words rounded-2xl bg-ink-900 px-4 py-3 text-sm leading-relaxed text-neutral-200">
                  {row.content}
                </p>
              ) : (
                <div className="prose-ugnay w-full min-w-0 max-w-none text-sm">
                  {/* No rehype-raw: HTML in the content stays escaped. */}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.content}</ReactMarkdown>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
