"use client";

import { useState } from "react";

type Card = {
  registrationId: string;
  personId: string;
  name: string;
  waiver: boolean;
  rating: number | null;
  divisionName: string | null;
};
type Column = { id: string; title: string; subtitle?: string; cap: number | null; cards: Card[] };

const POOL = "pool";

export function AssignmentBoard({ ticket, columns: initial }: { ticket: string; columns: Column[] }) {
  const [columns, setColumns] = useState<Column[]>(initial);
  const [dragging, setDragging] = useState<{ card: Card; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const teamCount = (c: Column) => c.cards.length;
  const isFull = (c: Column) => c.id !== POOL && c.cap != null && teamCount(c) >= c.cap;

  async function persist(card: Card, toId: string): Promise<boolean> {
    const fd = new FormData();
    fd.set("ticket", ticket);
    fd.set("personId", card.personId);
    fd.set("registrationId", card.registrationId);
    if (toId === POOL) {
      fd.set("op", "unassign");
    } else {
      fd.set("op", "assignToTeam");
      fd.set("teamId", toId);
      fd.set("silent", "1");
    }
    try {
      const res = await fetch("/api/console/registrations", { method: "POST", body: fd });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function onDrop(toId: string) {
    setOver(null);
    if (!dragging) return;
    const { card, from } = dragging;
    setDragging(null);
    if (from === toId) return;
    const dest = columns.find((c) => c.id === toId)!;
    if (isFull(dest)) {
      setFlash(`${dest.title} is full.`);
      setTimeout(() => setFlash(null), 2500);
      return;
    }

    // Optimistic move.
    const snapshot = columns;
    setColumns((cols) =>
      cols.map((c) => {
        if (c.id === from) return { ...c, cards: c.cards.filter((x) => x.registrationId !== card.registrationId) };
        if (c.id === toId) return { ...c, cards: [...c.cards, card] };
        return c;
      })
    );
    setBusy(true);
    const ok = await persist(card, toId);
    setBusy(false);
    if (!ok) {
      setColumns(snapshot); // revert
      setFlash("Couldn't save that move — try again.");
      setTimeout(() => setFlash(null), 2500);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span>Drag a player onto a team to assign, or back to the pool to unassign.</span>
        {busy && <span className="text-brand-600">saving…</span>}
        {flash && <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">{flash}</span>}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={() => onDrop(col.id)}
            className={`w-64 shrink-0 rounded-xl border p-3 ${
              over === col.id ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-slate-50"
            } ${col.id === POOL ? "sticky left-0 z-10" : ""}`}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-800">{col.title}</h3>
              <span className={`text-xs ${isFull(col) ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                {col.cap != null ? `${teamCount(col)}/${col.cap}` : col.cards.length}
              </span>
            </div>
            {col.subtitle && <p className="mb-2 -mt-1 text-xs text-slate-400">{col.subtitle}</p>}
            <div className="min-h-[60px] space-y-2">
              {col.cards.map((card) => (
                <div
                  key={card.registrationId}
                  draggable
                  onDragStart={() => setDragging({ card, from: col.id })}
                  onDragEnd={() => setDragging(null)}
                  className="cursor-grab rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm active:cursor-grabbing"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{card.name}</span>
                    {!card.waiver && <span title="Waiver outstanding" className="text-xs text-amber-500">⚠</span>}
                  </div>
                  <div className="text-xs text-slate-400">
                    {card.divisionName ?? "unplaced"}{card.rating != null ? ` · ${card.rating}` : ""}
                  </div>
                </div>
              ))}
              {col.cards.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-300">
                  Drop here
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
