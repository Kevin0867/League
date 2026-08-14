"use client";

import { useMemo, useState } from "react";
import { formatTime12 } from "@/lib/time";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Slot = { day: string; start: string; end: string };

/**
 * Facility + practice day/time, wired together. When the chosen facility has
 * availability windows (CourtBlocks), the practice can only be set to one of
 * those windows — e.g. a court that's only open Wed 4pm shows exactly that.
 * A facility with no windows defined falls back to free day/time entry, so
 * nothing that worked before breaks.
 */
export function TeamScheduleFields({
  facilities,
  slotsByFacility,
  initialFacilityId,
  initialDay,
  initialStart,
}: {
  facilities: { id: string; name: string }[];
  slotsByFacility: Record<string, Slot[]>;
  initialFacilityId: string;
  initialDay: string;
  initialStart: string;
}) {
  const [facilityId, setFacilityId] = useState(initialFacilityId);
  const [day, setDay] = useState(initialDay);
  const [start, setStart] = useState(initialStart);

  const slots = slotsByFacility[facilityId] ?? [];
  const constrained = slots.length > 0;
  const facilityName = facilities.find((f) => f.id === facilityId)?.name ?? "this facility";

  // The currently-selected slot value, if it matches one of the facility's slots.
  const currentSlotVal = useMemo(() => {
    const match = slots.find((s) => s.day === day && s.start === start);
    return match ? `${match.day}|${match.start}` : "";
  }, [slots, day, start]);

  function onFacility(id: string) {
    setFacilityId(id);
    // If the new facility is constrained and the current slot isn't valid, clear it.
    const next = slotsByFacility[id] ?? [];
    if (next.length && !next.some((s) => s.day === day && s.start === start)) {
      setDay("");
      setStart("");
    }
  }

  return (
    <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="facilitySel">Facility</label>
          <select id="facilitySel" value={facilityId} onChange={(e) => onFacility(e.target.value)} className="input">
            <option value="">—</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}{(slotsByFacility[f.id]?.length ?? 0) > 0 ? "" : " (no set times)"}</option>
            ))}
          </select>
        </div>

        {constrained ? (
          <div>
            <label className="label" htmlFor="slotSel">Practice slot</label>
            <select
              id="slotSel"
              value={currentSlotVal}
              onChange={(e) => {
                const [d, s] = e.target.value.split("|");
                setDay(d ?? "");
                setStart(s ?? "");
              }}
              className="input"
            >
              <option value="">— pick an available time —</option>
              {slots.map((s, i) => (
                <option key={i} value={`${s.day}|${s.start}`}>
                  {s.day} · {formatTime12(s.start)}{s.end ? `–${formatTime12(s.end)}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Only {facilityName}&apos;s available times are shown.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="daySel">Day</label>
              <select id="daySel" value={day} onChange={(e) => setDay(e.target.value)} className="input">
                <option value="">—</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="startInp">Start</label>
              <input id="startInp" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input" />
            </div>
          </div>
        )}
      </div>

      {/* Submitted values */}
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="dayOfWeek" value={day} />
      <input type="hidden" name="startTime" value={start} />
    </div>
  );
}
