"use client";
import { useMemo, useState } from "react";

// A self-contained day / week / month / year calendar. Events are passed in
// pre-formatted (the server does the timezone/label work); this component only
// lays them out and handles view + navigation state. Clicking an event follows
// its href (e.g. to the session, or an agenda anchor on the same page).

export type CalEvent = {
  id: string;
  /** Local calendar day, YYYY-MM-DD. */
  dateISO: string;
  /** Pre-formatted time label, e.g. "5:00 PM". */
  time: string;
  title: string;
  tone?: "practice" | "league" | "championship" | "other";
  /** Open substitute spots, shown as a small badge. */
  openSpots?: number;
  href?: string;
};

type View = "day" | "week" | "month" | "year";

const TONE: Record<string, string> = {
  practice: "bg-brand-100 text-brand-800 ring-brand-200",
  league: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  championship: "bg-amber-100 text-amber-900 ring-amber-200",
  other: "bg-slate-100 text-slate-700 ring-slate-200",
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(d, -d.getDay());
const sameDay = (a: Date, b: Date) => iso(a) === iso(b);

export function CalendarView({ events, initialView = "month", initialDateISO, todayISO }: { events: CalEvent[]; initialView?: View; initialDateISO?: string; todayISO?: string }) {
  const [view, setView] = useState<View>(initialView);
  // "Today" is the Phoenix calendar day (passed from the server), not the
  // viewer's device day — so the highlighted day and the Today button are always
  // correct in Arizona time regardless of where the person is signed in from.
  const todayRef = todayISO ? parse(todayISO) : new Date();
  const [focus, setFocus] = useState<Date>(() => (initialDateISO ? parse(initialDateISO) : todayISO ? parse(todayISO) : new Date()));
  const today = todayRef;

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) { const arr = m.get(e.dateISO) ?? []; arr.push(e); m.set(e.dateISO, arr); }
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [events]);

  const step = (dir: 1 | -1) => {
    const d = new Date(focus);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    setFocus(d);
  };

  const heading = view === "day" ? focus.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : view === "week" ? (() => { const s = startOfWeek(focus); const e = addDays(s, 6); return `${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getDate()}, ${e.getFullYear()}`; })()
    : view === "month" ? `${MONTHS[focus.getMonth()]} ${focus.getFullYear()}`
    : `${focus.getFullYear()}`;

  const Pill = ({ e }: { e: CalEvent }) => {
    const cls = `block truncate rounded px-1 py-0.5 text-[11px] ring-1 ${TONE[e.tone ?? "other"]}`;
    const label = <>{e.time} {e.title}{e.openSpots ? ` · ${e.openSpots} sub${e.openSpots === 1 ? "" : "s"}` : ""}</>;
    return e.href ? <a href={e.href} className={`${cls} hover:opacity-80`}>{label}</a> : <span className={cls}>{label}</span>;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50" aria-label="Previous">←</button>
          <button onClick={() => setFocus(todayISO ? parse(todayISO) : new Date())} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50">Today</button>
          <button onClick={() => step(1)} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50" aria-label="Next">→</button>
          <span className="ml-1 text-sm font-semibold text-slate-900">{heading}</span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          {(["day", "week", "month", "year"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 capitalize ${view === v ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {view === "month" && <MonthGrid focus={focus} today={today} byDay={byDay} Pill={Pill} onDay={(d) => { setFocus(d); setView("day"); }} />}
        {view === "week" && <WeekGrid focus={focus} today={today} byDay={byDay} Pill={Pill} />}
        {view === "day" && <DayList focus={focus} byDay={byDay} Pill={Pill} />}
        {view === "year" && <YearGrid focus={focus} today={today} byDay={byDay} onMonth={(d) => { setFocus(d); setView("month"); }} onDay={(d) => { setFocus(d); setView("day"); }} />}
      </div>
    </div>
  );
}

function MonthGrid({ focus, today, byDay, Pill, onDay }: { focus: Date; today: Date; byDay: Map<string, CalEvent[]>; Pill: (p: { e: CalEvent }) => React.ReactNode; onDay: (d: Date) => void }) {
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === focus.getMonth();
          const evs = byDay.get(iso(d)) ?? [];
          return (
            <div key={i} className={`min-h-[76px] rounded-lg border p-1 ${inMonth ? "border-slate-200" : "border-transparent bg-slate-50/40"}`}>
              <button onClick={() => onDay(d)} className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${sameDay(d, today) ? "bg-brand-600 font-bold text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-300"}`}>{d.getDate()}</button>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((e) => <Pill key={e.id} e={e} />)}
                {evs.length > 3 && <button onClick={() => onDay(d)} className="text-[10px] text-slate-400 hover:underline">+{evs.length - 3} more</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ focus, today, byDay, Pill }: { focus: Date; today: Date; byDay: Map<string, CalEvent[]>; Pill: (p: { e: CalEvent }) => React.ReactNode }) {
  const start = startOfWeek(focus);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {days.map((d, i) => {
        const evs = byDay.get(iso(d)) ?? [];
        return (
          <div key={i} className="rounded-lg border border-slate-200 p-2">
            <div className={`mb-1 text-xs font-semibold ${sameDay(d, today) ? "text-brand-700" : "text-slate-500"}`}>{DOW[d.getDay()]} {d.getDate()}</div>
            <div className="space-y-1">{evs.length ? evs.map((e) => <Pill key={e.id} e={e} />) : <span className="text-[11px] text-slate-300">—</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

function DayList({ focus, byDay, Pill }: { focus: Date; byDay: Map<string, CalEvent[]>; Pill: (p: { e: CalEvent }) => React.ReactNode }) {
  const evs = byDay.get(iso(focus)) ?? [];
  return (
    <div className="space-y-2">
      {evs.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nothing scheduled this day.</p> : evs.map((e) => (
        <div key={e.id} className="text-sm"><Pill e={e} /></div>
      ))}
    </div>
  );
}

function YearGrid({ focus, today, byDay, onMonth, onDay }: { focus: Date; today: Date; byDay: Map<string, CalEvent[]>; onMonth: (d: Date) => void; onDay: (d: Date) => void }) {
  const year = focus.getFullYear();
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(year, m, 1);
        const start = startOfWeek(first);
        const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
        return (
          <div key={m} className="rounded-lg border border-slate-200 p-2">
            <button onClick={() => onMonth(new Date(year, m, 1))} className="mb-1 text-xs font-semibold text-brand-700 hover:underline">{MONTHS[m]}</button>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] text-slate-300">{DOW.map((d) => <div key={d}>{d[0]}</div>)}</div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === m;
                const has = (byDay.get(iso(d)) ?? []).length > 0;
                if (!inMonth) return <div key={i} className="h-5" />;
                return (
                  <button
                    key={i}
                    onClick={() => onDay(d)}
                    title={has ? `${(byDay.get(iso(d)) ?? []).length} event(s)` : "Open this day"}
                    className={`flex h-5 items-center justify-center rounded text-[9px] hover:bg-brand-50 ${
                      sameDay(d, today) ? "bg-brand-600 font-bold text-white hover:bg-brand-600"
                      : has ? "bg-brand-100 font-semibold text-brand-700"
                      : "text-slate-500"
                    }`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
