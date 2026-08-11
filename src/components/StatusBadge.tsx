// One semantic color system, used everywhere:
//   green = good / done · amber = needs action · red = problem
//   blue  = active / published · slate = neutral / inactive
const TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
  blue: "bg-brand-100 text-brand-800",
  slate: "bg-slate-100 text-slate-700",
};

export type BadgeTone = keyof typeof TONES;

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  // agreements
  EXECUTED: "green",
  AGREEMENT_SENT: "amber",
  VERBAL: "amber",
  IDENTIFIED: "slate",
  // sessions / fixtures
  DELIVERED: "green",
  COMPLETED: "green",
  SCHEDULED: "blue",
  CONFIRMED: "green",
  CANCELLED: "red",
  RESCHEDULED: "amber",
  FORFEITED: "red",
  // registration
  ASSIGNED: "green",
  SUBMITTED: "blue",
  WAITLISTED: "amber",
  DUPLICATE: "amber",
  MERGED: "slate",
  WITHDRAWN: "slate",
  // availability
  PLAYING: "green",
  NOT_PLAYING: "red",
  UNCONFIRMED: "amber",
  // payments
  PAID: "green",
  REQUESTED: "amber",
  PENDING: "amber",
  FAILED: "red",
  REFUNDED: "slate",
  WAIVED: "blue",
  // teams / publication / general state
  PUBLISHED: "blue",
  READY: "green",
  BUILDING: "amber",
  ACTIVE: "blue",
  ARCHIVED: "slate",
  DISABLED: "red",
  // screening / compliance flags
  CLEARED: "green",
  COMPLETE: "green",
  INCOMPLETE: "amber",
  OUTSTANDING: "amber",
  SIGNED: "green",
  ON_FILE: "green",
  MISSING: "slate",
};

/**
 * The one status pill. Pass a known `status` (auto-toned/labeled) or override
 * with an explicit `tone` + `label` for concept flags — so every badge in the
 * app draws from the same five-color semantic system.
 */
export function StatusBadge({
  status,
  tone,
  label,
  title,
}: {
  status: string;
  tone?: BadgeTone;
  label?: string;
  title?: string;
}) {
  const resolved = tone ?? STATUS_TONE[status] ?? "slate";
  return (
    <span className={`badge ${TONES[resolved]}`} title={title}>
      {label ?? status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
