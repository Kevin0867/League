const TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
  blue: "bg-brand-100 text-brand-800",
  slate: "bg-slate-100 text-slate-700",
};

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
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "slate";
  return (
    <span className={`badge ${TONES[tone]}`}>{status.replace(/_/g, " ")}</span>
  );
}
