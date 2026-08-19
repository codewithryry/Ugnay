"use client";

import { cn } from "@/lib/utils";

export default function UserAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? "U").toUpperCase();

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar hosts vary; no loader configured.
    return (
      <img
        src={src}
        alt=""
        className={cn("h-8 w-8 shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-medium text-neutral-200",
        className,
      )}
    >
      {initial}
    </span>
  );
}
