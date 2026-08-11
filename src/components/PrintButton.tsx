"use client";

// Opens the browser's print dialog (which also offers "Save as PDF"). Print CSS
// in globals.css hides the console chrome so only the content prints.
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost text-sm no-print" aria-label={label}>
      🖨 {label}
    </button>
  );
}
