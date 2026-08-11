import type { ReactNode } from "react";

// One consistent, prominent alert used everywhere for success / error / warning
// / info. Errors get role="alert" so they're announced, a bold heading, and room
// for a "what to do next" line — so a user is never left wondering why something
// (a form, a payment) didn't go through.

type Kind = "error" | "success" | "warning" | "info";

const STYLES: Record<Kind, string> = {
  error: "border-rose-400 bg-rose-50 text-rose-800",
  success: "border-emerald-400 bg-emerald-50 text-emerald-800",
  warning: "border-amber-400 bg-amber-50 text-amber-800",
  info: "border-brand-400 bg-brand-50 text-brand-800",
};
const ICON: Record<Kind, string> = { error: "⚠️", success: "✓", warning: "⚠", info: "ℹ" };

export function Notice({
  kind,
  title,
  children,
}: {
  kind: Kind;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div role={kind === "error" ? "alert" : undefined} className={`rounded-lg border-l-4 px-4 py-3 ${STYLES[kind]}`}>
      {title && (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true">{ICON[kind]}</span>
          {title}
        </p>
      )}
      {children && <div className={`text-sm ${title ? "mt-1" : ""}`}>{children}</div>}
    </div>
  );
}
