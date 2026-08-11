"use client";

import { useRef, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmSubmit";

/**
 * Admin control to consolidate one division into another (adjacent bands or
 * school levels). Picks source → target explicitly, then confirms before the
 * teams and registrations are re-homed and the empty source is removed.
 */
export function ConsolidateDivisions({
  ticket,
  divisions,
}: {
  ticket: string;
  divisions: { id: string; name: string; teams: number }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState(false);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const canSubmit = !!source && !!target && source !== target;
  const nameOf = (id: string) => divisions.find((d) => d.id === id)?.name ?? "—";

  return (
    <>
      <form ref={formRef} method="POST" action="/api/console/setup" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="consolidateDivisions" />
        <input type="hidden" name="returnTo" value="/console/calendar" />
        <div>
          <label className="label">Move this…</label>
          <select name="sourceId" value={source} onChange={(e) => setSource(e.target.value)} className="input text-sm">
            <option value="">—</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.teams})</option>)}
          </select>
        </div>
        <span className="pb-2 text-slate-400">→</span>
        <div>
          <label className="label">…into this one</label>
          <select name="targetId" value={target} onChange={(e) => setTarget(e.target.value)} className="input text-sm">
            <option value="">—</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.teams})</option>)}
          </select>
        </div>
        <button type="button" disabled={!canSubmit} onClick={() => setAsking(true)} className="btn-secondary text-sm disabled:opacity-40">
          Consolidate
        </button>
      </form>
      <ConfirmModal
        open={asking}
        title="Consolidate divisions"
        danger
        confirmLabel="Consolidate"
        message={`Move all teams and registrations from "${nameOf(source)}" into "${nameOf(target)}", then remove "${nameOf(source)}"? This can't be undone automatically.`}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
