"use client";

// Admin cleanup: delete every PRACTICE dated before a chosen date — for
// pre-season phantom practices. Confirms before submitting (destructive).
export function PrunePracticesForm({ ticket, defaultBefore }: { ticket: string; defaultBefore: string }) {
  return (
    <form
      method="POST"
      action="/api/console/schedule"
      onSubmit={(e) => {
        const before = (e.currentTarget.elements.namedItem("before") as HTMLInputElement | null)?.value;
        if (!confirm(`Delete ALL practices dated before ${before || "the chosen date"}? This can't be undone (you can regenerate a team's practices afterward).`)) {
          e.preventDefault();
        }
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="deletePracticesBefore" />
      <input type="hidden" name="returnTo" value="/console/schedule" />
      <div>
        <label className="label text-xs">Delete practices before</label>
        <input name="before" type="date" defaultValue={defaultBefore} className="input py-1.5 text-sm" required />
      </div>
      <button className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700">Remove practices before this date</button>
    </form>
  );
}
