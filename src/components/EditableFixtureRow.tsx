"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { MATCH_TYPES } from "@/lib/domain/matchType";

const STATUSES = ["SCHEDULED", "CONFIRMED", "RESCHEDULED", "COMPLETED", "FORFEITED", "CANCELLED"];

// A small chip for the score-acceptance state, shown beside the status badge.
function ScoreChip({ scoreStatus }: { scoreStatus: string }) {
  if (scoreStatus === "PROPOSED") return <span className="badge bg-amber-100 text-amber-800">scores pending</span>;
  if (scoreStatus === "DISPUTED") return <span className="badge bg-rose-100 text-rose-800">disputed</span>;
  return null;
}

export function EditableFixtureRow({
  ticket,
  facilities,
  teams,
  fixture,
}: {
  ticket: string;
  facilities: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  fixture: {
    id: string;
    weekNumber: number;
    dateISO: string;
    timeHHMM: string;
    dateLabel: string;
    home: string;
    away: string;
    homeTeamId: string | null;
    awayTeamId: string | null;
    facilityId: string | null;
    facilityName: string;
    matchType: string;
    matchTypeShort: string;
    courtAllocation: string | null;
    scoreStatus: string;
    status: string;
  };
}) {
  const [edit, setEdit] = useState(false);

  if (!edit) {
    return (
      <tr className="hover:bg-slate-50">
        <td className="py-2 text-slate-500">{fixture.weekNumber}</td>
        <td className="hidden text-slate-700 sm:table-cell">{fixture.dateLabel}</td>
        <td className="text-slate-700">{fixture.home}</td>
        <td className="text-slate-700">{fixture.away}</td>
        <td className="hidden text-slate-500 lg:table-cell"><span className="badge bg-slate-100 text-slate-600">{fixture.matchTypeShort}</span></td>
        <td className="hidden text-slate-600 md:table-cell">{fixture.facilityName}</td>
        <td>
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge status={fixture.status} />
            <ScoreChip scoreStatus={fixture.scoreStatus} />
          </span>
        </td>
        <td className="whitespace-nowrap text-right">
          <button onClick={() => setEdit(true)} className="mr-3 text-xs font-medium text-brand-700 hover:underline">Edit</button>
          <Link href={`/console/league/${fixture.id}`} className="text-xs font-medium text-brand-600 hover:underline">match night →</Link>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-slate-50">
      <td className="py-2 text-slate-500">{fixture.weekNumber}</td>
      <td colSpan={7}>
        <form method="POST" action="/api/console/league" className="flex flex-wrap items-end gap-2 py-1">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="editFixture" />
          <input type="hidden" name="fixtureId" value={fixture.id} />
          <div>
            <label className="label text-xs">Home</label>
            <select name="homeTeamId" defaultValue={fixture.homeTeamId ?? ""} className="input py-1">
              <option value="">— TBD —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Away</label>
            <select name="awayTeamId" defaultValue={fixture.awayTeamId ?? ""} className="input py-1">
              <option value="">— TBD —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Date</label>
            <input name="scheduledAt" type="date" defaultValue={fixture.dateISO} className="input py-1" />
          </div>
          <div>
            <label className="label text-xs">Time</label>
            <input name="scheduledTime" type="time" defaultValue={fixture.timeHHMM} className="input py-1" />
          </div>
          <div>
            <label className="label text-xs">Hub</label>
            <select name="facilityId" defaultValue={fixture.facilityId ?? ""} className="input py-1">
              <option value="">— TBD —</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Courts</label>
            <input name="courtAllocation" defaultValue={fixture.courtAllocation ?? ""} placeholder="Courts 1–4" className="input py-1 w-28" />
          </div>
          <div>
            <label className="label text-xs">Type</label>
            <select name="matchType" defaultValue={fixture.matchType} className="input py-1">
              {MATCH_TYPES.map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Status</label>
            <select name="status" defaultValue={fixture.status} className="input py-1">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary py-1 text-xs">Save</button>
          <button type="button" onClick={() => setEdit(false)} className="btn-ghost py-1 text-xs">Cancel</button>
        </form>
      </td>
    </tr>
  );
}
