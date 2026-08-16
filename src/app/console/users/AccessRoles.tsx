"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { ROLE_LABELS, type Role } from "@/lib/enums";

// Access role editing used to be a Save button on every row. Now each row's
// checkboxes write to a shared dirty set and one sticky bar saves (or discards)
// all changed rows in a single POST.

type RolesState = Record<string, string[]>; // userId -> chosen role codes

type Ctx = {
  initial: RolesState;
  state: RolesState;
  ticket: string;
  toggle: (userId: string, role: string, on: boolean) => void;
};

const AccessCtx = createContext<Ctx | null>(null);

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function AccessRolesProvider({
  initial,
  ticket,
  children,
}: {
  initial: RolesState;
  ticket: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<RolesState>(initial);
  const toggle = (userId: string, role: string, on: boolean) =>
    setState((p) => {
      const cur = new Set(p[userId] ?? []);
      if (on) cur.add(role);
      else cur.delete(role);
      return { ...p, [userId]: [...cur] };
    });

  const dirtyIds = Object.keys(state).filter((id) => !sameSet(state[id] ?? [], initial[id] ?? []));
  const changesJson = JSON.stringify(dirtyIds.map((id) => ({ userId: id, roles: state[id] ?? [] })));

  return (
    <AccessCtx.Provider value={{ initial, state, ticket, toggle }}>
      {children}
      {dirtyIds.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-4">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 shadow-lg">
            <span className="text-sm font-medium text-slate-700">
              {dirtyIds.length} unsaved role change{dirtyIds.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setState(initial)} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                Discard
              </button>
              <form method="POST" action="/api/console/users">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="setRolesBulk" />
                <input type="hidden" name="changes" value={changesJson} />
                <button type="submit" className="btn-primary py-1.5 text-sm">
                  Save {dirtyIds.length} change{dirtyIds.length === 1 ? "" : "s"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </AccessCtx.Provider>
  );
}

export function RoleCell({ userId, assignable }: { userId: string; assignable: Role[] }) {
  const ctx = useContext(AccessCtx);
  const chosen = useMemo(() => new Set(ctx?.state[userId] ?? []), [ctx?.state, userId]);
  const dirty = ctx ? !sameSet(ctx.state[userId] ?? [], ctx.initial[userId] ?? []) : false;
  if (!ctx) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg ${dirty ? "ring-2 ring-amber-400" : ""} p-0.5`}>
      {assignable.map((r) => {
        const on = chosen.has(r);
        return (
          <label key={r} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => ctx.toggle(userId, r, e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
      {dirty && <span className="text-[11px] font-medium text-amber-700">unsaved</span>}
    </div>
  );
}
