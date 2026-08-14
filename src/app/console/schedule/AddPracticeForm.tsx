"use client";

import { useMemo, useState } from "react";
import { formatTime12 } from "@/lib/time";

type Slot = { day: string; start: string; end: string };
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * One-off practice (make-up or extra). When the chosen facility publishes
 * availability windows, the form shows exactly which days/times it's open and
 * warns the moment the picked date + start time falls outside them — the same
 * court-availability rule the team scheduler uses, applied to a single date.
 */
export function AddPracticeForm({
  ticket,
  teams,
  facilities,
  facilitySlots,
}: {
  ticket: string;
  teams: { id: string; name: string; facilityId: string | null }[];
  facilities: { id: string; name: string }[];
  facilitySlots: Record<string, Slot[]>;
}) {
  const [teamId, setTeamId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [facilityId, setFacilityId] = useState("");

  // The facility actually used: the explicit pick, else the team's home facility.
  const teamFacilityId = teams.find((t) => t.id === teamId)?.facilityId ?? "";
  const effectiveFacilityId = facilityId || teamFacilityId;
  const slots = facilitySlots[effectiveFacilityId] ?? [];
  const facilityName = facilities.find((f) => f.id === effectiveFacilityId)?.name ?? "the facility";

  // Weekday of the chosen date (dates are plain YYYY-MM-DD → parse as UTC).
  const weekday = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    const d = new Date(`${date}T12:00:00Z`);
    return WD[d.getUTCDay()] ?? "";
  }, [date]);

  // Does the picked date + start time fall inside one of the facility's windows?
  const inWindow = useMemo(() => {
    if (!slots.length) return true; // unconstrained facility
    if (!weekday || !start) return true; // nothing to check yet
    return slots.some((s) => s.day === weekday && start >= s.start && start <= s.end);
  }, [slots, weekday, start]);

  const showWarning = slots.length > 0 && !!weekday && !!start && !inWindow;

  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-slate-900">Add a practice</summary>
      <p className="mt-1 text-sm text-slate-500">
        A one-off practice — a make-up or an extra session. Time and location default to the team&apos;s, and the
        team is notified unless you turn that off.
      </p>
      <form method="POST" action="/api/console/schedule" className="mt-3 grid gap-3 sm:grid-cols-6 sm:items-end">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="addSession" />
        <input type="hidden" name="returnTo" value="/console/schedule" />
        <div className="sm:col-span-2">
          <label className="label">Team</label>
          <select name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input" required>
            <option value="">— choose team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Start</label>
          <input name="startTime" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">End</label>
          <input name="endTime" type="time" className="input" />
        </div>
        <div className="sm:col-span-3">
          <label className="label">Facility</label>
          <select name="facilityId" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="input">
            <option value="">Team&apos;s facility</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}{facilitySlots[f.id]?.length ? "" : " (no set times)"}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
          <input type="checkbox" name="notify" value="1" defaultChecked />
          Notify the team
        </label>
        <div className="sm:col-span-1">
          <button className="btn-primary w-full">Add practice</button>
        </div>

        {/* Availability guidance for the chosen facility. */}
        {slots.length > 0 && (
          <div className={`sm:col-span-6 rounded-lg border p-2.5 text-sm ${showWarning ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            <span className="font-medium">{facilityName} is open:</span>{" "}
            {slots.map((s, i) => (
              <span key={i} className="mr-2 inline-block">
                {s.day} {formatTime12(s.start)}–{formatTime12(s.end)}
              </span>
            ))}
            {showWarning && (
              <div className="mt-1 font-medium">
                {weekday} {formatTime12(start)} is outside those hours — the practice won&apos;t be saved until it&apos;s within a window.
              </div>
            )}
          </div>
        )}
      </form>
    </details>
  );
}
