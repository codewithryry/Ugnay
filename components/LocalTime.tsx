"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp in the reader's own timezone. Rendered as the plain ISO value on
 * the server and swapped after mount, because the server formats in its own
 * zone — which is rarely the visitor's.
 */
export default function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState(iso);

  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    );
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {text}
    </time>
  );
}
