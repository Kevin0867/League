import "server-only";
import { prisma } from "@/lib/db";
import { DOW, isBookable } from "@/lib/domain/facilityWindows";
import { phoenixDateInput } from "@/lib/time";
import { toMin, addMinutesHHMM, phoenixHHMM } from "@/lib/domain/courtHold";

// The open-slot engine: given a coach, a facility, and a lesson length, return the
// times a player can book — the coach's availability MINUS everything already on
// their plate, intersected with a facility that has a free court at that time.
// All timekeeping is Phoenix wall-time (HH:MM strings + "YYYY-MM-DD" days).

export type LessonSlot = { day: string; startTime: string; endTime: string };

const MATCH_WINDOW = { start: "17:00", end: "21:30" };
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Iv = { s: number; e: number }; // minutes
function mergeIvs(ivs: Iv[]): Iv[] {
  const sorted = [...ivs].filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out: Iv[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else out.push({ ...iv });
  }
  return out;
}
function subtractIvs(base: Iv[], cut: Iv[]): Iv[] {
  let cur = mergeIvs(base);
  for (const c of cut) {
    const next: Iv[] = [];
    for (const b of cur) {
      if (c.e <= b.s || c.s >= b.e) { next.push(b); continue; } // no overlap
      if (c.s > b.s) next.push({ s: b.s, e: c.s });
      if (c.e < b.e) next.push({ s: c.e, e: b.e });
    }
    cur = next;
  }
  return cur;
}

