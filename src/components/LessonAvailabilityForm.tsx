"use client";

import { useState } from "react";
import { TimeSelect } from "@/components/TimeSelect";

type Block = { dayOfWeek: string; startTime: string; endTime: string };
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// A coach's weekly availability for lessons (recurring day/time windows) plus the
// subscribe link to their phone calendar. Saved wholesale via the lesson-offerings
// route. Mirrors the profile availability editor but scoped to the lessons page.
export function LessonAvailabilityForm({
  ticket,
  personId,
  initialBlocks,
  initialCalendarUrl,
}: {
  ticket: string;
  personId?: string;
  initialBlocks: Block[];
  initialCalendarUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks.length ? initialBlocks : [{ dayOfWeek: "MON", startTime: "", endTime: "" }]);

  return (
    <form method="POST" action="/api/console/lesson-offerings" className="space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="saveAvailability" />
      {personId && <input type="hidden" name="personId" value={personId} />}

      <div>
        <p className="text-sm font-medium text-slate-700">When you&apos;re available to teach (weekly)</p>
        <p className="mb-2 text-xs text-slate-500">Lessons are only offered to players inside these windows (minus anything already booked).</p>
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Day</label>
                <select value={b.dayOfWeek} name="availDay" onChange={(e) => setBlocks((bs) => bs.map((x, j) => j === i ? { ...x, dayOfWeek: e.target.value } : x))} className="input py-1">
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">From</label>
                <TimeSelect name="availStart" defaultValue={b.startTime} className="input py-1" />
              </div>
              <div>
                <label className="label">To</label>
                <TimeSelect name="availEnd" defaultValue={b.endTime} className="input py-1" />
              </div>
              {blocks.length > 1 && (
                <button type="button" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))} className="btn-chip-danger mb-1">remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setBlocks((bs) => [...bs, { dayOfWeek: "MON", startTime: "", endTime: "" }])} className="btn-secondary mt-2 text-sm">+ Add a window</button>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <label className="label" htmlFor="externalCalendarUrl">Connect your phone calendar (optional)</label>
        <p className="mb-1 text-xs text-slate-500">
          Paste the <strong>secret iCal / subscribe link</strong> from your Google, Apple, or Outlook calendar. PURE reads it on a
          schedule and automatically blocks times you&apos;re already busy — so lessons are never offered on top of your own plans. Read-only; we never change your calendar.
        </p>
        <input id="externalCalendarUrl" name="externalCalendarUrl" type="url" defaultValue={initialCalendarUrl} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className="input" />
      </div>

      <button type="submit" className="btn-primary">Save availability</button>
    </form>
  );
}
