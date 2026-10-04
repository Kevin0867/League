import { formatDate, formatTime12, phoenixDateInput } from "@/lib/time";
import { phoenixHHMM } from "@/lib/domain/courtHold";

// Reschedule / relocate / cancel controls for one booked lesson. Used on the
// coach "My lessons" page and the admin lessons console. Native <form> posts to
// /api/console/lessons (no JS). `isAdmin` unlocks the refund-on-cancel option.

export type ManageBooking = {
  id: string;
  scheduledAt: Date | null;
  facilityId: string | null;
  offeringTitle: string | null;
  clientName: string;
  coachName?: string | null;
  status: string;
};

export function LessonManageControls({
  booking, facilities, ticket, returnTo, isAdmin,
}: {
  booking: ManageBooking;
  facilities: { id: string; name: string }[];
  ticket: string;
  returnTo: string;
  isAdmin: boolean;
}) {
  const day = booking.scheduledAt ? phoenixDateInput(booking.scheduledAt) : "";
  const time = booking.scheduledAt ? phoenixHHMM(booking.scheduledAt) : "";
  const when = booking.scheduledAt
    ? `${formatDate(new Date(`${phoenixDateInput(booking.scheduledAt)}T12:00:00Z`))} · ${formatTime12(phoenixHHMM(booking.scheduledAt))}`
    : "time TBD";

  return (
    <details className="mt-2 rounded-lg border border-slate-200">
      <summary className="btn-chip-muted m-2 inline-flex cursor-pointer list-none text-xs font-semibold [&::-webkit-details-marker]:hidden">Manage lesson</summary>
      <div className="space-y-3 border-t border-slate-100 p-3">
        {/* Reschedule / relocate */}
        <form method="POST" action="/api/console/lessons" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="reschedule" />
          <input type="hidden" name="bookingId" value={booking.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div>
            <label className="label text-xs">New date</label>
            <input name="day" type="date" defaultValue={day} required className="input py-1 text-sm" />
          </div>
          <div>
            <label className="label text-xs">New time</label>
            <input name="time" type="time" defaultValue={time} required className="input py-1 text-sm" />
          </div>
          <div>
            <label className="label text-xs">Location</label>
            <select name="facilityId" defaultValue={booking.facilityId ?? ""} className="input py-1 text-sm">
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button className="btn-secondary text-xs">Move lesson</button>
        </form>
        <p className="text-[11px] text-slate-400">Currently {when}. Moving it re-checks the court and notifies the player{isAdmin ? " and coach" : ""} and the office.</p>

        {/* Cancel (+ optional refund for admins) */}
        <form method="POST" action="/api/console/lessons" className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="cancel" />
          <input type="hidden" name="bookingId" value={booking.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {isAdmin && (
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" name="refund" value="1" /> Refund the card
            </label>
          )}
          <button className="btn-chip-danger">Cancel lesson</button>
        </form>
      </div>
    </details>
  );
}
