"use client";

import Link from "next/link";
import { TimeSelect } from "@/components/TimeSelect";
import { useState } from "react";
import { formatTime12 } from "@/lib/time";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Slot = { day: string; start: string; end: string };
type TeamRow = {
  id: string;
  name: string;
  market: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  facilityId: string | null;
};
type RowState = { facilityId: string; day: string; start: string };

/**
 * One-screen grid to set each team's practice facility + day/time and save all
 * at once. When a team's facility has availability windows, that row only offers
 * those slots (e.g. a court open Wed 4pm shows exactly that); facilities with no
 * windows keep free day/time entry. Blank cells leave a team's value unchanged.
 */
export function BulkScheduleEditor({
  ticket,
  teams,
  facilities,
  slotsByFacility,
}: {
  ticket: string;
  teams: TeamRow[];
  facilities: { id: string; name: string }[];
  slotsByFacility: Record<string, Slot[]>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(teams.map((t) => [t.id, { facilityId: t.facilityId ?? "", day: t.dayOfWeek ?? "", start: t.startTime ?? "" }]))
  );
  const [filled, setFilled] = useState<string | null>(null);

  const slotsFor = (facilityId: string) => slotsByFacility[facilityId] ?? [];
  const incomplete = teams.filter((t) => {
    const r = rows[t.id];
    return !r?.facilityId || !r?.day || !r?.start;
  }).length;

  function update(teamId: string, patch: Partial<RowState>) {
    setRows((prev) => {
      const next = { ...prev[teamId], ...patch };
      // If the (new) facility is constrained and the current day/start isn't a
      // valid slot, clear day/start so the admin re-picks from the slot list.
      const slots = slotsFor(next.facilityId);
      if (slots.length && !slots.some((s) => s.day === next.day && s.start === next.start)) {
        next.day = "";
        next.start = "";
      }
      return { ...prev, [teamId]: next };
    });
  }

  function fillFacility(facilityId: string, onlyBlank: boolean) {
    if (!facilityId) return;
    setRows((prev) => {
      const out = { ...prev };
      for (const t of teams) {
        if (onlyBlank && out[t.id].facilityId) continue;
        out[t.id] = { ...out[t.id], facilityId };
        const slots = slotsFor(facilityId);
        // A single-slot facility auto-fills the day/time; otherwise leave to pick.
        if (slots.length === 1) {
          out[t.id].day = slots[0].day;
          out[t.id].start = slots[0].start;
        } else if (slots.length && !slots.some((s) => s.day === out[t.id].day && s.start === out[t.id].start)) {
          out[t.id].day = "";
          out[t.id].start = "";
        }
      }
      return out;
    });
    setFilled(onlyBlank ? "Filled blank rows — review, then save." : "Filled all rows — review, then save.");
  }

  if (teams.length === 0) return null;

  return (
    <details className="card" open={incomplete > 0}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-semibold text-slate-900">
        <span>Set facility, day &amp; time in bulk</span>
        {incomplete > 0 ? (
          <span className="badge bg-amber-100 text-amber-800">{incomplete} still need it</span>
        ) : (
          <span className="badge bg-emerald-100 text-emerald-800">all set</span>
        )}
      </summary>

      <p className="mt-2 text-sm text-slate-500">
        Choose each team&apos;s facility, then its practice time. Facilities with set availability only offer their
        open times. Save once when you&apos;re done — blank cells leave a team unchanged. Generate practices on the{" "}
        <a href="/console/schedule" className="text-brand-700 underline">Schedule</a> page after.
      </p>

      {/* Quick fill — set one facility across teams that share a venue. */}
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-[12rem]">
          <label className="block text-xs font-medium text-slate-500">Facility</label>
          <select id="qfFacility" className="input py-1.5 text-sm" defaultValue="">
            <option value="">—</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}{slotsFor(f.id).length ? "" : " (no set times)"}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => fillFacility((document.getElementById("qfFacility") as HTMLSelectElement)?.value ?? "", true)} className="btn-secondary text-sm">Fill blank rows</button>
        <button type="button" onClick={() => fillFacility((document.getElementById("qfFacility") as HTMLSelectElement)?.value ?? "", false)} className="btn-secondary text-sm">Fill all rows</button>
        {filled && <span className="text-xs text-slate-500">{filled}</span>}
      </div>

      <form method="POST" action="/api/console/teams" className="mt-4">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="setSchedule" />
        <input type="hidden" name="teamIds" value={teams.map((t) => t.id).join(",")} />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-3">Team</th>
                <th className="pr-3">Facility</th>
                <th className="pr-3">Practice day / time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teams.map((t) => {
                const r = rows[t.id];
                const slots = slotsFor(r.facilityId);
                return (
                  <tr key={t.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/console/teams/${t.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline" title={`Open ${t.name}`}>{t.name}</Link>
                      {t.market && <span className="ml-1 text-xs text-slate-400">{t.market}</span>}
                    </td>
                    <td className="pr-3">
                      <select value={r.facilityId} onChange={(e) => update(t.id, { facilityId: e.target.value })} className="input py-1.5 text-sm">
                        <option value="">—</option>
                        {facilities.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-3">
                      {slots.length ? (
                        <select
                          value={r.day && r.start ? `${r.day}|${r.start}` : ""}
                          onChange={(e) => {
                            const [d, s] = e.target.value.split("|");
                            update(t.id, { day: d ?? "", start: s ?? "" });
                          }}
                          className="input py-1.5 text-sm"
                        >
                          <option value="">— pick a time —</option>
                          {slots.map((s, i) => (
                            <option key={i} value={`${s.day}|${s.start}`}>{s.day} · {formatTime12(s.start)}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex gap-1.5">
                          <select value={r.day} onChange={(e) => update(t.id, { day: e.target.value })} className="input py-1.5 text-sm">
                            <option value="">—</option>
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                          <TimeSelect value={r.start} onChange={(e) => update(t.id, { start: e.target.value })} className="input py-1.5 text-sm" />
                        </div>
                      )}
                    </td>
                    {/* Submitted values for this row */}
                    <input type="hidden" name={`facility_${t.id}`} value={r.facilityId} />
                    <input type="hidden" name={`day_${t.id}`} value={r.day} />
                    <input type="hidden" name={`time_${t.id}`} value={r.start} />
                  </tr>
                );
              })}
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
