"use client";

// Creating an ACP league makes it the active league immediately, so confirm the
// consequence up front (it caused real confusion during testing when a new
// league silently became active).
export function CreateLeagueForm({ ticket }: { ticket: string }) {
  return (
    <form
      method="POST"
      action="/api/console/league"
      className="grid gap-3 sm:grid-cols-4 sm:items-end"
      onSubmit={(e) => {
        if (!window.confirm("Create this league and make it your active ACP league? The active league is what appears across the app until you create another.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="createLeague" />
      <div className="sm:col-span-2">
        <label className="label">League name</label>
        <input name="name" className="input" placeholder="ACP Fall 2026" required />
      </div>
      <div>
        <label className="label">Start date</label>
        <input name="startDate" type="date" className="input" required />
      </div>
      <div>
        <label className="label">End date</label>
        <input name="endDate" type="date" className="input" required />
      </div>
      <div className="sm:col-span-4 flex items-center gap-2">
        <button className="btn-primary">Create new league</button>
        <span className="text-xs text-slate-400">Becomes the active ACP league immediately.</span>
      </div>
    </form>
  );
}
