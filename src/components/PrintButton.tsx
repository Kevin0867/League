"use client";

// A print / save-as-PDF button. Hidden when the page is actually printed.
export function PrintButton({ label = "🖨️ Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary print:hidden">
      {label}
    </button>
  );
}
