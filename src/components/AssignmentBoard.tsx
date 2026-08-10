"use client";

import Link from "next/link";
import { useState } from "react";

type Card = {
  registrationId: string;
  personId: string;
  name: string;
  waiver: boolean;
  rating: number | null;
  divisionName: string | null;
};

export type BoardColumn = {
  id: string;
  kind: "pool" | "team";
  title: string;
  subtitle?: string;
  cap: number | null;
  divisionId?: string | null;
  cards: Card[];
};

export function AssignmentBoard({ ticket, columns: initial }: { ticket: string; columns: BoardColumn[] }) {
  const [columns, setColumns] = useState<BoardColumn[]>(initial);
  const [dragging, setDragging] = useState<{ card: Card; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const isFull = (c: BoardColumn) => c.kind === "team" && c.cap != null && c.cards.length >= c.cap;

  async function persist(card: Card, dest: BoardColumn): Promise<boolean> {
    const fd = new FormData();
    fd.set("ticket", ticket);
    fd.set("personId", card.personId);
    fd.set("registrationId", card.registrationId);
    if (dest.kind === "team") {
      fd.set("op", "assignToTeam");
      fd.set("teamId", dest.id);
      fd.set("silent", "1");
    } else {
      fd.set("op", "repool");
      fd.set("divisionId", dest.divisionId ?? "");
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

    const snapshot = columns;
    setColumns((cols) =>
      cols.map((c) => {
        if (c.id === from) return { ...c, cards: c.cards.filter((x) => x.registrationId !== card.registrationId) };
        if (c.id === toId) return { ...c, cards: [...c.cards, card] };
        return c;
      })
    );
    setBusy(true);
    const ok = await persist(card, dest);
    setBusy(false);
    if (!ok) {
      setColumns(snapshot);
      setFlash("Couldn't save that move — try again.");
      setTimeout(() => setFlash(null), 2500);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span>Drag a player onto a team to assign, onto a pool to unassign, or between pools to change division.</span>
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
              over === col.id ? "border-brand-400 bg-brand-50" : col.kind === "team" ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                {col.kind === "team" && <span className="mr-1 text-brand-500">▦</span>}
                {col.title}
              </h3>
              <span className={`shrink-0 text-xs ${isFull(col) ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                {col.cap != null ? `${col.cards.length}/${col.cap}` : col.cards.length}
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
                    <Link
                      href={`/console/registrations/${card.registrationId}`}
                      draggable={false}
                      className="text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline"
                    >
                      {card.name}
                    </Link>
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
