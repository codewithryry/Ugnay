import LocalTime from "@/components/LocalTime";
import MaintenanceWatcher from "@/components/MaintenanceWatcher";
import { loadModelControls } from "@/lib/model-controls";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Temporarily unavailable" };

/**
 * Where everyone but an admin lands while the site switch in
 * Admin → Settings is on. Line-art illustration rather than flat fills, so it
 * stays legible on the dark surface; below the heading, only what the admin
 * configured — their message and, when set, the time the site is back.
 */
export default async function MaintenancePage() {
  const supabase = await createClient();
  const { settings } = await loadModelControls(supabase);

  const backAt = settings.siteBackAt ? new Date(settings.siteBackAt) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-6 py-12 pt-safe">
      <MaintenanceWatcher offline />
      <div className="w-full max-w-md text-center">
        <svg
          viewBox="0 0 200 120"
          role="img"
          aria-label="Servers under maintenance"
          className="mx-auto h-28 w-full max-w-[15rem] sm:h-36 sm:max-w-[18rem]"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Ground line */}
          <path d="M18 100h164" className="stroke-ink-700" strokeWidth="2" />

          {/* Server stack */}
          <g className="stroke-neutral-500" strokeWidth="2">
            <rect x="30" y="26" width="62" height="20" rx="5" className="fill-ink-900" />
            <rect x="30" y="52" width="62" height="20" rx="5" className="fill-ink-900" />
            <rect x="30" y="78" width="62" height="20" rx="5" className="fill-ink-900" />
          </g>
          <g className="fill-accent">
            <circle cx="80" cy="36" r="2.5" />
            <circle cx="80" cy="62" r="2.5" />
            <circle cx="80" cy="88" r="2.5" />
          </g>
          <g className="stroke-neutral-600" strokeWidth="2">
            <path d="M40 36h22M40 62h22M40 88h22" />
          </g>

          {/* Monitor */}
          <rect
            x="112"
            y="40"
            width="62"
            height="42"
            rx="6"
            className="fill-ink-900 stroke-neutral-500"
            strokeWidth="2"
          />
          <path d="M143 82v10M130 100h26" className="stroke-neutral-500" strokeWidth="2" />
          <path d="M122 56h20M122 66h30" className="stroke-neutral-600" strokeWidth="2" />

          {/* Cable between them */}
          <path
            d="M92 88c14 0 12-14 26-14"
            className="stroke-neutral-600"
            strokeWidth="2"
            strokeDasharray="3 5"
          />

          {/* Wrench, resting on the stack */}
          <g className="stroke-accent" strokeWidth="2.5">
            <path d="M104 16l-14 14" />
            <path d="M108.5 11.5a7 7 0 0 0-9 9l-3 3 3 3 3-3a7 7 0 0 0 9-9l-4 4-4-4 4-4z" />
          </g>
        </svg>

        <h1 className="mt-8 text-balance font-display text-2xl font-semibold tracking-tight text-neutral-100 sm:text-3xl">
          Ugnay is temporarily unavailable.
        </h1>

        {settings.siteMessage && (
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-400">
            {settings.siteMessage}
          </p>
        )}

        {backAt && (
          <p className="mt-4 text-sm text-neutral-500">
            Expected back by{" "}
            <LocalTime iso={backAt.toISOString()} className="text-neutral-300" />
          </p>
        )}
      </div>
    </main>
  );
}
