// Facility booking windows. A court block is either an AVAILABLE window (open
// for booking) or a BLOCKED window (recurring unavailable time). A day/time is
// bookable when it doesn't fall in a BLOCKED window and — if the facility
// defines any AVAILABLE windows — falls inside one. A facility with no
// AVAILABLE windows stays unconstrained (any day/time), for backward
// compatibility.

export type Window = { dayOfWeek: string; startTime: string; endTime: string; kind?: string | null };

/** Index 0 = Sunday, matching Date.getUTCDay(). */
export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function withinAnyWindow(windows: Window[], dow: string, startTime: string): boolean {
  return windows.some((b) => b.dayOfWeek === dow && startTime >= b.startTime && startTime <= b.endTime);
}

export function isBookable(
  blocks: Window[],
  dow: string,
  startTime: string,
): { ok: boolean; reason?: "blocked" | "outside" } {
  const blocked = blocks.filter((b) => b.kind === "BLOCKED");
  if (blocked.some((b) => b.dayOfWeek === dow && startTime >= b.startTime && startTime < b.endTime)) {
    return { ok: false, reason: "blocked" };
  }
  const available = blocks.filter((b) => (b.kind ?? "AVAILABLE") === "AVAILABLE");
  if (available.length && !withinAnyWindow(available, dow, startTime)) {
    return { ok: false, reason: "outside" };
  }
  return { ok: true };
}
