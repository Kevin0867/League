"use client";

import { useState } from "react";

/** A read-only URL with a copy button — for pasting a feed link into a calendar app. */
export function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
        {value}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable — the text is still selectable */
          }
        }}
        className="btn-ghost shrink-0 text-xs"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
