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
  level?: string;
  location?: string;
  subtitle?: string;
  cap: number | null;
  divisionId?: string | null;
  market?: string | null;
  cards: Card[];
};

export function AssignmentBoard({
  ticket,
  pools,
  teams,
}: {
  ticket: string;
  pools: BoardColumn[];
  teams: BoardColumn[];
}) {
  const [columns, setColumns] = useState<BoardColumn[]>([...pools, ...teams]);
  const [dragging, setDragging] = useState<{ card: Card; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Filter tiles by division/level/location or any player's name. Empty pools
  // stay visible when the box is clear.
  const matches = (col: BoardColumn) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      [col.title, col.level, col.location, col.subtitle].filter(Boolean).some((t) => t!.toLowerCase().includes(s)) ||
      col.cards.some((c) => c.name.toLowerCase().includes(s))
    );
  };

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
      fd.set("market", dest.market ?? "");
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

  const tile = (col: BoardColumn) => (
    <div
      key={col.id}
      onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
      onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
      onDrop={() => onDrop(col.id)}
      className={`flex w-56 flex-col self-start rounded-xl border p-3 transition-colors ${
        over === col.id ? "border-brand-400 bg-brand-50" : col.kind === "team" ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight text-slate-800">
          {col.kind === "team" && <span className="mr-1 text-brand-500">▦</span>}
          {col.title}
        </h3>
        <span className={`shrink-0 text-xs ${isFull(col) ? "font-semibold text-rose-600" : "text-slate-400"}`}>
          {col.cap != null ? `${col.cards.length}/${col.cap}` : col.cards.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {[col.level, col.location, col.subtitle].filter(Boolean).join(" · ")}
      </p>

      {col.cards.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {col.cards.map((card) => (
            <div
              key={card.registrationId}
              draggable
              onDragStart={() => setDragging({ card, from: col.id })}
              onDragEnd={() => setDragging(null)}
              className="cursor-grab rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm active:cursor-grabbing"
            >
              <div className="flex items-center justify-between gap-1">
                <Link
                  href={`/console/registrations/${card.registrationId}`}
                  draggable={false}
                  className="truncate text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline"
                >
                  {card.name}
                </Link>
                {!card.waiver && <span title="Waiver outstanding" className="shrink-0 text-xs text-amber-500">⚠</span>}
              </div>
              {card.rating != null && <div className="text-[11px] text-slate-400">DUPR {card.rating}</div>}
            </div>
          ))}
        </div>
      )}
      {over === col.id && col.cards.length === 0 && (
        <p className="mt-2 rounded-md border border-dashed border-brand-300 py-2 text-center text-[11px] text-brand-400">Drop here</p>
      )}
    </div>
  );

  const teamCols = columns.filter((c) => c.kind === "team" && matches(c));
  const poolCols = columns.filter((c) => c.kind === "pool" && matches(c));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by division, level, location, or player…"
            className="input w-80 py-1.5 pr-8 text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear filter"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-sm text-slate-400">{poolCols.length + teamCols.length} tiles</span>
        {busy && <span className="text-sm text-brand-600">saving…</span>}
        {flash && <span className="rounded bg-rose-50 px-2 py-0.5 text-sm text-rose-700">{flash}</span>}
      </div>
      <p className="text-sm text-slate-500">
        Drag a player onto a team to assign, onto a pool to unassign, or between pools to change division/location.
      </p>

      {teamCols.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Teams</h2>
          <div className="flex flex-wrap gap-3">{teamCols.map(tile)}</div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Pools</h2>
        <div className="flex flex-wrap gap-3">{poolCols.map(tile)}</div>
      </section>
    </div>
  );
}
