"use client";

import { useMemo, useState } from "react";

type Emergency = { name: string | null; relation: string | null; phone: string | null };
export type AttendancePlayer = {
  personId: string;
  name: string;
  status: string; // "" | PRESENT | ABSENT | EXCUSED
  emergency: Emergency[];
  guardianName: string | null;
  guardianPhone: string | null;
  medical: string | null;
  noAdult: boolean;
};

const OPTS = [
  { value: "PRESENT", label: "Present", on: "bg-emerald-600 text-white ring-emerald-600" },
  { value: "ABSENT", label: "Absent", on: "bg-rose-600 text-white ring-rose-600" },
  { value: "EXCUSED", label: "Excused", on: "bg-amber-500 text-white ring-amber-500" },
];

// Courtside attendance: every tap saves on its own, immediately, and says so —
// no separate Save step to forget, no lost roster when the coach gets pulled onto
// the court. Emergency + medical sit one tap under each name, where an incident
// happens. A sticky summary keeps the count and the save state in thumb reach.
export function AttendanceMarker({
  ticket,
  sessionId,
  players,
}: {
  ticket: string;
  sessionId: string;
  players: AttendancePlayer[];
}) {
  const [statuses, setStatuses] = useState<Record<string, string>>(
    () => Object.fromEntries(players.map((p) => [p.personId, p.status])),
  );
  const [rowState, setRowState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const markedCount = useMemo(() => Object.values(statuses).filter(Boolean).length, [statuses]);

  async function save(personId: string, status: string) {
    const prev = statuses[personId] ?? "";
    setStatuses((s) => ({ ...s, [personId]: status }));
    setRowState((r) => ({ ...r, [personId]: "saving" }));
    try {
      const body = new FormData();
      body.set("ticket", ticket);
      body.set("sessionId", sessionId);
      body.set("personId", personId);
      body.set("status", status);
      const res = await fetch("/api/console/attendance", { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; savedAt?: string };
      if (!res.ok || !json.ok) throw new Error("save failed");
      setRowState((r) => ({ ...r, [personId]: "saved" }));
      setLastSavedAt(json.savedAt ?? new Date().toISOString());
    } catch {
      // Roll the tap back so the UI never shows a save that didn't happen.
      setStatuses((s) => ({ ...s, [personId]: prev }));
      setRowState((r) => ({ ...r, [personId]: "error" }));
    }
  }

  function markAllPresent() {
    for (const p of players) {
      if (statuses[p.personId] !== "PRESENT") save(p.personId, "PRESENT");
    }
  }

  const savedLabel = lastSavedAt
    ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Nothing saved yet";

  return (
    <div className="card scroll-mt-4 lg:col-span-2" id="attendance">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Attendance</h2>
        <button type="button" onClick={markAllPresent} className="btn-secondary text-sm font-semibold">Everyone&apos;s here</button>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-slate-500">No roster on this session.</p>
      ) : (
        <ul className="divide-y divide-slate-100 pb-16 sm:pb-0">
          {players.map((p) => {
            const cur = statuses[p.personId] ?? "";
            const st = rowState[p.personId] ?? "idle";
            const hasSafety = p.emergency.length > 0 || !!p.guardianPhone || !!p.medical;
            return (
              <li key={p.personId} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {p.name}
                    {st === "saving" && <span className="text-xs font-normal text-slate-400">saving…</span>}
                    {st === "saved" && <span className="text-xs font-normal text-emerald-600">✓</span>}
                    {st === "error" && <span className="text-xs font-normal text-rose-600">retry</span>}
                  </span>
                  <div className="grid grid-cols-3 gap-1 sm:flex">
                    {OPTS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => save(p.personId, opt.value)}
                        aria-pressed={cur === opt.value}
                        className={`flex min-h-[44px] items-center justify-center rounded-lg px-3 text-center text-sm font-medium ring-1 ring-inset transition-colors sm:min-h-0 sm:py-1.5 sm:text-xs ${
                          cur === opt.value ? opt.on : "bg-slate-100 text-slate-600 ring-transparent hover:bg-slate-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {p.noAdult ? (
                  <p className="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                    ⚠ No guardian or emergency contact on file — no one to call. Add one in the player&apos;s details.
                  </p>
                ) : hasSafety ? (
                  <details className="mt-1.5">
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-rose-700">🚑 Emergency &amp; medical</summary>
                    <div className="mt-1.5 space-y-1.5 rounded-md bg-rose-50/60 p-2.5 text-xs text-slate-700">
                      {p.emergency.map((e, i) => (
                        <div key={i}>
                          <span className="font-semibold">{e.name || "Emergency contact"}</span>{e.relation ? ` (${e.relation})` : ""} ·{" "}
                          {e.phone ? <a href={`tel:${e.phone}`} className="font-medium text-brand-700 underline">{e.phone}</a> : <span className="text-slate-400">no number</span>}
                        </div>
                      ))}
                      {p.guardianPhone && (
                        <div>
                          <span className="font-semibold">{p.guardianName || "Parent/guardian"}</span> ·{" "}
                          <a href={`tel:${p.guardianPhone}`} className="font-medium text-brand-700 underline">{p.guardianPhone}</a>
                        </div>
                      )}
                      {p.medical && <div className="mt-1 border-t border-rose-100 pt-1"><span className="font-semibold">Medical:</span> {p.medical}</div>}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky summary on phones — count + save state in the thumb zone. */}
      {players.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-2.5 text-sm shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur sm:static sm:mt-3 sm:rounded-lg sm:border sm:px-3 sm:shadow-none">
          <span className="font-medium text-slate-700">{markedCount} of {players.length} marked</span>
          <span className="text-slate-500">{savedLabel}</span>
        </div>
      )}
    </div>
  );
}