function eachDay(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDay}T12:00:00Z`);
  const end = new Date(`${toDay}T12:00:00Z`);
  let guard = 0;
  while (d <= end && guard++ < 400) { out.push(phoenixDateInput(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export async function openLessonSlots(opts: {
  coachId: string;
  facilityId: string;
  lengthMin: number;
  fromDay: string;
  toDay: string;
  stepMin?: number;
  maxSlots?: number;
  /** Max slots surfaced per day, so later days in the range aren't starved. */
  perDayMax?: number;
}): Promise<LessonSlot[]> {
  const step = opts.stepMin ?? 30;
  const max = opts.maxSlots ?? 200;
  const facility = await prisma.facility.findUnique({
    where: { id: opts.facilityId },
    select: { courtCount: true, courtBlocks: true, blackoutDates: { select: { date: true } } },
  });
  if (!facility) return [];
  const blackoutDays = new Set(facility.blackoutDates.map((b) => phoenixDateInput(b.date)));

  const win = { start: new Date(`${opts.fromDay}T00:00:00Z`), end: new Date(`${opts.toDay}T00:00:00Z`) };
  win.start.setUTCDate(win.start.getUTCDate() - 1);
  win.end.setUTCDate(win.end.getUTCDate() + 2);

  const [avail, exceptions, holds, facSessions, facFixtures, coachLessons, coachSessions, busyBlocks] = await Promise.all([
    prisma.availabilityBlock.findMany({ where: { coachId: opts.coachId }, select: { dayOfWeek: true, startTime: true, endTime: true } }),
    prisma.availabilityException.findMany({ where: { coachId: opts.coachId, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true, kind: true } }),
    prisma.courtHold.findMany({ where: { facilityId: opts.facilityId, releasedAt: null, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true, courtCount: true } }),
    prisma.session.findMany({ where: { facilityId: opts.facilityId, status: { notIn: ["CANCELLED", "RESCHEDULED"] }, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true, courtCount: true } }),
    prisma.fixture.findMany({ where: { facilityId: opts.facilityId, status: { not: "CANCELLED" }, scheduledAt: { gte: win.start, lt: win.end } }, select: { scheduledAt: true } }),
    prisma.alaCarteBooking.findMany({ where: { coachId: opts.coachId, status: { notIn: ["CANCELLED", "DECLINED"] }, scheduledAt: { gte: win.start, lt: win.end } }, select: { scheduledAt: true, offering: { select: { lengthMin: true } } } }),
    prisma.session.findMany({ where: { coaches: { some: { coachId: opts.coachId } }, status: { notIn: ["CANCELLED", "RESCHEDULED"] }, date: { gte: win.start, lt: win.end } }, select: { date: true, startTime: true, endTime: true } }),
    // Phone-calendar busy-import (Phase 6): times the coach is committed elsewhere.
    prisma.coachBusyBlock.findMany({ where: { coachId: opts.coachId, endAt: { gte: win.start }, startAt: { lt: win.end } }, select: { startAt: true, endAt: true, allDay: true } }),
  ]);

  // Recurring availability by weekday.
  const availByDow = new Map<string, Iv[]>();
  for (const a of avail) {
    const arr = availByDow.get(a.dayOfWeek) ?? [];
    arr.push({ s: toMin(a.startTime), e: toMin(a.endTime) });
    availByDow.set(a.dayOfWeek, arr);
  }
  // Per-day OPEN/BLOCK exceptions.
  const openByDay = new Map<string, Iv[]>();
  const blockByDay = new Map<string, Iv[]>();
  const wholeDayBlock = new Set<string>();
  for (const e of exceptions) {
    const day = phoenixDateInput(e.date);
    if (e.kind === "OPEN" && e.startTime && e.endTime) {
      const arr = openByDay.get(day) ?? []; arr.push({ s: toMin(e.startTime), e: toMin(e.endTime) }); openByDay.set(day, arr);
    } else if (e.kind === "BLOCK") {
      if (!e.startTime) wholeDayBlock.add(day);
      else { const arr = blockByDay.get(day) ?? []; arr.push({ s: toMin(e.startTime), e: toMin(e.endTime ?? "23:59") }); blockByDay.set(day, arr); }
    }
  }

  // Court + coach busy intervals by day.
  const facHoldByDay = new Map<string, { iv: Iv; n: number }[]>();
  for (const h of holds) { const d = phoenixDateInput(h.date); const a = facHoldByDay.get(d) ?? []; a.push({ iv: { s: toMin(h.startTime), e: toMin(h.endTime) }, n: h.courtCount || 1 }); facHoldByDay.set(d, a); }
  const facSessByDay = new Map<string, { iv: Iv; n: number }[]>();
  for (const se of facSessions) { const d = phoenixDateInput(se.date); const a = facSessByDay.get(d) ?? []; a.push({ iv: { s: toMin(se.startTime), e: toMin(se.endTime) }, n: se.courtCount || 1 }); facSessByDay.set(d, a); }
  const matchDays = new Set(facFixtures.map((f) => phoenixDateInput(f.scheduledAt)));
  const coachBusyByDay = new Map<string, Iv[]>();
  const pushBusy = (day: string, iv: Iv) => { const a = coachBusyByDay.get(day) ?? []; a.push(iv); coachBusyByDay.set(day, a); };
  // Coach lessons: scheduledAt is a full datetime — derive its Phoenix HH:MM.
  for (const l of coachLessons) {
    if (!l.scheduledAt) continue;
    const day = phoenixDateInput(l.scheduledAt);
    const hhmm = phoenixHHMM(l.scheduledAt);
    const len = l.offering?.lengthMin ?? 60;
    pushBusy(day, { s: toMin(hhmm), e: toMin(hhmm) + len });
  }
  for (const se of coachSessions) pushBusy(phoenixDateInput(se.date), { s: toMin(se.startTime), e: toMin(se.endTime) });
  // Imported phone-calendar busy times: a UTC interval, possibly spanning days —
  // split it into each Phoenix day it touches so the day-based engine subtracts it.
  for (const bb of busyBlocks) {
    const startDay = phoenixDateInput(bb.startAt);
    const endDay = phoenixDateInput(bb.endAt);
    const cursor = new Date(`${startDay}T12:00:00Z`);
    const lastDay = new Date(`${endDay}T12:00:00Z`);
    for (let guard = 0; cursor <= lastDay && guard < 90; cursor.setUTCDate(cursor.getUTCDate() + 1), guard++) {
      const day = phoenixDateInput(cursor);
      const s = day === startDay ? toMin(phoenixHHMM(bb.startAt)) : 0;
      const e = day === endDay ? toMin(phoenixHHMM(bb.endAt)) : 1440;
      if (e > s) pushBusy(day, { s, e });
    }
  }

  const facCourts = facility.courtCount || 1;
  // Cap slots PER DAY so a coach with all-day availability early in the range
  // can't exhaust the overall cap before the engine ever reaches later days
  // (which is why a one-off extra day near the end used to never appear).
  const perDay = opts.perDayMax ?? 8;
  const slots: LessonSlot[] = [];

  for (const day of eachDay(opts.fromDay, opts.toDay)) {
    if (wholeDayBlock.has(day) || blackoutDays.has(day)) continue;
    const dow = DOW[new Date(`${day}T12:00:00Z`).getUTCDay()];
    const base = [...(availByDow.get(dow) ?? []), ...(openByDay.get(day) ?? [])];
    if (!base.length) continue;
    const available = subtractIvs(base, blockByDay.get(day) ?? []);
    const busy = coachBusyByDay.get(day) ?? [];
    const facHolds = facHoldByDay.get(day) ?? [];
    const facSess = facSessByDay.get(day) ?? [];

    let dayCount = 0;
    for (const w of available) {
      for (let t = w.s; t + opts.lengthMin <= w.e; t += step) {
        if (dayCount >= perDay) break;
        const c0 = t, c1 = t + opts.lengthMin;
        // Coach free?
        if (busy.some((b) => overlaps(c0, c1, b.s, b.e))) continue;
        // Facility open at this time?
        if (!isBookable(facility.courtBlocks, dow, toHHMM(c0)).ok) continue;
        // Match night?
        if (matchDays.has(day) && overlaps(c0, c1, toMin(MATCH_WINDOW.start), toMin(MATCH_WINDOW.end))) continue;
        // Court free?
        let used = 0;
        for (const h of facHolds) if (overlaps(c0, c1, h.iv.s, h.iv.e)) used += h.n;
        for (const s of facSess) if (overlaps(c0, c1, s.iv.s, s.iv.e)) used += s.n;
        if (used + 1 > facCourts) continue;
        slots.push({ day, startTime: toHHMM(c0), endTime: addMinutesHHMM(toHHMM(c0), opts.lengthMin) });
        dayCount++;
        if (slots.length >= max) return slots;
      }
      if (dayCount >= perDay) break;
    }
  }
  return slots;
}
