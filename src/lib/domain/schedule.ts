// Scheduling logic (§7). Generate the twelve-session season and apply the
// cancellation rules, which differ by session type.

import { WEEKDAYS } from "../enums";
import { isSeasonDark } from "./seasonCalendar";

const DAY_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function isSameDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function inBlackout(date: Date, blackouts: Date[]) {
  return blackouts.some((b) => isSameDay(b, date));
}

/** First occurrence of `dayOfWeek` on or after `from` (UTC). */
export function firstDateOnOrAfter(from: Date, dayOfWeek: string): Date {
  const target = DAY_INDEX[dayOfWeek] ?? 1;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12, 0, 0));
  let guard = 0;
  while (d.getUTCDay() !== target && guard++ < 8) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Generate `count` weekly practice dates on the team's day, starting from the
 * season start. Blackout weeks (e.g. Thanksgiving Nov 23–29) are dark, so a slot
 * that lands on a blackout is skipped and the season runs one week longer.
 */
export function generatePracticeDates(
  seasonStart: Date,
  dayOfWeek: string,
  count: number,
  blackouts: Date[]
): Date[] {
  const dates: Date[] = [];
  const cursor = firstDateOnOrAfter(seasonStart, dayOfWeek);
  let guard = 0;
  while (dates.length < count && guard++ < 60) {
    // Skip facility/global blackout days and the season-dark weeks (Thanksgiving
    // week, Dec 5–6) — a slot that lands on one is pushed to the next week.
    if (!inBlackout(cursor, blackouts) && !isSeasonDark(cursor)) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}

export type CancellationOutcome = {
  newStatus: "CANCELLED" | "RESCHEDULED";
  reschedule: boolean;
  refund: boolean;
  courtFeePayable: boolean;
  substituteWithinDays?: number;
  note: string;
};

/**
 * Cancellation handling by session type (§7):
 *  - Practice cancelled → CANCELLED, not rescheduled, no refund/credit, and no
 *    court fee payable at hourly sites.
 *  - League match / championship cancelled → RESCHEDULED, substitute block within
 *    14 days at the same rate.
 */
export function cancellationOutcome(sessionType: string): CancellationOutcome {
  if (sessionType === "LEAGUE_MATCH" || sessionType === "CHAMPIONSHIP") {
    return {
      newStatus: "RESCHEDULED",
      reschedule: true,
      refund: false,
      courtFeePayable: true,
      substituteWithinDays: 14,
      note: "League/championship cancellation must be rescheduled within 14 days at the same rate.",
    };
  }
  return {
    newStatus: "CANCELLED",
    reschedule: false,
    refund: false,
    courtFeePayable: false,
    note: "Practice cancellation: no reschedule, no refund or credit, and no court fee at hourly sites. The fee reserves a place on a team, not a session.",
  };
}

export const WEEKDAY_OPTIONS = WEEKDAYS;
