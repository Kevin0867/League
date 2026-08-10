"use client";

import { useState } from "react";

// Copies an absolute URL built from the current origin + a relative path, so a
// shareable signup link works no matter which host the console is served from.
export function CopyLinkButton({ path, label = "Copy signup link" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        const url = `${window.location.origin}${path}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard blocked (e.g. insecure context) — fall back to a prompt.
          window.prompt("Copy this signup link:", url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
