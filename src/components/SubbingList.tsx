import Link from "next/link";
import { TeamColorDot } from "@/components/TeamColorDot";
import { formatSessionDay, formatTime12, phoenixDateInput } from "@/lib/time";
import type { SubSession } from "@/lib/domain/subbing";

// "You're subbing" cards — where to be, when, and one-tap directions, in
// next-practice order. Shown on the coach Today page and the player portal.
export function SubbingList({ sessions, coach = false }: { sessions: SubSession[]; coach?: boolean }) {
  if (sessions.length === 0) return null;
  const today = phoenixDateInput(new Date());
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">You&apos;re subbing</h2>
      {sessions.map((s) => {
        const isToday = phoenixDateInput(s.date) === today;
        return (
          <div key={s.sessionId} className={`card ${isToday ? "border-l-4 border-brand-500" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <TeamColorDot color={s.teamColor} size={12} />
                  {s.teamName}
                </div>
                <div className="mt-0.5 text-sm text-slate-600">
                  {isToday ? <span className="font-semibold text-brand-700">Today</span> : formatSessionDay(s.date, "long")}
                  {" · "}{formatTime12(s.startTime)}{s.endTime ? `–${formatTime12(s.endTime)}` : ""}
                  {s.facilityName ? ` · ${s.facilityName}` : ""}
                </div>
                {s.address && <div className="text-xs text-slate-400">{s.address}</div>}
                {coach && s.role === "SUBSTITUTE" && <div className="mt-1 text-xs font-medium text-amber-700">Covering as a substitute</div>}
              </div>
              {isToday && <span className="badge bg-brand-100 text-brand-800">Today</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.mapsUrl && (
                <a href={s.mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-chip-brand">📍 Directions</a>
              )}
              {coach && (
                <Link href={`/console/schedule/${s.sessionId}#attendance`} className="btn-chip-brand">Open class →</Link>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
