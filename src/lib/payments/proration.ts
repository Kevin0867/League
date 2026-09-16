import "server-only";
import { getSeasonWeeks } from "@/lib/domain/seasonCalendar";
import { phoenixDateInput } from "@/lib/time";

// Season-fee proration. A player who joins after the season has started pays
// only for the weeks that remain: the full fee is spread evenly across the
// season's numbered weeks (12), so joining in week 2 costs 11/12, week 3 10/12,
// and so on. Week 1 (and anytime before the season opens) is the full price.
// The Thanksgiving break week isn't a numbered week, so it never counts.

export type SeasonWeekInfo = { currentWeek: number; totalWeeks: number; weeksRemaining: number };

/** Which numbered season week "today" falls in, and how many weeks remain
 *  (inclusive of the current week). Before the season starts → week 1. After it
 *  ends → the last week. */
export function seasonWeekInfo(calendar: unknown, on: Date = new Date()): SeasonWeekInfo {
  const weeks = getSeasonWeeks(calendar)
    .filter((w): w is { week: number; startISO: string; endISO: string; focus: string; kind: "practice" | "league" | "break" | "championship" } => typeof w.week === "number")
    .sort((a, b) => a.week - b.week);
  const totalWeeks = weeks.length || 12;
  const today = phoenixDateInput(on);
  // The first numbered week that hasn't ended yet is the current week; if today
  // is past every week, treat it as the final week.
  const upcoming = weeks.find((w) => today <= w.endISO);
  const currentWeek = upcoming ? upcoming.week : totalWeeks;
  const weeksRemaining = Math.max(1, Math.min(totalWeeks, totalWeeks - currentWeek + 1));
  return { currentWeek, totalWeeks, weeksRemaining };
}

export type ProratedFee = SeasonWeekInfo & { feeCents: number; prorated: boolean };

/** Prorate a full season fee to the weeks remaining as of `on`. Week 1 (or
 *  before the season opens) returns the full fee. */
export function proratedSeasonFee(fullCents: number, calendar: unknown, on: Date = new Date()): ProratedFee {
  const info = seasonWeekInfo(calendar, on);
  const prorated = info.weeksRemaining < info.totalWeeks;
  const feeCents = prorated ? Math.round((fullCents * info.weeksRemaining) / info.totalWeeks) : fullCents;
  return { ...info, feeCents, prorated };
}
