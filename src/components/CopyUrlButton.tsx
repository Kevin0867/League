"use client";

import { useState } from "react";

// Copies an absolute URL (e.g. a public video link) to the clipboard so a coach
// can paste it straight into a team text or email.
export function CopyUrlButton({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          window.prompt("Copy this link:", url);
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
