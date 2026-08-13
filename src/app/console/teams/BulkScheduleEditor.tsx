"use client";

import { useRef, useState } from "react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type TeamRow = {
  id: string;
  name: string;
  market: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  facilityId: string | null;
};

/**
 * One-screen grid for setting each team's practice day, start time, and home
 * facility, then saving them all at once — the fast path from imported rosters
 * to a schedule you can generate. The quick-fill row copies a day/time/facility
 * onto every row (or only the blank ones) for teams that share a slot; you can
 * still tweak any individual row before saving. A blank cell leaves that team's
 * existing value untouched. Nothing is messaged to anyone — this is pure setup.
 */
export function BulkScheduleEditor({
  ticket,
  teams,
  facilities,
}: {
  ticket: string;
  teams: TeamRow[];
  facilities: { id: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const qDay = useRef<HTMLSelectElement>(null);
  const qTime = useRef<HTMLInputElement>(null);
  const qFac = useRef<HTMLSelectElement>(null);
  const [filled, setFilled] = useState<string | null>(null);

  const incomplete = teams.filter((t) => !t.dayOfWeek || !t.startTime || !t.facilityId).length;

  function fill(onlyBlank: boolean) {
    const f = formRef.current;
    if (!f) return;
    const d = qDay.current?.value ?? "";
    const t = qTime.current?.value ?? "";
    const fac = qFac.current?.value ?? "";
    if (!d && !t && !fac) {
      setFilled("Pick a day, time, or facility above first.");
      return;
    }
    for (const team of teams) {
      const dEl = f.elements.namedItem(`day_${team.id}`) as HTMLSelectElement | null;
      const tEl = f.elements.namedItem(`time_${team.id}`) as HTMLInputElement | null;
      const facEl = f.elements.namedItem(`facility_${team.id}`) as HTMLSelectElement | null;
      if (d && dEl && (!onlyBlank || !dEl.value)) dEl.value = d;
      if (t && tEl && (!onlyBlank || !tEl.value)) tEl.value = t;
      if (fac && facEl && (!onlyBlank || !facEl.value)) facEl.value = fac;
    }
    setFilled(onlyBlank ? "Filled blank rows — review, then save." : "Filled all rows — review, then save.");
  }

  if (teams.length === 0) return null;

  return (
    <details className="card" open={incomplete > 0}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-semibold text-slate-900">
        <span>Set day / time / facility in bulk</span>
        {incomplete > 0 ? (
          <span className="badge bg-amber-100 text-amber-800">{incomplete} still need it</span>
        ) : (
          <span className="badge bg-emerald-100 text-emerald-800">all set</span>
        )}
      </summary>

      <p className="mt-2 text-sm text-slate-500">
        Fill in each team&apos;s practice slot below and save once — no need to open every card. Blank cells
        leave a team&apos;s current value unchanged. Once teams have a day, time, and facility, generate their
        practices on the <a href="/console/schedule" className="text-brand-700 underline">Schedule</a> page.
      </p>

      {/* Quick fill — for teams that share a slot or facility. */}
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Day</label>
          <select ref={qDay} className="input py-1.5 text-sm" defaultValue="">
            <option value="">—</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Time</label>
          <input ref={qTime} type="time" className="input py-1.5 text-sm" />
        </div>
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500">Facility</label>
          <select ref={qFac} className="input py-1.5 text-sm" defaultValue="">
            <option value="">—</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => fill(true)} className="btn-secondary text-sm">Fill blank rows</button>
        <button type="button" onClick={() => fill(false)} className="btn-secondary text-sm">Fill all rows</button>
        {filled && <span className="text-xs text-slate-500">{filled}</span>}
      </div>

      <form ref={formRef} method="POST" action="/api/console/teams" className="mt-4">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="setSchedule" />
        <input type="hidden" name="teamIds" value={teams.map((t) => t.id).join(",")} />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-3">Team</th>
                <th className="pr-3">Day</th>
                <th className="pr-3">Time</th>
                <th className="pr-3">Facility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-800">{t.name}</span>
                    {t.market && <span className="ml-1 text-xs text-slate-400">{t.market}</span>}
                  </td>
                  <td className="pr-3">
                    <select name={`day_${t.id}`} defaultValue={t.dayOfWeek ?? ""} className="input py-1.5 text-sm">
                      <option value="">—</option>
                      {DAYS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </td>
                  <td className="pr-3">
                    <input name={`time_${t.id}`} type="time" defaultValue={t.startTime ?? ""} className="input py-1.5 text-sm" />
                  </td>
                  <td className="pr-3">
                    <select name={`facility_${t.id}`} defaultValue={t.facilityId ?? ""} className="input py-1.5 text-sm">
                      <option value="">—</option>
                      {facilities.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <button className="btn-primary">Save all</button>
        </div>
      </form>
    </details>
  );
}
