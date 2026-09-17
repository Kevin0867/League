import { formatSessionDay, formatTime12 } from "@/lib/time";
import type { TeamEventItem } from "@/lib/domain/teamCalendar";

// Team-added calendar events: a collapsible "Add event" form (native POST) and a
// list of upcoming events showing who added them, with a delete control for the
// creator or staff. Server components — no client JS.

const ROLE_LABEL: Record<string, string> = { PLAYER: "player", COACH: "coach", ADMIN: "admin" };

export function AddTeamEventForm({ teamId, ticket, returnTo }: { teamId: string; ticket: string; returnTo: string }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="btn-secondary list-none cursor-pointer text-sm">+ Add a team event</summary>
      <p className="mt-2 text-xs text-slate-500">
        Add something to the team calendar — a team dinner, an extra hit, a social. Everyone on the team and the coach are notified.
      </p>
      <form method="POST" action="/api/team-calendar" className="mt-3 grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="addEvent" />
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="sm:col-span-2">
          <label className="label text-xs">Event</label>
          <input name="title" required maxLength={140} placeholder="e.g. Team dinner at Postino" className="input text-sm" />
        </div>
        <div>
          <label className="label text-xs">Date</label>
          <input name="date" type="date" required className="input text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label text-xs">Start</label>
            <input name="startTime" type="time" className="input text-sm" />
          </div>
          <div>
            <label className="label text-xs">End</label>
            <input name="endTime" type="time" className="input text-sm" />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label text-xs">Location (optional)</label>
          <input name="location" maxLength={200} placeholder="Where?" className="input text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="label text-xs">Details (optional)</label>
          <textarea name="description" maxLength={1000} rows={2} placeholder="Anything the team should know" className="input text-sm" />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <button className="btn-primary text-sm">Add event &amp; notify team</button>
        </div>
      </form>
    </details>
  );
}

export function TeamEventList({
  events,
  teamId,
  ticket,
  returnTo,
  canManage,
  householdIds = [],
}: {
  events: TeamEventItem[];
  teamId: string;
  ticket: string;
  returnTo: string;
  /** Coach/admin — may delete any event. */
  canManage: boolean;
  /** The viewer's own person ids — may delete events they created. */
  householdIds?: string[];
}) {
  if (events.length === 0) return null;
  return (
    <section className="card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Team events</h2>
      <ul className="space-y-3">
        {events.map((ev) => {
          const canDelete = canManage || (!!ev.createdByPersonId && householdIds.includes(ev.createdByPersonId));
          return (
            <li key={ev.id} id={`e-${ev.id}`} className="rounded-xl border border-slate-200 p-3 scroll-mt-20">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{ev.title}</div>
                  <div className="text-sm text-slate-500">
                    {formatSessionDay(ev.date, "long")}
                    {ev.startTime ? ` · ${formatTime12(ev.startTime)}${ev.endTime ? `–${formatTime12(ev.endTime)}` : ""}` : ""}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </div>
                  {ev.description && <p className="mt-1 text-sm text-slate-600">{ev.description}</p>}
                  <div className="mt-1 text-xs text-slate-400">
                    Added by {ev.createdByName ?? "someone"}
                    {ev.createdByRole ? ` (${ROLE_LABEL[ev.createdByRole] ?? ev.createdByRole.toLowerCase()})` : ""}
                  </div>
                </div>
                {canDelete && (
                  <form method="POST" action="/api/team-calendar">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="deleteEvent" />
                    <input type="hidden" name="teamId" value={teamId} />
                    <input type="hidden" name="eventId" value={ev.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="btn-chip-danger">Remove</button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
