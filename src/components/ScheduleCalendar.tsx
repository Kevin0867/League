import Link from "next/link";
import { formatTime12 } from "@/lib/time";

// Month-grid calendar for the schedule. Days are bucketed by their stored
// (UTC) calendar date to match how sessions are generated, so a session never
// lands on the wrong day. Session type drives the chip color.

export type CalSession = {
  id: string;
  date: Date;
  startTime: string;
  type: string;
  teamNames: string;
  facilityName: string;
};

const TYPE_CHIP: Record<string, string> = {
  PRACTICE: "bg-brand-100 text-brand-800",
  LEAGUE_MATCH: "bg-emerald-100 text-emerald-800",
  CHAMPIONSHIP: "bg-amber-100 text-amber-800",
  ALA_CARTE: "bg-slate-100 text-slate-700",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthParam(year: number, month0: number) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

export function ScheduleCalendar({ sessions, year, month }: { sessions: CalSession[]; year: number; month: number }) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();

  const byDay = new Map<number, CalSession[]>();
  for (const s of sessions) {
    const d = new Date(s.date);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
      const list = byDay.get(d.getUTCDate()) ?? [];
      list.push(s);
      byDay.set(d.getUTCDate(), list);
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = month === 0 ? monthParam(year - 1, 11) : monthParam(year, month - 1);
  const next = month === 11 ? monthParam(year + 1, 0) : monthParam(year, month + 1);
  const base = "/console/schedule?view=calendar&month=";

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`${base}${prev}`} className="btn-ghost text-sm">← {MONTHS[month === 0 ? 11 : month - 1]}</Link>
        <h2 className="font-semibold text-slate-900">{MONTHS[month]} {year}</h2>
        <Link href={`${base}${next}`} className="btn-ghost text-sm">{MONTHS[month === 11 ? 0 : month + 1]} →</Link>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-slate-200 text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-slate-50 py-1.5 text-center font-semibold text-slate-500">{w}</div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-[84px] bg-white p-1">
            {day && (
              <>
                <div className="mb-1 text-right text-[11px] text-slate-400">{day}</div>
                <div className="space-y-1">
                  {(byDay.get(day) ?? []).map((s) => (
                    <Link
                      key={s.id}
                      href={`/console/schedule/${s.id}`}
                      title={`${s.teamNames} · ${s.facilityName}`}
                      className={`block truncate rounded px-1 py-0.5 text-[11px] ${TYPE_CHIP[s.type] ?? "bg-slate-100 text-slate-700"} hover:opacity-80`}
                    >
                      {formatTime12(s.startTime)} {s.teamNames || "Session"}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-brand-400" /> Practice</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> League</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Championship</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> À la carte</span>
      </div>
    </div>
  );
}
