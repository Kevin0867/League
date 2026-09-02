"use client";

// Admin form to send someone an apparel-only order link — no fixed amount; the
// family picks their T-shirts/tanks and sees the total at checkout. Emails a
// secure Stripe pay link to the public apparel picker.
export function ApparelRequestForm({
  ticket,
  personId,
  returnTo,
  defaults,
}: {
  ticket: string;
  personId?: string;
  returnTo: string;
  defaults?: { name?: string; email?: string };
}) {
  return (
    <form method="POST" action="/api/console/payments" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="apparelRequest" />
      <input type="hidden" name="returnTo" value={returnTo} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      {defaults?.name && <input type="hidden" name="name" value={defaults.name} />}
      <div className="min-w-0 flex-1">
        <label className="label">Send the apparel link to</label>
        <input name="email" type="email" required className="input" defaultValue={defaults?.email} placeholder="email@example.com" />
      </div>
      <button className="btn-primary whitespace-nowrap">Send apparel link</button>
    </form>
  );
}
