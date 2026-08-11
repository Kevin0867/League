"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";

// Portal checkout buttons with a pending state, so a parent can't double-submit
// a real payment and always sees that checkout is starting.
export function PayButtons({ ticket, paymentId, amountCents }: { ticket: string; paymentId: string; amountCents: number }) {
  const [pending, setPending] = useState<null | "full" | "installments">(null);
  const per = formatCents(Math.round(amountCents / 3));

  return (
    <form method="POST" action="/api/portal" className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="startCheckout" />
      <input type="hidden" name="paymentId" value={paymentId} />
      <button
        name="plan"
        value="full"
        disabled={!!pending}
        onClick={() => setPending("full")}
        className="btn-primary disabled:opacity-60"
      >
        {pending === "full" ? "Starting secure checkout…" : "Pay in full"}
      </button>
      <button
        name="plan"
        value="installments"
        disabled={!!pending}
        onClick={() => setPending("installments")}
        className="btn-secondary disabled:opacity-60"
      >
        {pending === "installments" ? "Starting…" : `3 payments of ${per}`}
      </button>
    </form>
  );
}
