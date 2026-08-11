// The canonical PURE Academy / ACP season plan (§ season calendar). One source
// of truth for both the human-facing Season Calendar page and the scheduling
// generators, so a practice or league match never lands on a dark week.
//
// The 2026 season runs 12 weeks from the week of Sept 14. Two weekends are dark:
// Thanksgiving week (Nov 23–29) — no academy activity of any kind — and the
// Dec 5–6 weekend during the final league week.

export const SEASON_YEAR = 2026;

/// A division runs only with at least this many teams; short divisions are
/// consolidated with an adjacent band rather than cancelled.
export const DIVISION_MIN_TEAMS = 4;

export type WeekKind = "practice" | "league" | "break" | "championship";

export type WeekPlan = {
  /// Week number in the season, or null for the Thanksgiving break row.
  week: number | null;
  /// Inclusive date range (ISO, UTC) for the week.
  startISO: string;
  endISO: string;
  focus: string;
  milestone?: string;
  kind: WeekKind;
};

export const SEASON_WEEKS: WeekPlan[] = [
  { week: 1, startISO: "2026-09-14", endISO: "2026-09-20", focus: "Foundations and team formation — practices from Monday Sept 14, by team", milestone: "Baseline evaluation", kind: "practice" },
  { week: 2, startISO: "2026-09-21", endISO: "2026-09-27", focus: "Movement and court positioning", kind: "practice" },
  { week: 3, startISO: "2026-09-28", endISO: "2026-10-04", focus: "Dinking and the soft game", kind: "practice" },
  { week: 4, startISO: "2026-10-05", endISO: "2026-10-11", focus: "Third-shot strategy", milestone: "ACP divisions confirmed", kind: "practice" },
  { week: 5, startISO: "2026-10-12", endISO: "2026-10-18", focus: "Transition game", kind: "practice" },
  { week: 6, startISO: "2026-10-19", endISO: "2026-10-25", focus: "Mid-season evaluation and development reset", milestone: "Mid-season evaluation", kind: "practice" },
  { week: 7, startISO: "2026-10-26", endISO: "2026-11-01", focus: "ACP league night 1 — 4 courts, 2 hours, 16 players, 2 coaches", milestone: "League play begins", kind: "league" },
  { week: 8, startISO: "2026-11-02", endISO: "2026-11-08", focus: "ACP league night 2", milestone: "Standings published", kind: "league" },
  { week: 9, startISO: "2026-11-09", endISO: "2026-11-15", focus: "ACP league night 3", kind: "league" },
  { week: 10, startISO: "2026-11-16", endISO: "2026-11-22", focus: "ACP league night 4", kind: "league" },
  { week: null, startISO: "2026-11-23", endISO: "2026-11-29", focus: "Thanksgiving break — no academy activity of any kind. No practices, no ACP league matches, no makeup sessions.", kind: "break" },
  { week: 11, startISO: "2026-11-30", endISO: "2026-12-06", focus: "ACP league night 5 — final regular-season standings. No matches the weekend of Dec 5–6.", milestone: "Championship seedings confirmed", kind: "league" },
  { week: 12, startISO: "2026-12-07", endISO: "2026-12-13", focus: "ACP Championships — division events Mon Dec 7 to Fri Dec 11; Sat Dec 12 and Sun Dec 13 held in reserve", milestone: "Championship • Final evaluation • Winter invitations", kind: "championship" },
];

/// The weeks to show for a season: its stored, edited calendar if it has one,
/// otherwise the standard template. Accepts the raw Season.calendar JSON value.
export function getSeasonWeeks(calendar: unknown): WeekPlan[] {
  if (!Array.isArray(calendar)) return SEASON_WEEKS;
  const kinds: WeekKind[] = ["practice", "league", "break", "championship"];
  const rows = calendar
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
    .filter((w) => typeof w.startISO === "string" && typeof w.endISO === "string")
    .map((w) => ({
      week: typeof w.week === "number" ? w.week : null,
      startISO: String(w.startISO),
      endISO: String(w.endISO),
      focus: String(w.focus ?? ""),
      milestone: w.milestone ? String(w.milestone) : undefined,
      kind: kinds.includes(w.kind as WeekKind) ? (w.kind as WeekKind) : "practice",
    }));
  return rows.length ? rows : SEASON_WEEKS;
}

/// Dark days when nothing may be scheduled: the whole Thanksgiving week and the
/// Dec 5–6 weekend. Compared on the stored (UTC) calendar date.
export function isSeasonDark(d: Date): boolean {
  const y = d.getUTCFullYear();
  if (y !== SEASON_YEAR) return false;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (m === 10 && day >= 23 && day <= 29) return true; // Thanksgiving week, Nov 23–29
  if (m === 11 && (day === 5 || day === 6)) return true; // Dec 5–6 weekend
  return false;
}

/// Status of a week relative to `now` — for the "you are here" highlight.
export type WeekStatus = "past" | "current" | "upcoming";
export function weekStatus(w: WeekPlan, now: Date): WeekStatus {
  const start = new Date(`${w.startISO}T00:00:00Z`).getTime();
  const end = new Date(`${w.endISO}T23:59:59Z`).getTime();
  const t = now.getTime();
  if (t < start) return "upcoming";
  if (t > end) return "past";
  return "current";
}
