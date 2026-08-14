"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import {
  APPAREL_GARMENTS,
  APPAREL_SIZES,
  unitPriceCents,
  garmentLabel,
  sizeLabel,
  type Garment,
  type SizeKey,
} from "@/lib/domain/apparel";

type Line = { garment: Garment; size: SizeKey; quantity: number; personId: string | null };
type Player = { id: string; name: string };

/**
 * Season-fee checkout with the REQUIRED team-apparel picker. Players pick a
 * garment (T-shirt / tank top), size, and quantity, add them to their order,
 * and the total (season fee + apparel) is charged in one Stripe checkout — pay
 * in full or the 3-payment plan (apparel is charged once, on the first payment).
 * Checkout stays disabled until at least one item is in the order.
 */
export function SeasonFeePayForm({
  paymentId,
  seasonFeeCents,
  shirtCents,
  tankCents,
  recommendInstall,
  perInstallmentCents,
  installmentCount,
  action = "/api/pay",
  extraFields,
  players = [],
}: {
  paymentId: string;
  seasonFeeCents: number;
  shirtCents: number;
  tankCents: number;
  recommendInstall: boolean;
  perInstallmentCents: number;
  installmentCount: number;
  action?: string;
  extraFields?: Record<string, string>;
  players?: Player[];
}) {
  const multiPlayer = players.length > 1;
  const [lines, setLines] = useState<Line[]>([]);
  const [garment, setGarment] = useState<Garment>("SHIRT");
  const [size, setSize] = useState<SizeKey>("AM");
  const [qty, setQty] = useState(1);
  const [forPlayer, setForPlayer] = useState<string>(players[0]?.id ?? "");
  const playerName = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";

  const apparelCents = lines.reduce((s, l) => s + unitPriceCents(l.garment, shirtCents, tankCents) * l.quantity, 0);
  const totalCents = seasonFeeCents + apparelCents;
  const hasItems = lines.length > 0;

  function addItem() {
    const pid = players.length ? (forPlayer || players[0].id) : null;
    setLines((prev) => {
      const i = prev.findIndex((l) => l.garment === garment && l.size === size && l.personId === pid);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + qty };
        return copy;
      }
      return [...prev, { garment, size, quantity: qty, personId: pid }];
    });
    setQty(1);
  }
  function removeItem(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const priceOf = (g: Garment) => unitPriceCents(g, shirtCents, tankCents);

  return (
    <div className="space-y-5">
      {/* Required apparel picker */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Team apparel</h2>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">Required</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Every player gets team gear. Choose a T-shirt or tank top, pick a size and quantity, and add it to your
          order. You can add more than one.
        </p>

        <div className={`mt-3 grid grid-cols-2 gap-2 sm:items-end ${multiPlayer ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          {multiPlayer && (
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500">For</label>
              <select value={forPlayer} onChange={(e) => setForPlayer(e.target.value)} className="input py-1.5 text-sm">
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500">Item</label>
            <select value={garment} onChange={(e) => setGarment(e.target.value as Garment)} className="input py-1.5 text-sm">
              {APPAREL_GARMENTS.map((g) => (
                <option key={g.key} value={g.key}>{g.label} — {formatCents(priceOf(g.key))}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Size</label>
            <select value={size} onChange={(e) => setSize(e.target.value as SizeKey)} className="input py-1.5 text-sm">
              {APPAREL_SIZES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Qty</label>
            <input
              type="number"
              min={1}
              max={20}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))))}
              className="input py-1.5 text-sm"
            />
          </div>
          <button type="button" onClick={addItem} className="btn-secondary text-sm">Add to order</button>
        </div>

        {/* The order */}
        <div className="mt-3">
          {hasItems ? (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {lines.map((l, i) => (
                <li key={`${l.garment}-${l.size}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-slate-700">
                    {l.quantity} × {garmentLabel(l.garment)} <span className="text-slate-400">·</span> {sizeLabel(l.size)}
                    {multiPlayer && l.personId && <span className="text-slate-400"> · {playerName(l.personId)}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-600">{formatCents(priceOf(l.garment) * l.quantity)}</span>
                    <button type="button" onClick={() => removeItem(i)} className="text-xs text-slate-400 hover:text-rose-600">Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-sm text-slate-400">
              No items yet — add at least one to continue.
            </p>
          )}
        </div>
      </div>

      {/* Order summary */}
      <dl className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Season fee</dt>
          <dd className="text-slate-700">{formatCents(seasonFeeCents)}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <dt className="text-slate-500">Team apparel</dt>
          <dd className="text-slate-700">{formatCents(apparelCents)}</dd>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
          <dt className="font-semibold text-slate-800">Total</dt>
          <dd className="text-lg font-bold text-slate-900">{formatCents(totalCents)}</dd>
        </div>
      </dl>

      {/* Pay — both plans carry the apparel cart; disabled until an item is added */}
      <form method="POST" action={action} className="space-y-3">
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="cart" value={JSON.stringify(lines)} />
        {extraFields &&
          Object.entries(extraFields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

        <button
          name="plan"
          value="full"
          disabled={!hasItems}
          className={`w-full rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
            recommendInstall ? "border-slate-200 bg-white hover:border-slate-300" : "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
          }`}
        >
          <span className="block font-semibold text-slate-900">Pay in full — {formatCents(totalCents)}</span>
          <span className="block text-xs text-slate-500">One secure payment now (season fee + apparel).</span>
        </button>

        <button
          name="plan"
          value="installments"
          disabled={!hasItems}
          className={`w-full rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
            recommendInstall ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span className="block font-semibold text-slate-900">
            Pay in {installmentCount} — {formatCents(perInstallmentCents + apparelCents)} today, then 2 more
          </span>
          <span className="block text-xs text-slate-500">
            The season fee splits into {installmentCount} equal payments 30 days apart; apparel is included in
            today&apos;s first payment.
          </span>
        </button>

        {!hasItems && (
          <p className="text-center text-xs text-amber-600">Add a T-shirt or tank top above to enable checkout.</p>
        )}
      </form>
    </div>
  );
}
