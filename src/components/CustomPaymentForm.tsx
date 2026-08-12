"use client";

import { useState } from "react";

// Admin form to request a custom card payment (any amount + optional % discount),
// emailed to the recipient as a Stripe pay link. Shows a live total.
export function CustomPaymentForm({
  ticket,
  returnTo = "/console/payments",
  category = "CUSTOM",
  defaults,
  compact,
}: {
  ticket: string;
  returnTo?: string;
  category?: "CUSTOM" | "ACP_ENTRY";
  defaults?: { name?: string; email?: string; description?: string; amount?: string };
  compact?: boolean;
}) {
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [discount, setDiscount] = useState("0");

  const base = parseFloat(amount);
  const disc = Math.max(0, Math.min(100, parseInt(discount || "0", 10) || 0));
  const total = Number.isFinite(base) && base > 0 ? (base * (100 - disc)) / 100 : 0;
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <form method="POST" action="/api/console/payments" className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="customRequest" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="category" value={category} />

      <div>
        <label className="label">Recipient name *</label>
        <input name="name" className="input" required defaultValue={defaults?.name} />
      </div>
      <div>
        <label className="label">Recipient email *</label>
        <input name="email" type="email" className="input" required defaultValue={defaults?.email} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">What&apos;s this for? *</label>
        <input name="description" className="input" required defaultValue={defaults?.description} placeholder="e.g. ACP entry — Mesa Smash (3 matches)" />
      </div>
      <div>
        <label className="label">Amount (USD) *</label>
        <input name="amount" inputMode="decimal" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="195.00" />
      </div>
      <div>
        <label className="label">Discount %</label>
        <input name="discountPercent" inputMode="numeric" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
      </div>

      <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
        <div className="text-sm text-slate-600">
          {disc > 0 && Number.isFinite(base) ? (
            <span>{fmt(base)} − {disc}% = </span>
          ) : null}
          <span className="text-xl font-extrabold text-brand-900">{fmt(total)}</span>
          <span className="ml-1 text-xs text-slate-500">will be charged</span>
        </div>
        <button className="btn-primary" disabled={total <= 0}>Create &amp; email pay link</button>
      </div>
    </form>
  );
}
