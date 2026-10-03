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

        <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-brand-700">Where do I find this link? (Google, Apple, Outlook)</summary>
          <div className="space-y-3 border-t border-slate-100 px-3 py-3 text-xs text-slate-600">
            <p>You want the calendar&apos;s read-only <strong>&ldquo;secret&rdquo; / public subscribe link</strong> — a URL ending in <code className="rounded bg-slate-200 px-1">.ics</code> (or starting with <code className="rounded bg-slate-200 px-1">webcal://</code>). Copy it, paste it above, and Save. Do this on a computer — the links are easiest to copy from the web versions.</p>

            <div>
              <p className="font-semibold text-slate-800">Google Calendar</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Google Calendar</a> on a computer → gear icon → <strong>Settings</strong>.</li>
                <li>Under <strong>Settings for my calendars</strong>, click the calendar you want.</li>
                <li>Scroll to <strong>Integrate calendar</strong> and copy the <strong>Secret address in iCal format</strong> (ends in <code className="rounded bg-slate-200 px-1">basic.ics</code>).</li>
              </ol>
              <a href="https://support.google.com/calendar/answer/37648" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Google&apos;s help article →</a>
            </div>

            <div>
              <p className="font-semibold text-slate-800">Apple / iCloud Calendar</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>On <a href="https://www.icloud.com/calendar" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">iCloud.com → Calendar</a> (or the Calendar app), hover a calendar and click the <strong>share</strong> icon.</li>
                <li>Turn on <strong>Public Calendar</strong>.</li>
                <li>Click <strong>Copy Link</strong> (it starts with <code className="rounded bg-slate-200 px-1">webcal://</code>) and paste it above.</li>
              </ol>
              <a href="https://support.apple.com/guide/icloud/share-a-calendar-mm6b1a9479/icloud" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Apple&apos;s help article →</a>
            </div>

            <div>
              <p className="font-semibold text-slate-800">Outlook / Microsoft 365</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open <a href="https://outlook.live.com/calendar" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Outlook Calendar</a> on the web → <strong>Settings</strong> → <strong>Calendar</strong> → <strong>Shared calendars</strong>.</li>
                <li>Under <strong>Publish a calendar</strong>, pick your calendar and <strong>Can view all details</strong>, then <strong>Publish</strong>.</li>
                <li>Copy the <strong>ICS</strong> link and paste it above.</li>
              </ol>
              <a href="https://support.microsoft.com/en-us/office/introduction-to-publishing-internet-calendars-a25e68d6-695a-41c6-a701-103d44ba151d" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Microsoft&apos;s help article →</a>
            </div>

            <p className="text-slate-400">PURE refreshes the feed every couple of hours. New or removed events on your calendar update your blocked times automatically on the next sync.</p>
          </div>
        </details>
      </div>

      <button type="submit" className="btn-primary">Save availability</button>
    </form>
  );
}
